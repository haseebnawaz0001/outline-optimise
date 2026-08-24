import { createHash } from "crypto";
import { subMinutes } from "date-fns";
import JWT from "jsonwebtoken";
import type { FindOptions } from "sequelize";
import { Team, User } from "@server/models";
import { AuthenticationError, UserSuspendedError } from "../errors";
import type { Context } from "koa";

/** How long a user resolved for a token may be reused without refetching. */
const USER_CACHE_TTL_MS = 30_000;

/** Maximum number of users kept in the per-process cache. */
const USER_CACHE_MAX_ENTRIES = 1000;

interface UserCacheEntry {
  user: User;
  expiresAt: number;
}

const userCache = new Map<string, UserCacheEntry>();

/**
 * Clears the in-process user cache populated by `getUserForJWT`. Intended for
 * use in tests only.
 */
export function __resetUserCacheForTests(): void {
  userCache.clear();
}

/**
 * Returns a stable cache key for a raw token that does not retain the token
 * itself in memory.
 *
 * @param token The raw JWT token as received from the caller.
 * @returns The sha256 hex digest of the token.
 */
function cacheKeyForToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Reads a user from the cache, treating expired entries as absent and
 * refreshing recency of the entry so eviction approximates LRU.
 *
 * @param key The cache key for the token.
 * @returns The cached user or undefined on a miss.
 */
function readCachedUser(key: string): User | undefined {
  const entry = userCache.get(key);

  if (!entry) {
    return undefined;
  }

  if (entry.expiresAt <= Date.now()) {
    userCache.delete(key);
    return undefined;
  }

  userCache.delete(key);
  userCache.set(key, entry);
  return entry.user;
}

/**
 * Writes a fully validated user to the cache, evicting the least recently
 * used entry when the maximum number of entries is exceeded.
 *
 * @param key The cache key for the token.
 * @param user The validated user to cache.
 */
function writeCachedUser(key: string, user: User): void {
  while (userCache.size >= USER_CACHE_MAX_ENTRIES) {
    const oldest = userCache.keys().next();

    if (oldest.done) {
      break;
    }

    userCache.delete(oldest.value);
  }

  userCache.set(key, {
    user,
    expiresAt: Date.now() + USER_CACHE_TTL_MS,
  });
}

/**
 * Decodes a JWT token and returns its payload without verifying the
 * signature.
 *
 * @param token the JWT token to decode.
 * @returns the decoded token payload.
 * @throws AuthenticationError if the token is missing or cannot be decoded.
 */
export function getJWTPayload(token: string) {
  let payload;
  if (!token) {
    throw AuthenticationError("Missing token");
  }

  try {
    payload = JWT.decode(token);

    if (!payload) {
      throw AuthenticationError("Invalid token");
    }

    return payload as JWT.JwtPayload;
  } catch (_err) {
    throw AuthenticationError("Unable to decode token");
  }
}

/**
 * Retrieves the user associated with a JWT token, validating the token's type and expiration.
 *
 * Results are cached in-process keyed on the raw token for `USER_CACHE_TTL_MS`
 * (30 seconds), so suspension (user or team), secret rotation, and team
 * deletion may take up to 30 seconds to be observed. Transfer tokens are never
 * cached as their single-use semantics depend on a fresh `lastActiveAt`. The
 * token signature is verified against the user's secret on every call,
 * including cache hits.
 *
 * @param token The JWT token to validate and extract the user from.
 * @param allowedTypes An array of allowed token types (default: ["session", "transfer"]). The token's type must be included in this array to be considered valid.
 * @returns An object containing the user associated with the token and an optional service string if included in the token's payload.
 * @throws AuthenticationError if the token is missing, invalid, expired, or if the token's type is not allowed.
 * @throws UserSuspendedError if the user associated with the token is suspended.
 */
