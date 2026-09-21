// Applies every SQL file in db/migrations, in name order, against DATABASE_URL.
// Each file is idempotent (create ... if not exists), so re-running is safe.
//
//   DATABASE_URL=postgres://... npm run db:migrate
//
// Locally you can pull the value with `vercel env pull` after linking the
// Neon integration, or copy it from the Neon console.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { neon } from "@neondatabase/serverless";

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "db",
  "migrations",
);

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = neon(databaseUrl);
const files = (await readdir(migrationsDir))
  .filter((file) => file.endsWith(".sql"))
  .sort();

for (const file of files) {
  const statements = await readFile(path.join(migrationsDir, file), "utf8");
  console.log(`Applying ${file}`);
  await sql.transaction(
    statements
      .split(/;\s*(?:\r?\n|$)/)
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => sql.query(statement)),
  );
}

console.log(`Applied ${files.length} migration file(s).`);
