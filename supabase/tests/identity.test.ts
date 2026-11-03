import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  actAs,
  asPostgres,
  IDS,
  one,
  openDatabase,
  rows,
  seedIdentity,
  type Db,
} from "./support/db";

const TABLES = [
  "platform_settings",
  "profiles",
  "brands",
  "brand_members",
  "creators",
  "social_accounts",
] as const;

let db: Db;
let brandA: string;
let brandB: string;

beforeAll(async () => {
  db = await openDatabase();
  ({ brandA, brandB } = await seedIdentity(db));
});

afterAll(async () => {
  await db.close();
});

describe("schema and RLS basics", () => {
  it("enables RLS on every identity table", async () => {
    const found = await rows<{ name: string; rls: boolean }>(
      db,
      `select c.relname as name, c.relrowsecurity as rls
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public'
         and c.relkind = 'r'
         and c.relname in ('platform_settings','profiles','brands','brand_members','creators','social_accounts')
       order by c.relname`,
    );

    expect(found.map((row) => row.name)).toEqual([...TABLES].sort());
    expect(found.every((row) => row.rls)).toBe(true);
  });

  it("has an index for every foreign key and every expected FK index", async () => {
    const uncovered = await rows<{ table_name: string; conname: string }>(
      db,
      `select c.conrelid::regclass::text as table_name, c.conname
       from pg_constraint c
       where c.contype = 'f'
         and c.connamespace = 'public'::regnamespace
         and not exists (
           select 1
           from pg_index i
           where i.indrelid = c.conrelid
             and i.indisvalid
             and (string_to_array(i.indkey::text, ' ')::int2[])[1:array_length(c.conkey, 1)] = c.conkey
         )`,
    );
    expect(uncovered).toEqual([]);

    const indexes = await rows<{ indexname: string }>(
      db,
      "select indexname from pg_indexes where schemaname = 'public'",
    );
    expect(indexes.map((row) => row.indexname)).toEqual(
      expect.arrayContaining([
        "brands_created_by_idx",
        "brand_members_user_id_idx",
        "brand_members_invited_by_idx",
        "social_accounts_creator_id_idx",
      ]),
    );
  });

  it("keeps platform_settings to exactly one seeded row", async () => {
    const settings = await rows(db, "select id, platform_name, fee_bps from public.platform_settings");
    expect(settings).toHaveLength(1);
    expect(settings[0]).toMatchObject({ id: true, platform_name: "Biboh", fee_bps: 1500 });
  });
});

describe("signup trigger", () => {
  it("creates profiles and only trusts brand/creator metadata roles", async () => {
    await asPostgres(db);
    const seeded = await rows<{ id: string; role: string; full_name: string | null; email: string | null }>(
      db,
      "select id, role, full_name, email from public.profiles where id in ($1, $2, $3, $4) order by id",
      [IDS.admin, IDS.brandAOwner, IDS.creator1, IDS.outsider],
    );
    expect(seeded.find((row) => row.id === IDS.admin)).toMatchObject({ role: "admin" });
    expect(seeded.find((row) => row.id === IDS.brandAOwner)).toMatchObject({
      role: "brand",
      full_name: "Brand A Owner",
      email: "owner-a@biboh.test",
    });
    expect(seeded.find((row) => row.id === IDS.creator1)).toMatchObject({
      role: "creator",
      full_name: "Creator One",
    });

    await asPostgres(db);
    const extras = [
      { id: "00000000-0000-4000-8000-000000000010", role: "admin", email: "sneaky-admin@biboh.test" },
      { id: "00000000-0000-4000-8000-000000000011", role: "superuser", email: "sneaky-super@biboh.test" },
      { id: "00000000-0000-4000-8000-000000000012", role: "", email: "empty-role@biboh.test" },
      { id: "00000000-0000-4000-8000-000000000013", role: "brand", email: "new-brand@biboh.test" },
    ];
    for (const extra of extras) {
      await db.query(
        "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)",
        [extra.id, extra.email, JSON.stringify({ role: extra.role, full_name: extra.email })],
      );
    }

    const created = await rows<{ id: string; role: string; full_name: string }>(
      db,
      "select id, role, full_name from public.profiles where id in ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013') order by id",
    );
    expect(created.map((row) => row.role)).toEqual(["creator", "creator", "creator", "brand"]);

    await db.query(
      "delete from auth.users where id in ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000013')",
    );
  });
});

