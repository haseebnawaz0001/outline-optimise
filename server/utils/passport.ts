import type { Context } from "koa";
import { parseDomain } from "@shared/utils/domains";
import env from "@server/env";
import { Team } from "@server/models";

type TeamFromContextOptions = {
  /**
   * Whether to consider OAuth state in the context when determining the team.
   * If true, OAuth state will be used to determine the host and infer the team
   * this should only be used in the authentication process.
   */
  includeOAuthState?: boolean;
  /**
   * Whether to consider the host query parameter in the context when determining the team.
   * If true, the host query parameter will be used to determine the host and infer the team
   */
  includeHostQueryParam?: boolean;
};

/**
 * Infers the team from the context based on the hostname or OAuth state.
 *
 * @param ctx The Koa context
 * @param options Options for determining the team
 * @returns The inferred team or undefined if not found
 */
export async function getTeamFromContext(
  ctx: Context,
  options: TeamFromContextOptions = { includeOAuthState: true }
) {
  const context = getKoaContext(ctx);
  // "domain" is the domain the user came from when attempting auth
  // we use it to infer the team they intend on signing into
  const includeOAuthState = options.includeOAuthState ?? true;
  const state = includeOAuthState
    ? (context.state.oauthState ?? context.state.oauthIntent)
    : undefined;
  const queryHost =
    options.includeHostQueryParam && typeof context.query.host === "string"
      ? context.query.host
      : undefined;
  const host = state?.host ?? queryHost ?? context.hostname;
  const domain = parseDomain(host);

  let team;
  if (!env.isCloudHosted) {
    if (env.ENVIRONMENT === "test") {
      team = await Team.findByDomain(env.URL);
    } else {
      team = await Team.findOne({
        order: [["createdAt", "DESC"]],
      });
    }
  } else if (context.state?.rootShare) {
    team = await Team.findByPk(context.state.rootShare.teamId);
  } else if (domain.custom) {
    team = await Team.findByDomain(domain.host);
  } else if (domain.teamSubdomain) {
    team = await Team.findBySubdomain(domain.teamSubdomain);
  }

  return team;
}

function getKoaContext(ctx: Context): Context {
  return (ctx as Context & { ctx?: Context }).ctx ?? ctx;
}
