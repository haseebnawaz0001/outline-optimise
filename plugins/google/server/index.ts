import config from "../plugin.json";

/**
 * The Google authentication provider was removed in favor of better-auth.
 * This entrypoint registers no hooks; it exists so the PluginManager glob
 * continues to resolve the plugin. The OAuth client in `./google` is
 * retained only for validating tokens of pre-existing user authentications.
 */
export const plugin = config;