describe("anon access", () => {
  it("has no privileges on any table or view", async () => {
    await actAs(db, null, "anon");

    const tables = [
      "profiles",
      "brands",
      "brand_members",
      "creators",
      "social_accounts",
      "campaigns",
      "applications",
      "submissions",
      "view_checkpoints",
      "platform_settings",
      "campaigns_public",
    ] as const;

    for (const table of tables) {
      await expect(
        db.query(`select count(*)::int as n from public.${table}`),
      ).rejects.toThrow(/permission denied/);
    }
  });
});

describe("access helpers", () => {
  it("reports admin, membership and roles without leaking other brands", async () => {
    await actAs(db, IDS.admin, "authenticated");
    expect(await one(db, "select public.is_admin() as v")).toMatchObject({ v: true });

    await actAs(db, IDS.brandAOwner, "authenticated");
    expect(await one(db, "select public.is_admin() as v")).toMatchObject({ v: false });
    expect(await one(db, "select public.is_brand_member($1) as v", [brandA])).toMatchObject({ v: true });
    expect(await one(db, "select public.is_brand_member($1) as v", [brandB])).toMatchObject({ v: false });
    expect(await one(db, "select public.brand_role($1) as v", [brandA])).toMatchObject({ v: "owner" });
    expect(await one(db, "select public.brand_role($1) as v", [brandB])).toMatchObject({ v: null });
    expect(await one(db, "select public.can_manage_brand($1) as v", [brandA])).toMatchObject({ v: true });

    await actAs(db, IDS.brandAManager, "authenticated");
    expect(await one(db, "select public.brand_role($1) as v", [brandA])).toMatchObject({ v: "manager" });

    await actAs(db, IDS.brandAViewer, "authenticated");
    expect(await one(db, "select public.brand_role($1) as v", [brandA])).toMatchObject({ v: "viewer" });
    expect(await one(db, "select public.can_manage_brand($1) as v", [brandA])).toMatchObject({ v: false });

    await actAs(db, IDS.creator1, "authenticated");
    expect(await one(db, "select public.is_creator() as v")).toMatchObject({ v: true });
    expect(await one(db, "select public.is_brand_member($1) as v", [brandA])).toMatchObject({ v: false });
  });
});

describe("platform settings writes", () => {
  it("only lets admins change settings", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    const denied = await db.query(
      "update public.platform_settings set platform_name = 'Hacked' returning platform_name",
    );
    expect(denied.rows).toHaveLength(0);

    await actAs(db, IDS.admin, "authenticated");
    const allowed = await db.query(
      "update public.platform_settings set platform_name = 'Biboh TZ' returning platform_name",
    );
    expect(allowed.rows).toHaveLength(1);

    await asPostgres(db);
    expect(await one(db, "select platform_name from public.platform_settings")).toMatchObject({
      platform_name: "Biboh TZ",
    });
    await db.query("update public.platform_settings set platform_name = 'Biboh'");

    await actAs(db, null, "service_role");
    await expect(
      db.query("insert into public.platform_settings (id) values (false)"),
    ).rejects.toThrow(/platform_settings_single_row/);
  });
});

describe("profile self-service", () => {
  it("lets users edit their own profile but not role or verification", async () => {
    await actAs(db, IDS.outsider, "authenticated");
    const updated = await db.query(
      "update public.profiles set full_name = 'Outsider Updated' where id = $1 returning full_name",
      [IDS.outsider],
    );
    expect(updated.rows).toHaveLength(1);

    await expect(
      db.query("update public.profiles set role = 'brand' where id = $1", [IDS.outsider]),
    ).rejects.toThrow(/only be changed by an admin/);

    await expect(
      db.query("update public.profiles set phone_verified_at = now() where id = $1", [IDS.outsider]),
    ).rejects.toThrow(/only be changed by an admin/);

    await actAs(db, IDS.admin, "authenticated");
    const adminEdit = await db.query(
      "update public.profiles set role = 'brand', phone_verified_at = now() where id = $1 returning role, phone_verified_at",
      [IDS.outsider],
    );
    expect(adminEdit.rows).toHaveLength(1);
    expect(adminEdit.rows[0]).toMatchObject({ role: "brand" });

    await actAs(db, null, "service_role");
    await db.query("update public.profiles set role = 'creator', phone_verified_at = null where id = $1", [
      IDS.outsider,
    ]);
  });

  it("does not let users edit someone else's profile", async () => {
    await actAs(db, IDS.creator1, "authenticated");
    const result = await db.query(
      "update public.profiles set full_name = 'Nope' where id = $1 returning id",
      [IDS.creator2],
    );
    expect(result.rows).toHaveLength(0);
  });
});