export async function getUserForJWT(
  token: string,
  allowedTypes = ["session", "transfer"]
): Promise<{ user: User; service?: string }> {
  const payload = getJWTPayload(token);

  if (!allowedTypes.includes(payload.type)) {
    throw AuthenticationError("Invalid token");
  }

  // check the token is within it's expiration time
  if (payload.expiresAt) {
    if (new Date(payload.expiresAt) < new Date()) {
      throw AuthenticationError("Expired token");
    }
  }

  // Transfer tokens are single-use and their validity depends on an up-to-date
  // `lastActiveAt`, so they bypass the cache entirely.
  const cacheable = payload.type !== "transfer";
  const key = cacheable ? cacheKeyForToken(token) : undefined;
  const cachedUser = key ? readCachedUser(key) : undefined;

  const user =
    cachedUser ??
    (await User.findByPk(payload.id, {
      include: [
        {
          model: Team,
          as: "team",
          required: true,
        },
      ],
    }));

  if (!user) {
    throw AuthenticationError("Invalid token");
  }

  if (user.isSuspended) {
    const suspendingAdmin = user.suspendedById
      ? await User.findByPk(user.suspendedById)
      : undefined;
    throw UserSuspendedError({
      adminEmail: suspendingAdmin?.email || undefined,
    });
  }

  if (payload.type === "transfer") {
    // If the user has made a single API request since the transfer token was
    // created then it's no longer valid, they'll need to sign in again.
    if (
      user.lastActiveAt &&
      payload.createdAt &&
      user.lastActiveAt > new Date(payload.createdAt)
    ) {
      throw AuthenticationError("Token has already been used");
    }
  }

  try {
    JWT.verify(token, user.jwtSecret);
  } catch (_err) {
    throw AuthenticationError("Invalid token");
  }

  // Only fully validated users are cached; failures are refetched each time.
  if (key && !cachedUser) {
    writeCachedUser(key, user);
  }

  return {
    user,
    service: payload.service as string | undefined,
  };
}

/**
 * Retrieves the user associated with an email sign-in token, validating the
 * token's type, expiration, and originating IP address.
 *
 * @param ctx the Koa context of the current request.
 * @param token the email sign-in token to validate.
 * @returns the user associated with the token.
 * @throws AuthenticationError if the token is invalid, expired, or from a different IP.
 */
export async function getUserForEmailSigninToken(
  ctx: Context,
  token: string
): Promise<User> {
  const payload = getJWTPayload(token);

  if (payload.type !== "email-signin") {
    throw AuthenticationError("Invalid token");
  }

  // check the token is within it's expiration time
  if (payload.createdAt) {
    if (new Date(payload.createdAt) < subMinutes(new Date(), 10)) {
      throw AuthenticationError("Expired token");
    }
  }

  if (payload.ip !== ctx.request.ip) {
    throw AuthenticationError("Token mismatch");
  }

  const user = await User.scope("withTeam").findByPk(payload.id, {
    rejectOnEmpty: true,
  });

  try {
    JWT.verify(token, user.jwtSecret);
  } catch (_err) {
    throw AuthenticationError("Invalid token");
  }

  return user;
}

/**
 * Retrieves the user and new email address associated with an email update
 * token, validating the token's type and expiration.
 *
 * @param token the email update token to validate.
 * @param options find options passed when loading the user.
 * @returns the user and the new email address.
 * @throws AuthenticationError if the token is invalid or expired.
 */
export async function getDetailsForEmailUpdateToken(
  token: string,
  options: FindOptions<User> = {}
): Promise<{ user: User; email: string }> {
  const payload = getJWTPayload(token);

  if (payload.type !== "email-update") {
    throw AuthenticationError("Invalid token");
  }

  // check the token is within it's expiration time
  if (payload.createdAt) {
    if (new Date(payload.createdAt) < subMinutes(new Date(), 10)) {
      throw AuthenticationError("Expired token");
    }
  }

  const email = payload.email;
  const user = await User.findByPk(payload.id, {
    rejectOnEmpty: true,
    ...options,
  });

  try {
    JWT.verify(token, user.jwtSecret);
  } catch (_err) {
    throw AuthenticationError("Invalid token");
  }

  return { user, email };
}
