import crypto from "node:crypto";
import type { DefaultState } from "koa";
import { errToString } from "@shared/utils/error";
import { randomString } from "@shared/random";
import { Scope } from "@shared/types";
import env from "@server/env";
import { auth as betterAuth } from "@server/auth/better-auth";
import {
  buildUser,
  buildTeam,
  buildAdmin,
  buildApiKey,
  buildOAuthAuthentication,
} from "@server/test/factories";
import { User } from "@server/models";
import { sequelize } from "@server/storage/database";
import { AuthenticationType } from "@server/types";
import auth from "./authentication";

describe("Authentication middleware", () => {
  describe("with session JWT", () => {
    it("should authenticate with correct session token", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();
      await authMiddleware(
        {
          // @ts-expect-error mock request
          request: {
            get: vi.fn(() => `Bearer ${user.getSessionToken()}`),
          },
          state,
          cache: {},
        },
        vi.fn()
      );
      expect(state.auth.user.id).toEqual(user.id);
    });

    it("should return error with invalid session token", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();

      try {
        await authMiddleware(
          {
            // @ts-expect-error mock request
            request: {
              get: vi.fn(() => `Bearer ${user.getSessionToken()}error`),
            },
            state,
            cache: {},
          },
          vi.fn()
        );
      } catch (e) {
        expect(errToString(e)).toBe("Invalid token");
      }
    });

    it("should return error if AuthenticationType mismatches", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth({
        type: AuthenticationType.API,
      });

      try {
        await authMiddleware(
          {
            // @ts-expect-error mock request
            request: {
              get: vi.fn(() => `Bearer ${user.getSessionToken()}`),
            },
            state,
            cache: {},
          },
          vi.fn()
        );
      } catch (e) {
        expect(errToString(e)).toBe("Invalid authentication type");
      }
    });
  });

  describe("with API key", () => {
    it("should authenticate user with valid API key", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();
      const key = await buildApiKey({ userId: user.id });
      await authMiddleware(
        {
          // @ts-expect-error mock request
          request: {
            get: vi.fn(() => `Bearer ${key.value}`),
          },
          state,
          cache: {},
        },
        vi.fn()
      );
      expect(state.auth.user.id).toEqual(user.id);
    });
    it("should authenticate with global read scope on read endpoints", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();
      const key = await buildApiKey({
        userId: user.id,
        scope: [Scope.Read],
      });

      await authMiddleware(
        {
          originalUrl: "/api/auth.info",
          // @ts-expect-error mock request
          request: {
            url: "/auth.info",
            get: vi.fn(() => `Bearer ${key.value}`),
          },
          state,
          cache: {},
        },
        vi.fn()
      );
      expect(state.auth.user.id).toEqual(user.id);
    });

    it("should return 403 authorization error when scope does not match", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();
      const key = await buildApiKey({
        userId: user.id,
        scope: [Scope.Read],
      });

      try {
        await authMiddleware(
          {
            originalUrl: "/api/documents.create",
            // @ts-expect-error mock request
            request: {
              url: "/documents.create",
              get: vi.fn(() => `Bearer ${key.value}`),
            },
            state,
            cache: {},
          },
          vi.fn()
        );
        throw new Error("Expected error to be thrown");
      } catch (e) {
        expect(e).toHaveProperty("status", 403);
        expect(e).toHaveProperty("id", "authorization_error");
        expect(errToString(e)).toContain(
          "does not have access to this resource"
        );
      }
    });

    it("should return error with invalid API key", async () => {
      const state = {} as DefaultState;
      const authMiddleware = auth();

      try {
        await authMiddleware(
          {
            // @ts-expect-error mock request
            request: {
              get: vi.fn(() => `Bearer ${randomString(38)}`),
            },
            state,
            cache: {},
          },
          vi.fn()
        );
      } catch (e) {
        expect(errToString(e)).toBe("Invalid API key");
      }
    });
  });

  describe("with OAuth access token", () => {
    it("should authenticate user with valid OAuth access token", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();
      const authentication = await buildOAuthAuthentication({
        user,
        scope: [Scope.Read],
      });

      await authMiddleware(
        {
          originalUrl: "/api/users.info",
          // @ts-expect-error mock request
          request: {
            url: "/users.info",
            get: vi.fn(() => `Bearer ${authentication.accessToken}`),
          },
          state,
          cache: {},
        },
        vi.fn()
      );
      expect(state.auth.user.id).toEqual(user.id);
    });

    it("should return error with invalid scope", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();
      const authentication = await buildOAuthAuthentication({
        user,
        scope: [Scope.Read],
      });

      try {
        await authMiddleware(
          {
            originalUrl: "/api/documents.create",
            // @ts-expect-error mock request
            request: {
              url: "/documents.create",
              get: vi.fn(() => `Bearer ${authentication.accessToken}`),
            },
            state,
            cache: {},
          },
          vi.fn()
        );
      } catch (e) {
        expect(errToString(e)).toContain(
          "does not have access to this resource"
        );
      }
    });

    it("should return error with OAuth access token in body", async () => {
      const state = {} as DefaultState;
      const user = await buildUser();
      const authMiddleware = auth();
      const authentication = await buildOAuthAuthentication({
        user,
        scope: [Scope.Read],
      });
      try {
        await authMiddleware(
          {
            originalUrl: "/api/users.info",
            request: {
              url: "/users.info",
              // @ts-expect-error mock request
              get: vi.fn(() => null),
              body: {
                token: authentication.accessToken,
              },
            },
            state,
            cache: {},
          },
          vi.fn()
        );
      } catch (e) {
        expect(errToString(e)).toContain(
          "must be passed in the Authorization header"
        );
      }
    });
  });

  it("should return error message if no auth token is available", async () => {
    const state = {} as DefaultState;
    const authMiddleware = auth();

    try {
      await authMiddleware(
        {
          // @ts-expect-error mock request
          request: {
            get: vi.fn(() => "error"),
          },
          state,
          cache: {},
        },
        vi.fn()
      );
    } catch (e) {
      expect(errToString(e)).toBe(
        'Bad Authorization header format. Format is "Authorization: Bearer <token>"'
      );
    }
  });

  it("should allow passing session token in a cookie", async () => {
    const state = {} as DefaultState;
    const user = await buildUser();
    const authMiddleware = auth();
    await authMiddleware(
      {
        request: {
          // @ts-expect-error mock request
          get: vi.fn(() => null),
        },
        // @ts-expect-error mock cookies
        cookies: {
          get: vi.fn(() => user.getSessionToken()),
        },
        state,
        cache: {},
      },
      vi.fn()
    );
    expect(state.auth.user.id).toEqual(user.id);
  });

  it("should return error with session token as a GET param", async () => {
    const state = {} as DefaultState;
    const user = await buildUser();
    const authMiddleware = auth();

    await expect(
      authMiddleware(
        {
          request: {
            // @ts-expect-error mock request
            get: vi.fn(() => null),
            query: {
              token: user.getSessionToken(),
            },
          },
          state,
          cache: {},
        },
        vi.fn()
      )
    ).rejects.toThrow(
      "Session token must be passed in the cookie or Authorization header"
    );
  });

  it("should return error with session token in body params", async () => {
    const state = {} as DefaultState;
    const user = await buildUser();
    const authMiddleware = auth();

    await expect(
      authMiddleware(
        {
          request: {
            // @ts-expect-error mock request
            get: vi.fn(() => null),
            body: {
              token: user.getSessionToken(),
            },
          },
          state,
          cache: {},
        },
        vi.fn()
      )
    ).rejects.toThrow(
      "Session token must be passed in the cookie or Authorization header"
    );
  });

  it("should allow passing transfer token as a GET param", async () => {
    const state = {} as DefaultState;
    const user = await buildUser();
    const authMiddleware = auth();
    await authMiddleware(
      {
        request: {
          // @ts-expect-error mock request
          get: vi.fn(() => null),
          query: {
            token: user.getTransferToken(),
          },
        },
        state,
        cache: {},
      },
      vi.fn()
    );
    expect(state.auth.user.id).toEqual(user.id);
  });

  it("should return an error for suspended users", async () => {
    const state = {} as DefaultState;
    const admin = await buildAdmin();
    const user = await buildUser({
      suspendedAt: new Date(),
      suspendedById: admin.id,
    });
    const authMiddleware = auth();
    let error;

    try {
      await authMiddleware(
        {
          // @ts-expect-error mock request
          request: {
            get: vi.fn(() => `Bearer ${user.getSessionToken()}`),
          },
          state,
          cache: {},
        },
        vi.fn()
      );
    } catch (err) {
      error = err;
    }

    expect(errToString(error)).toEqual(
      "Your access has been suspended by a workspace admin"
    );
    expect(error).toHaveProperty("errorData.adminEmail", admin.email);
  });

  it("should return an error for deleted team", async () => {
    const state = {} as DefaultState;
    const team = await buildTeam();
    const user = await buildUser({ teamId: team.id });
    await team.destroy();
    const authMiddleware = auth();
    let error;

    try {
      await authMiddleware(
        {
          // @ts-expect-error mock request
          request: {
            get: vi.fn(() => `Bearer ${user.getSessionToken()}`),
          },
          state,
          cache: {},
        },
        vi.fn()
      );
    } catch (err) {
      error = err;
    }

    expect(errToString(error)).toEqual("Invalid token");
  });

  describe("with better-auth session cookie", () => {
    const TestSignupKey = "impl-c-test-signup-key";
    const TestPassword = "super-secret-password";
    const createdEmails = new Set<string>();
    let originalSignupKey: string | undefined;

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

      createdEmails.clear();
      env.AUTH_SIGNUP_KEY = originalSignupKey;
    });

    it("should authenticate a request carrying only a valid better-auth session", async () => {
      const email = `${crypto.randomUUID()}@example.com`;
      createdEmails.add(email);

      const response = await betterAuth.api.signUpEmail({
        body: Object.assign(
          { email, password: TestPassword, name: "BA Session" },
          { signupKey: TestSignupKey }
        ),
        asResponse: true,
      });
      expect(response.status).toEqual(200);

      const sessionCookie = response.headers
        .getSetCookie()
        .find((cookie) => cookie.startsWith("better-auth.session_token="));
      expect(sessionCookie).toBeTruthy();

      const cookieValue = (sessionCookie ?? "").split(";")[0];
      const state = {} as DefaultState;
      const authMiddleware = auth();
      await authMiddleware(
        {
          headers: { cookie: cookieValue },
          request: {
            // @ts-expect-error mock request
            get: vi.fn((name: string) =>
              name.toLowerCase() === "cookie" ? cookieValue : null
            ),
          },
          // @ts-expect-error mock cookies
          cookies: {
            get: vi.fn(() => undefined),
          },
          state,
          cache: {},
        },
        vi.fn()
      );

      const user = await User.findOne({
        where: { email },
        rejectOnEmpty: true,
      });
      expect(state.auth.type).toEqual(AuthenticationType.APP);
      expect(state.auth.user.id).toEqual(user.id);
      const sessionTokenValue = (sessionCookie ?? "")
        .split(";")[0]
        .replace(/^better-auth\.session_token=/, "");
      expect(state.auth.token).toEqual(sessionTokenValue.split(".")[0]);
    });

    it("should not authenticate when the better-auth session is missing or expired", async () => {
      const state = {} as DefaultState;
      const authMiddleware = auth();
      const cookieValue = "better-auth.session_token=does-not-exist";

      await expect(
        authMiddleware(
          {
            headers: { cookie: cookieValue },
            request: {
              // @ts-expect-error mock request
              get: vi.fn((name: string) =>
                name.toLowerCase() === "cookie" ? cookieValue : null
              ),
            },
            // @ts-expect-error mock cookies
            cookies: {
              get: vi.fn(() => undefined),
            },
            state,
            cache: {},
          },
          vi.fn()
        )
      ).rejects.toThrow("Authentication required");
    });
  });
});