describe("brand isolation", () => {
  it("shows a brand only its own row, members and teammate profiles", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    const brands = await rows<{ id: string }>(db, "select id from public.brands");
    expect(brands.map((row) => row.id)).toEqual([brandA]);

    const members = await rows<{ user_id: string }>(db, "select user_id from public.brand_members");
    expect(members.map((row) => row.user_id).sort()).toEqual(
      [IDS.brandAOwner, IDS.brandAManager, IDS.brandAViewer, IDS.brandAViewer2].sort(),
    );

    const profiles = await rows<{ id: string }>(db, "select id from public.profiles");
    expect(profiles.map((row) => row.id).sort()).toEqual(
      [IDS.brandAOwner, IDS.brandAManager, IDS.brandAViewer, IDS.brandAViewer2].sort(),
    );

    const crossUpdate = await db.query(
      "update public.brands set description = 'taken over' where id = $1 returning id",
      [brandB],
    );
    expect(crossUpdate.rows).toHaveLength(0);

    const crossDelete = await db.query("delete from public.brands where id = $1 returning id", [brandB]);
    expect(crossDelete.rows).toHaveLength(0);

    await asPostgres(db);
    expect(await one(db, "select id from public.brands where id = $1", [brandB])).not.toBeNull();
  });

  it("keeps the other brand and creators out of view", async () => {
    await actAs(db, IDS.brandBOwner, "authenticated");
    const brands = await rows<{ id: string }>(db, "select id from public.brands");
    expect(brands.map((row) => row.id)).toEqual([brandB]);

    const profiles = await rows<{ id: string }>(db, "select id from public.profiles");
    expect(profiles.map((row) => row.id)).toEqual([IDS.brandBOwner]);

    await actAs(db, IDS.creator1, "authenticated");
    expect(await rows(db, "select id from public.brands")).toHaveLength(0);
    expect(await rows(db, "select * from public.brand_members")).toHaveLength(0);
    const self = await rows<{ id: string }>(db, "select id from public.profiles");
    expect(self.map((row) => row.id)).toEqual([IDS.creator1]);
  });
});

describe("brand member permissions", () => {
  it("allows managers to edit the brand but not member roles", async () => {
    await actAs(db, IDS.brandAViewer, "authenticated");
    const viewerEdit = await db.query(
      "update public.brands set description = 'viewer edit' where id = $1 returning id",
      [brandA],
    );
    expect(viewerEdit.rows).toHaveLength(0);

    await actAs(db, IDS.brandAManager, "authenticated");
    const managerEdit = await db.query(
      "update public.brands set description = 'manager edit' where id = $1 returning id",
      [brandA],
    );
    expect(managerEdit.rows).toHaveLength(1);

    await expect(
      db.query(
        "insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'viewer')",
        [brandA, IDS.outsider],
      ),
    ).rejects.toThrow(/row-level security/);

    await actAs(db, IDS.brandAOwner, "authenticated");
    const invited = await db.query(
      "insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'viewer') returning user_id",
      [brandA, IDS.outsider],
    );
    expect(invited.rows).toHaveLength(1);

    await actAs(db, IDS.brandAManager, "authenticated");

    const promote = await db.query(
      "update public.brand_members set role = 'manager' where brand_id = $1 and user_id = $2 returning role",
      [brandA, IDS.outsider],
    );
    expect(promote.rows).toHaveLength(0);

    await actAs(db, IDS.brandAViewer, "authenticated");
    await expect(
      db.query(
        "insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'viewer')",
        [brandA, IDS.creator2],
      ),
    ).rejects.toThrow(/row-level security/);

    await actAs(db, IDS.brandAManager, "authenticated");
    const remove = await db.query(
      "delete from public.brand_members where brand_id = $1 and user_id = $2 returning user_id",
      [brandA, IDS.outsider],
    );
    expect(remove.rows).toHaveLength(0);
  });

  it("lets the owner manage members but never remove or demote the owner", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");

    const promote = await db.query(
      "update public.brand_members set role = 'manager' where brand_id = $1 and user_id = $2 returning role",
      [brandA, IDS.outsider],
    );
    expect(promote.rows).toHaveLength(1);

    const remove = await db.query(
      "delete from public.brand_members where brand_id = $1 and user_id = $2 returning user_id",
      [brandA, IDS.outsider],
    );
    expect(remove.rows).toHaveLength(1);

    await expect(
      db.query("update public.brand_members set role = 'viewer' where brand_id = $1 and user_id = $2", [
        brandA,
        IDS.brandAOwner,
      ]),
    ).rejects.toThrow(/owner cannot be demoted/);

    await expect(
      db.query("delete from public.brand_members where brand_id = $1 and user_id = $2", [
        brandA,
        IDS.brandAOwner,
      ]),
    ).rejects.toThrow(/owner cannot be removed/);

    const owners = await one<{ n: number }>(
      db,
      "select count(*)::int as n from public.brand_members where brand_id = $1 and role = 'owner'",
      [brandA],
    );
    expect(owners?.n).toBe(1);
  });

  it("enforces one owner per brand at the database level", async () => {
    await actAs(db, null, "service_role");
    await expect(
      db.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'owner')", [
        brandA,
        IDS.creator1,
      ]),
    ).rejects.toThrow(/brand_members_one_owner_idx|duplicate key/);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(
      db.query("insert into public.brand_members (brand_id, user_id, role) values ($1, $2, 'owner')", [
        brandA,
        IDS.creator2,
      ]),
    ).rejects.toThrow(/row-level security/);
  });
});

