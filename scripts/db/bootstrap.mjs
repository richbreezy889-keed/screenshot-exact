import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "../..");
export const migrationsDir = path.join(repoRoot, "supabase", "migrations");

// Mirrors the grants a hosted Supabase project gives the Data API roles.
// These are default privileges so migrations can still REVOKE access to an
// individual table or view after it is created. RLS decides the rows.
const DEFAULT_PRIVILEGES = `
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public
    grant execute on functions to anon, authenticated, service_role;
`;

export async function listMigrations() {
  let entries = [];
  try {
    entries = await readdir(migrationsDir);
  } catch {
    return [];
  }
  return entries.filter((file) => file.endsWith(".sql")).sort();
}

/**
 * Boots an in-process Postgres (PGlite) with the Supabase shim and every
 * migration applied in filename order.
 */
export async function createDatabase({ dataDir } = {}) {
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;

  const shim = await readFile(path.join(scriptDir, "shim.sql"), "utf8");
  await db.exec(shim);
  await db.exec(DEFAULT_PRIVILEGES);

  const migrations = await listMigrations();
  for (const file of migrations) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration failed: ${file}\n${error.message}`);
    }
  }

  return { db, migrations };
}
