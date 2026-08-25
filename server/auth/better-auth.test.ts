import crypto from "node:crypto";
import { Op, QueryTypes } from "sequelize";
import { UserRole } from "@shared/types";
import env from "@server/env";
import { Team, User } from "@server/models";
import { sequelize } from "@server/storage/database";
import { buildUser } from "@server/test/factories";
import { auth } from "./better-auth";

const TestSignupKey = "leaf-b-test-signup-key";
const TestPassword = "super-secret-password";

describe("better-auth", () => {
  const createdEmails = new Set<string>();
  const createdTeamIds = new Set<string>();
  let originalSignupKey: string | undefined;

  const uniqueEmail = () => `${crypto.randomUUID()}@example.com`;

  beforeEach(() => {
    originalSignupKey = env.AUTH_SIGNUP_KEY;
    env.AUTH_SIGNUP_KEY = TestSignupKey;
  });

  afterEach(async () => {
    const emails = [...createdEmails];

    if (emails.length > 0) {
      await sequelize.query(
        'DELETE FROM ba_session WHERE "userId" IN (SELECT id FROM ba_user WHERE email IN (:emails))',
        { replacements: { emails } }
      );
      await sequelize.query(
        'DELETE FROM ba_account WHERE "userId" IN (SELECT id FROM ba_user WHERE email IN (:emails))',
        { replacements: { emails } }
      );
      await sequelize.query("DELETE FROM ba_user WHERE email IN (:emails)", {
        replacements: { emails },
      });
      await User.destroy({ where: { email: emails }, force: true });
    }

    if (createdTeamIds.size > 0 || emails.length > 0) {
      const teamIds = [...createdTeamIds];
      // Events reference both teams and users; clear the ones this suite
      // caused before destroying either, or FK constraints will abort.
      await sequelize.query(
        'DELETE FROM events WHERE ("teamId" IN (:teamIds) OR "userId" IN (SELECT id FROM users WHERE email IN (:emails)))',
        { replacements: { teamIds, emails } }
      );
      await sequelize.query(
        'DELETE FROM authentication_providers WHERE "teamId" IN (:teamIds)',
        { replacements: { teamIds } }
      );
      await Team.destroy({ where: { id: { [Op.in]: teamIds } }, force: true });
    }

    createdEmails.clear();
    createdTeamIds.clear();
    env.AUTH_SIGNUP_KEY = originalSignupKey;
  });

  describe("signup key", () => {
    it("should reject sign-up when the signup key is missing", async () => {
      env.AUTH_SIGNUP_KEY = undefined;
      const email = uniqueEmail();

      await expect(
        auth.api.signUpEmail({
          body: {
            email,
            password: TestPassword,
            name: "No Key",
          },
        })
      ).rejects.toMatchObject({ status: "FORBIDDEN" });

      expect(await User.count({ where: { email } })).toEqual(0);
    });

    it("should reject sign-up when the signup key is wrong", async () => {
      const email = uniqueEmail();

      await expect(
        auth.api.signUpEmail({
          body: Object.assign(
            { email, password: TestPassword, name: "Wrong Key" },
            { signupKey: "definitely-not-the-key" }
          ),
        })
      ).rejects.toMatchObject({ status: "FORBIDDEN" });

      expect(await User.count({ where: { email } })).toEqual(0);
    });

    it("should create a ba_user and a matching Outline user with identical ids on sign-up with the correct key", async () => {
      const email = uniqueEmail();
      createdEmails.add(email);

      const oldestTeamBefore = await Team.findOne({
        order: [["createdAt", "ASC"]],
      });

      const result = await auth.api.signUpEmail({
        body: Object.assign(
          { email, password: TestPassword, name: "Fresh Signup" },
          { signupKey: TestSignupKey }
        ),
      });

      expect(result.token).not.toBeNull();
      expect(result.user.email).toEqual(email);

      const baUsers = await sequelize.query<{ id: string; email: string }>(
        "SELECT id, lower(email) AS email FROM ba_user WHERE lower(email) = :email",
        { replacements: { email }, type: QueryTypes.SELECT }
      );
      expect(baUsers).toHaveLength(1);

      const outlineUser = await User.findOne({
        where: { email },
        rejectOnEmpty: true,
      });
      createdTeamIds.add(outlineUser.teamId);

      expect(outlineUser.id).toEqual(baUsers[0].id);
      expect(result.user.id).toEqual(outlineUser.id);

      const accounts = await sequelize.query<{
        userId: string;
        providerId: string;
      }>('SELECT "userId", "providerId" FROM ba_account WHERE "userId" = :id', {
        replacements: { id: outlineUser.id },
        type: QueryTypes.SELECT,
      });
      expect(accounts.map((account) => account.providerId)).toContain(
        "credential"
      );

      if (!oldestTeamBefore) {
        // Fresh install: the first user admins a newly provisioned workspace.
        expect(outlineUser.role).toEqual(UserRole.Admin);
        const team = await Team.findByPk(outlineUser.teamId, {
          rejectOnEmpty: true,
        });
        expect(team.createdAt.getTime()).toBeGreaterThanOrEqual(
          Date.now() - 60_000
        );
      } else {
        expect(outlineUser.teamId).toEqual(oldestTeamBefore.id);
        expect(outlineUser.role).toEqual(oldestTeamBefore.defaultUserRole);
      }
    });
  });

  describe("claim path", () => {
    it("should reuse an existing Outline user id for sign-up with the same lowercase email", async () => {
      const legacyEmail = uniqueEmail();
      const legacyUser = await buildUser({ email: legacyEmail });
      createdEmails.add(legacyEmail);
      createdTeamIds.add(legacyUser.teamId);

      const submittedName = `${legacyUser.name} Reclaimed`;
      const result = await auth.api.signUpEmail({
        body: Object.assign(
          {
            email: legacyEmail.toUpperCase(),
            password: TestPassword,
            name: submittedName,
          },
          { signupKey: TestSignupKey }
        ),
      });

      expect(result.user.id).toEqual(legacyUser.id);

      expect(await User.count({ where: { email: legacyEmail } })).toEqual(1);

      const baUsers = await sequelize.query<{ id: string }>(
        "SELECT id FROM ba_user WHERE lower(email) = :email",
        { replacements: { email: legacyEmail }, type: QueryTypes.SELECT }
      );
      expect(baUsers).toHaveLength(1);
      expect(baUsers[0].id).toEqual(legacyUser.id);

      await legacyUser.reload();
      expect(legacyUser.name).toEqual(submittedName);
      expect(legacyUser.role).not.toEqual(UserRole.Admin);
    });
  });
});