describe("create_brand", () => {
  it("requires an authenticated brand account", async () => {
    await actAs(db, IDS.creator1, "authenticated");
    await expect(db.query("select public.create_brand('Creator Co')")).rejects.toThrow(
      /only brand accounts can create brands/,
    );

    await actAs(db, null, "anon");
    await expect(db.query("select public.create_brand('Anon Co')")).rejects.toThrow(
      /authentication required/,
    );
  });

  it("creates the brand and owner membership atomically", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    const [created] = await rows<{ id: string; name: string; created_by: string }>(
      db,
      "select * from public.create_brand($1::text)",
      ["  Temp Brand  "],
    );
    expect(created).toMatchObject({ name: "Temp Brand", created_by: IDS.brandAOwner });

    const owner = await one<{ role: string }>(
      db,
      "select role from public.brand_members where brand_id = $1 and user_id = $2",
      [created!.id, IDS.brandAOwner],
    );
    expect(owner).toMatchObject({ role: "owner" });

    // Only an admin may delete a brand (its campaign history must survive).
    const ownerDelete = await db.query("delete from public.brands where id = $1 returning id", [created!.id]);
    expect(ownerDelete.rows).toHaveLength(0);

    await actAs(db, IDS.admin, "authenticated");
    const deleted = await db.query("delete from public.brands where id = $1 returning id", [created!.id]);
    expect(deleted.rows).toHaveLength(1);

    await asPostgres(db);
    expect(
      await rows(db, "select * from public.brand_members where brand_id = $1", [created!.id]),
    ).toHaveLength(0);
  });
});

describe("creators", () => {
  it("only lets a creator create and edit their own creator row", async () => {
    await actAs(db, IDS.creator1, "authenticated");
    const own = await db.query(
      "update public.creators set display_name = 'Creator One Updated' where id = $1 returning display_name",
      [IDS.creator1],
    );
    expect(own.rows).toHaveLength(1);

    await expect(
      db.query("insert into public.creators (id, display_name) values ($1, 'Fake')", [IDS.creator2]),
    ).rejects.toThrow(/row-level security/);

    const other = await db.query(
      "update public.creators set display_name = 'Hijacked' where id = $1 returning id",
      [IDS.creator2],
    );
    expect(other.rows).toHaveLength(0);

    const deleted = await db.query("delete from public.creators where id = $1 returning id", [IDS.creator1]);
    expect(deleted.rows).toHaveLength(0);

    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(
      db.query("insert into public.creators (id, display_name) values ($1, 'Brand Fake')", [
        IDS.brandAOwner,
      ]),
    ).rejects.toThrow(/row-level security/);
  });

  it("shows creators to signed-in users but not anon", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    const visible = await rows<{ id: string }>(db, "select id from public.creators order by id");
    expect(visible.map((row) => row.id)).toEqual([IDS.creator1, IDS.creator2].sort());

    await actAs(db, null, "anon");
    await expect(db.query("select id from public.creators")).rejects.toThrow(/permission denied/);
  });

  it("does not let another creator read a creator's profile", async () => {
    await actAs(db, IDS.creator2, "authenticated");
    expect(
      await rows(db, "select id from public.profiles where id = $1", [IDS.creator1]),
    ).toHaveLength(0);
    expect(
      await rows(db, "select id from public.creators where id = $1", [IDS.creator1]),
    ).toHaveLength(0);
  });
});

