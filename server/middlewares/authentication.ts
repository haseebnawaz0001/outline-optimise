import type { Next } from "koa";
import { capitalize } from "es-toolkit/compat";
import httpErrors from "http-errors";
import type { UserRole } from "@shared/types";
import { UserRoleHelper } from "@shared/utils/UserRoleHelper";
import { getBetterAuthSession } from "@server/auth/better-auth";
import tracer, {
  addTags,
  getRootSpanFromRequestContext,
} from "@server/logging/tracer";
import { User, Team, ApiKey, OAuthAuthentication } from "@server/models";
import type { AppContext } from "@server/types";
import { AuthenticationType } from "@server/types";
import { getJWTPayload, getUserForJWT } from "@server/utils/jwt";
import {
  AuthenticationError,
  AuthorizationError,
  UserSuspendedError,
} from "../errors";

type AuthenticationOptions = {
  /** Role required to access the route. */
  role?: UserRole;
  /** Type of authentication required to access the route. */
  type?: AuthenticationType | AuthenticationType[];
  /** Authentication is parsed, but optional. */
  optional?: boolean;
};

type AuthTransport = "cookie" | "header" | "body" | "query";

type AuthInput = {
  /** The authentication token extracted from the request, if any. */
  token?: string;
  /** The method used to receive the authentication token. */
  transport?: AuthTransport;
};

export default function auth(options: AuthenticationOptions = {}) {
  return async function authMiddleware(ctx: AppContext, next: Next) {
    try {
      const { type, token, user, service, scope } =
        await validateAuthentication(ctx, options);

      await Promise.all([
        user.updateActiveAt(ctx),
        user.team?.updateActiveAt(),
      ]);

      ctx.state.auth = {
        user,
        token,
        type,
        service,
        scope,
      };

      if (tracer) {
        addTags(
          {
            "request.userId": user.id,
            "request.teamId": user.teamId,
            "request.authType": type,
          },
          getRootSpanFromRequestContext(ctx)
        );
      }
    } catch (err) {
      // Credentials that are valid but insufficient are always surfaced,
      // otherwise the request would be silently downgraded to anonymous.
      if (options.optional && !(err instanceof httpErrors.Forbidden)) {
        ctx.state.auth = {};
      } else {
        throw err;
      }
    }

    return next();
  };
}

/**
 * Parses the authentication token from the request context.
 *
 * @param ctx The application context containing the request information.
 * @returns An object containing the token and its transport method.
 */
export function parseAuthentication(ctx: AppContext): AuthInput {
  const authorizationHeader = ctx.request.get("authorization");

  if (authorizationHeader) {
    const parts = authorizationHeader.split(" ");

    if (parts.length === 2) {
      const scheme = parts[0];
      const credentials = parts[1];

      if (/^Bearer$/i.test(scheme)) {
        return {
          token: credentials,
          transport: "header",
        };
      }
    } else {
      throw AuthenticationError(
        `Bad Authorization header format. Format is "Authorization: Bearer <token>"`
      );
    }
  } else if (
    ctx.request.body &&
    typeof ctx.request.body === "object" &&
    "token" in ctx.request.body
  ) {
    return {
      token: String(ctx.request.body.token),
      transport: "body",
    };
  } else if (ctx.request.query?.token) {
    return {
      token: String(ctx.request.query.token),
      transport: "query",
    };
  } else {
    const accessToken = ctx.cookies.get("accessToken");
    if (accessToken) {
      return {
        token: accessToken,
        transport: "cookie",
      };
    }
  }

  return {
    token: undefined,
    transport: undefined,
  };
}

/**
 * Builds a Fetch API Headers object from the Koa request headers.
 *
 * @param ctx The application context containing the request headers.
 * @returns The request headers as a Fetch API Headers object.
 */
export function requestHeadersFromContext(ctx: AppContext): Headers {
  const headers = new globalThis.Headers();

  for (const [key, value] of Object.entries(ctx.headers ?? {})) {
    if (typeof value === "string") {
      headers.set(key, value);
    } else if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
    }
  }

  return headers;
}

/**
 * Returns true when the request plausibly carries better-auth credentials:
 * a better-auth session cookie, or an Authorization bearer token that is
 * neither an API key nor an OAuth access token.
 *
 * @param ctx The application context containing the request information.
 * @returns True if the request may be authenticated via a better-auth session.
 */
function hasBetterAuthCredentials(ctx: AppContext): boolean {
  const authorizationHeader = ctx.request.get("authorization");

  if (authorizationHeader) {
    const parts = authorizationHeader.split(" ");

    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      const credentials = parts[1];
      return (
        !ApiKey.match(credentials) && !OAuthAuthentication.match(credentials)
      );
    }
  }

  return Boolean(ctx.request.get("cookie"));
}

/**
 * Resolves the Outline user for the better-auth session carried by the
 * request. The Outline users row shares its id with the better-auth user row.
 *
 * @param ctx The application context containing the request headers.
 * @returns The authenticated user and better-auth session token, or null when no valid better-auth session exists.
 */
