import Logger from "@server/logging/Logger";
import { auth } from "@server/auth/better-auth";

/**
 * Ensures the better-auth schema (ba_* tables) exists in the database,
 * creating or updating it when needed. Intended to run once per deployment
 * inside the pre-boot migration check, under the existing migrations lock.
 *
 * @throws When the schema cannot be applied, so the process fails fast
 * rather than booting with broken authentication.
 */
export async function ensureBetterAuthSchema(): Promise<void> {
  const { getMigrations } = await import("better-auth/db/migration");
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(
    auth.options
  );

  if (toBeCreated.length === 0 && toBeAdded.length === 0) {
    return;
  }

  Logger.info(
    "database",
    `Applying better-auth schema (${toBeCreated.length} tables, ${toBeAdded.length} changes)…`
  );
  await runMigrations();
}