describe("social accounts", () => {
  it("lets a creator manage their own accounts but not verification", async () => {
    await actAs(db, IDS.creator1, "authenticated");
    const inserted = await db.query(
      "insert into public.social_accounts (creator_id, platform, handle, followers) values ($1, 'tiktok', '@creatorone', 1200) returning id",
      [IDS.creator1],
    );
    expect(inserted.rows).toHaveLength(1);

    await expect(
      db.query(
        "insert into public.social_accounts (creator_id, platform, handle, verified_at) values ($1, 'instagram', '@verifiedtry', now())",
        [IDS.creator1],
      ),
    ).rejects.toThrow(/verification is admin-only/);

    await expect(
      db.query(
        "insert into public.social_accounts (creator_id, platform, handle) values ($1, 'youtube', '@fake')",
        [IDS.creator2],
      ),
    ).rejects.toThrow(/row-level security/);

    const edited = await db.query(
      "update public.social_accounts set followers = 5000 where creator_id = $1 returning followers",
      [IDS.creator1],
    );
    expect(edited.rows).toHaveLength(1);

    await expect(
      db.query("update public.social_accounts set verified_at = now() where creator_id = $1", [
        IDS.creator1,
      ]),
    ).rejects.toThrow(/verification is admin-only/);

    await actAs(db, IDS.creator2, "authenticated");
    const hijack = await db.query(
      "update public.social_accounts set handle = '@hijack' where creator_id = $1 returning id",
      [IDS.creator1],
    );
    expect(hijack.rows).toHaveLength(0);
  });

  it("lets admins verify an account", async () => {
    await actAs(db, IDS.admin, "authenticated");
    const verified = await db.query(
      "update public.social_accounts set verified_at = now() where creator_id = $1 returning verified_at",
      [IDS.creator1],
    );
    expect(verified.rows).toHaveLength(1);
    expect(verified.rows[0]?.verified_at).not.toBeNull();
  });

  it("is readable by signed-in users but not anon", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    expect(await rows(db, "select id from public.social_accounts")).toHaveLength(1);

    await actAs(db, null, "anon");
    await expect(
      db.query("select id from public.social_accounts"),
    ).rejects.toThrow(/permission denied/);
  });

  it("does not let another creator read a creator's social accounts", async () => {
    await actAs(db, IDS.creator2, "authenticated");
    expect(
      await rows(db, "select id from public.social_accounts where creator_id = $1", [IDS.creator1]),
    ).toHaveLength(0);
  });
});

describe("table and view privileges (A4)", () => {
  it("anon has no privileges on any table and none on campaigns_public", async () => {
    await actAs(db, null, "anon");

    const anonGrants = await rows<{ table_name: string; privilege_type: string }>(
      db,
      `select table_name, privilege_type
       from information_schema.role_table_grants
       where grantee = 'anon'
       order by table_name, privilege_type`,
    );

    expect(anonGrants).toEqual([]);

    const authenticatedGrants = await rows<{ table_name: string; privilege_type: string }>(
      db,
      `select table_name, privilege_type
       from information_schema.role_table_grants
       where grantee = 'authenticated'
       order by table_name, privilege_type`,
    );

    // Print the authenticated privilege list for the report.
    // eslint-disable-next-line no-console
    console.log("Authenticated table/view privileges:");
    for (const row of authenticatedGrants) {
      // eslint-disable-next-line no-console
      console.log(`  ${row.table_name}: ${row.privilege_type}`);
    }

    // anon must have nothing on campaigns_public specifically
    const campaignsPublicGrants = await rows<{ table_name: string; privilege_type: string }>(
      db,
      `select table_name, privilege_type
       from information_schema.role_table_grants
       where grantee = 'anon' and table_name = 'campaigns_public'`,
    );
    expect(campaignsPublicGrants).toEqual([]);
  });
});