async function getUserForBetterAuthSession(
  ctx: AppContext
): Promise<{ user: User; token?: string } | null> {
  const result = await getBetterAuthSession(requestHeadersFromContext(ctx));

  if (!result) {
    return null;
  }

  const user = await User.findByPk(result.user.id, {
    include: [
      {
        model: Team,
        as: "team",
        required: true,
      },
    ],
  });

  if (!user) {
    return null;
  }

  return { user, token: result.session.token };
}

async function validateAuthentication(
  ctx: AppContext,
  options: AuthenticationOptions
): Promise<{
  user: User;
  token: string;
  type: AuthenticationType;
  service?: string;
  scope?: string[];
}> {
  const { token: parsedToken, transport } = parseAuthentication(ctx);
  let token = parsedToken;

  let user: User | null;
  let type: AuthenticationType;
  let service: string | undefined;
  let scope: string[] | undefined;

  if (!token) {
    if (!hasBetterAuthCredentials(ctx)) {
      throw AuthenticationError("Authentication required");
    }

    type = AuthenticationType.APP;

    // The request authenticates solely through its better-auth session
    // cookie, which parseAuthentication does not surface as a token.
    const result = await getUserForBetterAuthSession(ctx);

    if (!result) {
      throw AuthenticationError("Authentication required");
    }

    user = result.user;
    token = result.token ?? "";
  } else if (OAuthAuthentication.match(token)) {
    if (transport !== "header") {
      throw AuthenticationError(
        "OAuth access token must be passed in the Authorization header"
      );
    }

    type = AuthenticationType.OAUTH;

    let authentication;
    try {
      authentication = await OAuthAuthentication.findByAccessToken(token, {
        rejectOnEmpty: true,
      });
    } catch (_err) {
      throw AuthenticationError("Invalid access token");
    }
    if (!authentication) {
      throw AuthenticationError("Invalid access token");
    }
    if (authentication.accessTokenExpiresAt < new Date()) {
      throw AuthenticationError("Access token is expired");
    }
    if (!authentication.canAccess(ctx.originalUrl)) {
      throw AuthorizationError(
        "Access token does not have access to this resource"
      );
    }

    user = await User.findByPk(authentication.userId, {
      include: [
        {
          model: Team,
          as: "team",
          required: true,
        },
      ],
    });
    if (!user) {
      throw AuthenticationError("Invalid access token");
    }

    scope = authentication.scope;
    await authentication.updateActiveAt();
  } else if (ApiKey.match(token)) {
    if (transport === "cookie") {
      throw AuthenticationError("API key must not be passed in the cookie");
    }

    type = AuthenticationType.API;
    let apiKey;

    try {
      apiKey = await ApiKey.findByToken(token);
    } catch (_err) {
      throw AuthenticationError("Invalid API key");
    }

    if (!apiKey) {
      throw AuthenticationError("Invalid API key");
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      throw AuthenticationError("API key is expired");
    }

    if (!apiKey.canAccess(ctx.originalUrl)) {
      throw AuthorizationError("API key does not have access to this resource");
    }

    user = await User.findByPk(apiKey.userId, {
      include: [
        {
          model: Team,
          as: "team",
          required: true,
        },
      ],
    });

    if (!user) {
      throw AuthenticationError("Invalid API key");
    }

    scope = apiKey.scope ?? ["*"];
    await apiKey.updateActiveAt();
  } else {
    // Session tokens are long-lived, so keep them out of transports that end up
    // in browser history, referrers, and request logs. Short-lived single-use
    // tokens such as transfer are still accepted from anywhere.
    if (transport !== "cookie" && transport !== "header") {
      const payload = getJWTPayload(token);

      if (payload.type === "session") {
        throw AuthenticationError(
          "Session token must be passed in the cookie or Authorization header"
        );
      }
    }

    type = AuthenticationType.APP;

    try {
      const result = await getUserForJWT(token);
      user = result.user;
      service = result.service;
    } catch (err) {
      // Grace window: fall back to the better-auth session when the legacy
      // JWT lookup fails and the request carries better-auth credentials.
      if (!hasBetterAuthCredentials(ctx)) {
        throw err;
      }

      const result = await getUserForBetterAuthSession(ctx);

      if (!result) {
        throw err;
      }

      user = result.user;
      token = result.token ?? token;
    }
  }

  if (user.isSuspended) {
    const suspendingAdmin = user.suspendedById
      ? await User.findByPk(user.suspendedById)
      : undefined;
    throw UserSuspendedError({
      adminEmail: suspendingAdmin?.email || undefined,
    });
  }

  if (options.role && UserRoleHelper.isRoleLower(user.role, options.role)) {
    throw AuthorizationError(`${capitalize(options.role)} role required`);
  }

  if (
    options.type &&
    (Array.isArray(options.type)
      ? !options.type.includes(type)
      : type !== options.type)
  ) {
    throw AuthorizationError(`Invalid authentication type`);
  }

  return {
    user,
    type,
    token,
    service,
    scope,
  };
}
