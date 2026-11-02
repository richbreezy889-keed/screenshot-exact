import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const repoRoot = path.resolve(scriptDir, "../..");
export const migrationsDir = path.join(repoRoot, "supabase", "migrations");

// Mirrors the grants a hosted Supabase project gives the Data API roles.
// RLS still decides which rows each role can see or change.
const DATA_API_GRANTS = `
  grant usage on schema public to anon, authenticated, service_role;
  grant all on all tables in schema public to anon, authenticated, service_role;
  grant usage, select on all sequences in schema public to anon, authenticated, service_role;
  grant execute on all functions in schema public to anon, authenticated, service_role;
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

  const migrations = await listMigrations();
  for (const file of migrations) {
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration failed: ${file}\n${error.message}`);
    }
  }

  await db.exec(DATA_API_GRANTS);
  return { db, migrations };
}
