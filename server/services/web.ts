/* oxlint-disable @typescript-eslint/no-var-requires */
import { Server } from "node:https";
import { constants as zlibConstants } from "node:zlib";
import type { BaseContext } from "koa";
import Koa from "koa";
import compress from "koa-compress";
import { dnsPrefetchControl, referrerPolicy } from "koa-helmet";
import mount from "koa-mount";
import enforceHttps, {
  httpsResolver,
  xForwardedProtoResolver,
} from "koa-sslify";
import env from "@server/env";
import { authHandler } from "@server/auth/better-auth";
import Logger from "@server/logging/Logger";
import csp from "@server/middlewares/csp";
import { attachCSRFToken } from "@server/middlewares/csrf";
import { initI18n } from "@server/utils/i18n";
import routes from "../routes";
import api from "../routes/api";
import mcp from "../routes/mcp";
import oauth from "../routes/oauth";
import type { UserAgentContext } from "koa-useragent";
import userAgent from "koa-useragent";

/**
 * Handles requests to the better-auth mount point (`/api/auth/*`) by handing
 * the raw Node request/response to the better-auth handler. Must run before
 * any body-parsing middleware.
 */
function betterAuthHandler() {
  return async (ctx: { path: string; req: unknown; res: unknown }, next: () => Promise<void>) => {
    if (!ctx.path.startsWith("/api/auth/") && ctx.path !== "/api/auth") {
      await next();
      return;
    }
    await authHandler(
      ctx.req as Parameters<typeof authHandler>[0],
      ctx.res as Parameters<typeof authHandler>[1]
    );
  };
}

export default function init(app: Koa = new Koa(), server?: Server) {
  void initI18n();

  if (env.isProduction) {
    // Trust the X-Forwarded-* headers set by an upstream proxy, eg
    // X-Forwarded-For. Defaults to true, but can be disabled with
    // PROXY_HEADERS_TRUSTED when the app is reachable directly.
    if (env.PROXY_HEADERS_TRUSTED) {
      app.proxy = true;
      if (env.PROXY_IP_HEADER) {
        app.proxyIpHeader = env.PROXY_IP_HEADER;
      }
    } else if (env.URL.startsWith("https://") && !(server instanceof Server)) {
      // TLS is terminated upstream, but without X-Forwarded-Proto the app
      // cannot tell, so the CSRF token falls back to a cookie that a sibling
      // subdomain is able to write.
      Logger.warn(
        "PROXY_HEADERS_TRUSTED is disabled while URL is https and the app is not terminating TLS itself, which weakens CSRF protection. Enable it when running behind a proxy that terminates TLS."
      );
    }

    // Force redirect to HTTPS protocol unless explicitly disabled
    if (env.FORCE_HTTPS) {
      app.use(
        enforceHttps({
          resolver: (ctx) => {
            if (httpsResolver(ctx)) {
              return true;
            }
            // Only honor X-Forwarded-Proto when proxy headers are trusted
            return env.PROXY_HEADERS_TRUSTED
              ? xForwardedProtoResolver(ctx)
              : false;
          },
        })
      );
    } else {
      Logger.warn("Enforced https was disabled with FORCE_HTTPS env variable");
    }
  }

  // Make `ctx.userAgent` available
  app.use<BaseContext, UserAgentContext>(userAgent);

  app.use(
    compress({
      threshold: 2048,
      br: {
        params: {
          [zlibConstants.BROTLI_PARAM_QUALITY]: 3,
        },
      },
    })
  );

  app.use(betterAuthHandler());
  app.use(mount("/api", api));
  app.use(mount("/mcp", mcp));

  // Generate and attach a CSRF token to the session on non-API requests
  app.use(attachCSRFToken());

  // Apply CSP middleware after API as these responses are rendered in the browser
  app.use(csp());

  // Allow DNS prefetching for performance, we do not care about leaking requests
  // to our own CDN's
  app.use(
    dnsPrefetchControl({
      allow: true,
    })
  );
  app.use(
    referrerPolicy({
      policy: "no-referrer",
    })
  );

  app.use(mount("/oauth", oauth));
  app.use(mount(routes));

  return app;
}
