import crypto from "node:crypto";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import { Pool } from "pg";
import env from "@server/env";
import { provisionBetterAuthUser } from "@server/commands/provisionBetterAuthUser";
import { User } from "@server/models";

/**
 * The signup key used in development when AUTH_SIGNUP_KEY is not configured.
 */
export const DevSignupKey = "dev-signup-key";

/**
 * Returns a Postgres connection configuration derived from the same
 * environment variables that Sequelize uses.
 */
function createPool() {
  const options = env.DATABASE_URL
    ? { connectionString: env.DATABASE_URL }
    : {
        host: env.DATABASE_HOST,
        port: env.DATABASE_PORT,
        user: env.DATABASE_USER,
        password: env.DATABASE_PASSWORD,
        database: env.DATABASE_NAME,
      };

  return new Pool({
    ...options,
    max: 5,
    ssl: env.PGSSLMODE === "disable" ? false : undefined,
  });
}

const pool = createPool();

/**
 * Looks up a better-auth user row by email using direct SQL. Fallback for
 * hook contexts that do not expose better-auth's internal adapter.
 *
 * @param email The email to search for, matched case-insensitively.
 * @returns True if a better-auth user row exists for the email.
 */
async function betterAuthUserExists(email: string): Promise<boolean> {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM ba_user WHERE lower(email) = $1 LIMIT 1",
    [email.toLowerCase()]
  );
  return result.rows.length > 0;
}

/**
 * Constant-time comparison of the supplied signup key against the configured
 * value. Both sides are hashed before comparison to avoid length leaks.
 *
 * @param supplied The key provided by the client.
 * @returns True if the key matches the configured signup key.
 */
function isValidSignupKey(supplied: string): boolean {
  const expected =
    env.AUTH_SIGNUP_KEY ?? (env.isDevelopment ? DevSignupKey : "");
  if (!expected || !supplied) {
    return false;
  }
  const a = crypto.createHash("sha256").update(supplied).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

/**
 * The shared better-auth instance. Owns all interactive authentication:
 * email + password sign-up/sign-in only.
 */
export const auth = betterAuth({
  appName: "Outline",
  baseURL: env.BETTER_AUTH_URL ?? env.URL,
  secret: env.BETTER_AUTH_SECRET ?? env.SECRET_KEY,
  trustedOrigins: (request) => {
    // Allow same-origin requests; Outline's own CSRF/origin checks continue
    // to apply at the Koa layer for non-auth routes.
    try {
      if (request) {
        return [new URL(request.url).origin];
      }
    } catch {
      // fall through
    }
    return [env.BETTER_AUTH_URL ?? env.URL];
  },
  emailAndPassword: {
    enabled: true,
  },
  session: {
    modelName: "ba_session",
    expiresIn: 60 * 60 * 24 * 90,
  },
  rateLimit: {
    enabled: true,
  },
  advanced: {
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
  user: {
    modelName: "ba_user",
  },
  account: {
    modelName: "ba_account",
  },
  verification: {
    modelName: "ba_verification",
  },
  database: pool,
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") {
        return;
      }

      const body = ctx.body as Record<string, unknown> | undefined;
      const supplied =
        typeof body?.signupKey === "string" ? body.signupKey : "";

      if (!isValidSignupKey(supplied)) {
        throw new APIError("FORBIDDEN", {
          message: "Invalid sign-up key",
        });
      }

      return {
        context: {
          ...ctx,
          body: {
            ...body,
            signupKey: undefined,
          },
        },
      };
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user, ctx) => {
          const email = user.email.toLowerCase();
          const existingOutlineUser = await User.findOne({
            where: { email },
            attributes: ["id"],
          });

          if (!existingOutlineUser) {
            return;
          }

          // Claim path: an Outline users row already exists for this email
          // (legacy account) and no better-auth user does yet, so rewrite the
          // id to reclaim the existing identity.
          const internalAdapter = ctx?.context?.internalAdapter;
          const claimed = internalAdapter
            ? await internalAdapter.findUserByEmail(email)
            : await betterAuthUserExists(email);

          if (claimed) {
            return;
          }

          return {
            data: {
              ...user,
              id: existingOutlineUser.id,
            },
          };
        },
        after: async (user) => {
          await provisionBetterAuthUser({
            id: user.id,
            name: user.name,
            email: user.email,
            avatarUrl: user.image ?? null,
          });
          return;
        },
      },
    },
  },
});

/**
 * Resolves a better-auth session from request headers.
 *
 * @param headers The request headers as a Fetch API Headers object.
 * @returns The session and user when a valid session exists, otherwise null.
 */
export async function getBetterAuthSession(headers: Headers) {
  try {
    return await auth.api.getSession({ headers });
  } catch {
    return null;
  }
}

/**
 * Node-compatible handler for the better-auth instance, suitable for direct
 * mounting inside a Koa middleware chain.
 */
// oxlint-disable-next-line no-restricted-imports
export const authHandler = toNodeHandler(auth);
