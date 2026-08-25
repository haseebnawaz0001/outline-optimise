import slugify from "slugify";
import env from "@server/env";
import { RESERVED_SUBDOMAINS } from "@shared/utils/domains";
import { UserRole } from "@shared/types";
import Logger from "@server/logging/Logger";
import { Team, User } from "@server/models";

type Props = {
  /** The better-auth generated user id, shared with the Outline user row. */
  id: string;
  /** The display name from sign-up. */
  name: string;
  /** The lowercased email from sign-up. */
  email: string;
  /** The avatar image url from sign-up, if any. */
  avatarUrl?: string | null;
};

/**
 * Finds an available subdomain for a new team by suffixing a counter until
 * unique. Only relevant for cloud hosting where subdomains are used.
 *
 * @param desired The slugified preferred subdomain.
 * @returns A subdomain that no existing team is using.
 */
async function findAvailableSubdomain(desired: string): Promise<string> {
  let candidate = desired;
  let counter = 1;

  while (
    RESERVED_SUBDOMAINS.includes(candidate) ||
    (await Team.findOne({ where: { subdomain: candidate } }))
  ) {
    candidate = `${desired}-${counter++}`;
  }

  return candidate;
}

/**
 * Creates the Outline-side records for a newly registered better-auth user.
 * The better-auth user row and the Outline users row share the same id so no
 * identifier translation is ever needed elsewhere in the application.
 *
 * When this is the first user on the installation a Team is created and the
 * user becomes its admin; otherwise the user joins the most recently created
 * team with that team's default role.
 *
 * @param props The better-auth user attributes to mirror.
 */
export async function provisionBetterAuthUser(props: Props): Promise<void> {
  const existing = await User.findOne({
    where: { email: props.email.toLowerCase() },
  });

  if (existing) {
    // Claim path: an Outline user already exists for this email (legacy
    // account reclaiming access). Update profile fields but never their role.
    await existing.update({
      name: props.name,
      avatarUrl: props.avatarUrl ?? existing.avatarUrl,
    });
    return;
  }

  const team = await Team.findOne({ order: [["createdAt", "ASC"]] });
  const isFirstUser = !team;

  let targetTeam = team;
  if (!targetTeam) {
    targetTeam = await Team.create({
      name: props.name ? `${props.name}'s Workspace` : "Outline",
      ...(env.isCloudHosted
        ? {
            subdomain: await findAvailableSubdomain(
              slugify(props.name || "outline", { lower: true, strict: true }) ||
                "outline"
            ),
          }
        : {}),
    });
  }

  try {
    await User.create({
      id: props.id,
      name: props.name,
      email: props.email.toLowerCase(),
      avatarUrl: props.avatarUrl ?? undefined,
      teamId: targetTeam.id,
      role: isFirstUser ? UserRole.Admin : targetTeam.defaultUserRole,
      lastActiveAt: new Date(),
    });
  } catch (error) {
    Logger.error(
      "Failed to provision Outline user for better-auth signup",
      error instanceof Error ? error : new Error(String(error)),
      { userId: props.id }
    );
    throw error;
  }
}
