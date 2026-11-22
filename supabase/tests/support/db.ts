import { createDatabase } from "../../../scripts/db/bootstrap.mjs";

/**
 * Thin helpers around the in-process Postgres used by the database tests.
 * `set role` + the JWT claim GUCs mirror what PostgREST does per request.
 */

export type Db = Awaited<ReturnType<typeof createDatabase>>["db"];
export type ApiRole = "anon" | "authenticated" | "service_role";

export async function openDatabase(): Promise<Db> {
  const { db } = await createDatabase();
  return db;
}

export async function rows<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function one<T = Record<string, unknown>>(
  db: Db,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const result = await rows<T>(db, sql, params);
  return result[0] ?? null;
}

/** Run as the migration/table owner, bypassing RLS. */
export async function asPostgres(db: Db): Promise<void> {
  await db.query("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', '', false), set_config('request.jwt.claim.role', '', false)",
  );
}

/** Run as an anon / authenticated / service_role request. */
export async function actAs(db: Db, userId: string | null, role: ApiRole): Promise<void> {
  await db.query("reset role");
  await db.query(
    "select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claim.role', $2, false)",
    [userId ?? "", role],
  );
  await db.query(`set role ${role}`);
}

export const IDS = {
  admin: "00000000-0000-4000-8000-000000000001",
  brandAOwner: "00000000-0000-4000-8000-000000000002",
  brandAManager: "00000000-0000-4000-8000-000000000003",
  brandAViewer: "00000000-0000-4000-8000-000000000004",
  brandAViewer2: "00000000-0000-4000-8000-000000000005",
  brandBOwner: "00000000-0000-4000-8000-000000000006",
  creator1: "00000000-0000-4000-8000-000000000007",
  creator2: "00000000-0000-4000-8000-000000000008",
  outsider: "00000000-0000-4000-8000-000000000009",
} as const;

const SIGNUPS = [
  { id: IDS.admin, email: "admin@biboh.test", role: "admin", name: "Platform Admin" },
  { id: IDS.brandAOwner, email: "owner-a@biboh.test", role: "brand", name: "Brand A Owner" },
  { id: IDS.brandAManager, email: "manager-a@biboh.test", role: "brand", name: "Brand A Manager" },
  { id: IDS.brandAViewer, email: "viewer-a@biboh.test", role: "brand", name: "Brand A Viewer" },
  { id: IDS.brandAViewer2, email: "viewer-a2@biboh.test", role: "brand", name: "Brand A Viewer 2" },
  { id: IDS.brandBOwner, email: "owner-b@biboh.test", role: "brand", name: "Brand B Owner" },
  { id: IDS.creator1, email: "creator1@biboh.test", role: "creator", name: "Creator One" },
  { id: IDS.creator2, email: "creator2@biboh.test", role: "creator", name: "Creator Two" },
  { id: IDS.outsider, email: "outsider@biboh.test", role: "creator", name: "Outsider" },
];

export type IdentitySeed = {
  brandA: string;
  brandB: string;
};

/**
 * Creates auth users (which exercises the profile trigger), promotes the
 * admin through the service role, then creates two brands with members.
 */
export async function seedIdentity(db: Db): Promise<IdentitySeed> {
  await asPostgres(db);

  for (const signup of SIGNUPS) {
    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
      [signup.id, signup.email, JSON.stringify({ role: signup.role, full_name: signup.name })],
    );
  }

  await actAs(db, null, "service_role");
  await db.query("update public.profiles set role = 'admin' where id = $1", [IDS.admin]);

  await actAs(db, IDS.brandAOwner, "authenticated");
  const [brandA] = await rows<{ id: string }>(
    db,
    "select * from public.create_brand($1::text)",
    ["Zuri Beauty"],
  );

  await db.query(
    "insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'manager'), ($1, $3, 'viewer'), ($1, $4, 'viewer')",
    [brandA!.id, IDS.brandAManager, IDS.brandAViewer, IDS.brandAViewer2],
  );

  await actAs(db, IDS.brandBOwner, "authenticated");
  const [brandB] = await rows<{ id: string }>(
    db,
    "select * from public.create_brand($1::text)",
    ["Kilele Coffee"],
  );

  await actAs(db, IDS.creator1, "authenticated");
  await db.query(
    "insert into public.creators (id, display_name, handle, niche) values ($1, 'Creator One', '@creatorone', 'beauty')",
    [IDS.creator1],
  );

  await actAs(db, IDS.creator2, "authenticated");
  await db.query(
    "insert into public.creators (id, display_name, handle, niche) values ($1, 'Creator Two', '@creatortwo', 'food')",
    [IDS.creator2],
  );

  return { brandA: brandA!.id, brandB: brandB!.id };
}
