import crypto from "node:crypto";
import fs from "node:fs";
import { QueryTypes } from "sequelize";
import { sequelize } from "@server/storage/database";

it("scratch: cleanup mechanics", async () => {
  const email = `${crypto.randomUUID()}@example.com`;
  await sequelize.query(
    'INSERT INTO ba_user (id, name, email, "emailVerified", "createdAt", "updatedAt") VALUES (:id, :name, :email, false, now(), now())',
    { replacements: { id: crypto.randomUUID(), name: "t", email } }
  );

  const before = await sequelize.query<{ id: string }>(
    "SELECT id FROM ba_user WHERE lower(email) = :email",
    { replacements: { email }, type: QueryTypes.SELECT }
  );
  const expanded = await sequelize.query(
    "SELECT id FROM ba_user WHERE email IN (:emails)",
    { replacements: { emails: [email] } }
  );

  await sequelize.query("DELETE FROM ba_user WHERE email IN (:emails)", {
    replacements: { emails: [email] },
  });

  const after = await sequelize.query<{ id: string }>(
    "SELECT id FROM ba_user WHERE lower(email) = :email",
    { replacements: { email }, type: QueryTypes.SELECT }
  );

  fs.writeFileSync(
    "/tmp/opencode/cleanup-debug.json",
    JSON.stringify({
      before: before.length,
      expandedRows: (expanded[0] as unknown[]).length,
      after: after.length,
    })
  );
});
