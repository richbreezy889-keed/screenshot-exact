import { beforeAll, describe, expect, it } from "vitest";
import { actAs, asPostgres, IDS, one, openDatabase, rows, seedIdentity, type Db } from "./support/db";

type Role = "anon" | "authenticated";
type Requested = {
  deposit_id: string;
  reference: string;
  amount: string | number | bigint;
  status: string;
};

describe("deposits (phase 2a)", () => {
  let db: Db;
  let brandA: string;
  let brandB: string;
  let confirmedReference = "";

  async function request(
    userId: string | null,
    role: Role,
    brand: string,
    amount: number,
  ): Promise<Requested> {
    await actAs(db, userId, role);
    const result = await one<Requested>(
      db,
      "select * from public.request_deposit($1::uuid, $2::bigint)",
      [brand, amount],
    );
    return result!;
  }

  async function confirm(reference: string, providerRef: string, amount: number): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ id: string }>(
      db,
      "select public.confirm_deposit($1::text, $2::text, $3::bigint) as id",
      [reference, providerRef, amount],
    );
    return result!.id;
  }

  async function fail(reference: string): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ s: string }>(
      db,
      "select public.fail_deposit($1::text, null::text) as s",
      [reference],
    );
    return result!.s;
  }

  async function wallet(brand: string, ownerId: string): Promise<number> {
    await actAs(db, ownerId, "authenticated");
    const result = await one<{ b: string | number | bigint }>(
      db,
      "select public.brand_wallet_summary($1::uuid) as b",
      [brand],
    );
    return Number(result!.b);
  }

  async function selcomHeld(): Promise<number> {
    await actAs(db, null, "service_role");
    const result = await one<{ b: string | number | bigint }>(
      db,
      "select public.ledger_balance(public.ledger_ensure_account('selcom_holdings')) as b",
    );
    return Number(result!.b);
  }

  beforeAll(async () => {
    db = await openDatabase();
    const ids = await seedIdentity(db);
    brandA = ids.brandA;
    brandB = ids.brandB;
  });

  it("lets an owner and a manager request a deposit", async () => {
    const first = await request(IDS.brandAOwner, "authenticated", brandA, 50_000);
    expect(first.reference).toMatch(/^BD[0-9A-F]{16}$/);
    expect(first.status).toBe("pending");
    expect(Number(first.amount)).toBe(50_000);

    const second = await request(IDS.brandAManager, "authenticated", brandA, 20_000);
    expect(second.reference).not.toBe(first.reference);
  });

  it("refuses everyone else", async () => {
    for (const userId of [IDS.brandAViewer, IDS.creator1, IDS.brandBOwner]) {
      await expect(request(userId, "authenticated", brandA, 5_000)).rejects.toThrow(
        /not allowed to deposit/,
      );
    }
    await expect(request(null, "anon", brandA, 5_000)).rejects.toThrow(/permission denied/);
  });

  it("keeps deposits inside the amount limits", async () => {
    await expect(request(IDS.brandAOwner, "authenticated", brandA, 999)).rejects.toThrow(
      /deposit amount must be between/,
    );
    await expect(request(IDS.brandAOwner, "authenticated", brandA, 50_000_001)).rejects.toThrow(
      /deposit amount must be between/,
    );
  });

  it("caps pending deposits per brand", async () => {
    for (let index = 0; index < 10; index += 1) {
      await request(IDS.brandBOwner, "authenticated", brandB, 5_000);
    }
    await expect(request(IDS.brandBOwner, "authenticated", brandB, 5_000)).rejects.toThrow(
      /too many pending deposits/,
    );
  });

  it("credits the wallet once when Selcom confirms", async () => {
    const requested = await request(IDS.brandAOwner, "authenticated", brandA, 100_000);
    const walletBefore = await wallet(brandA, IDS.brandAOwner);
    const selcomBefore = await selcomHeld();

    const txn = await confirm(requested.reference, "SEL-1", 100_000);
    confirmedReference = requested.reference;

    expect(await wallet(brandA, IDS.brandAOwner)).toBe(walletBefore + 100_000);
    expect(await selcomHeld()).toBe(selcomBefore + 100_000);

    expect(await confirm(requested.reference, "SEL-1", 100_000)).toBe(txn);
    expect(await wallet(brandA, IDS.brandAOwner)).toBe(walletBefore + 100_000);
    expect(await selcomHeld()).toBe(selcomBefore + 100_000);

    await actAs(db, IDS.brandAOwner, "authenticated");
    const listed = await rows<{ reference: string; status: string }>(
      db,
      "select * from public.list_brand_deposits($1::uuid)",
      [brandA],
    );
    expect(listed.find((r) => r.reference === requested.reference)?.status).toBe("confirmed");
  });

  it("refuses wrong amounts, unknown references and a changed provider reference", async () => {
    const requested = await request(IDS.brandAOwner, "authenticated", brandA, 30_000);

    await expect(confirm(requested.reference, "SEL-2", 29_999)).rejects.toThrow(/amount mismatch/);
    await expect(confirm("BDNOSUCHREFERENCE", "SEL-X", 1_000)).rejects.toThrow(
      /unknown deposit reference/,
    );
    await expect(confirm(requested.reference, "  ", 30_000)).rejects.toThrow(
      /provider reference is required/,
    );

    await confirm(requested.reference, "SEL-2", 30_000);
    await expect(confirm(requested.reference, "SEL-OTHER", 30_000)).rejects.toThrow(
      /different provider reference/,
    );
  });

  it("refuses one Selcom payment crediting two deposits", async () => {
    const first = await request(IDS.brandAOwner, "authenticated", brandA, 10_000);
    const second = await request(IDS.brandAOwner, "authenticated", brandA, 10_000);

    await confirm(first.reference, "SEL-DUP", 10_000);
    const walletBefore = await wallet(brandA, IDS.brandAOwner);

    await expect(confirm(second.reference, "SEL-DUP", 10_000)).rejects.toThrow(
      /duplicate key|unique/,
    );
    expect(await wallet(brandA, IDS.brandAOwner)).toBe(walletBefore);
  });

  it("handles failures and repeats", async () => {
    const requested = await request(IDS.brandAOwner, "authenticated", brandA, 15_000);

    expect(await fail(requested.reference)).toBe("failed");
    expect(await fail(requested.reference)).toBe("failed");
    await expect(confirm(requested.reference, "SEL-F", 15_000)).rejects.toThrow(
      /marked failed/,
    );
    await expect(fail(confirmedReference)).rejects.toThrow(/confirmed deposit cannot be failed/);
  });

  it("expires stale pending deposits and still credits a late payment", async () => {
    await asPostgres(db);
    await db.query(
      `insert into ledger.deposits (brand_id, amount, reference, requested_by, created_at)
       values ($1, 40000, 'BDOLD000000000001', $2, now() - interval '2 days')`,
      [brandA, IDS.brandAOwner],
    );

    await actAs(db, null, "service_role");
    const expired = await one<{ n: string | number | bigint }>(
      db,
      "select public.expire_stale_deposits('24 hours'::interval) as n",
    );
    expect(Number(expired!.n)).toBe(1);

    await asPostgres(db);
    const status = await one<{ status: string }>(
      db,
      "select status from ledger.deposits where reference = 'BDOLD000000000001'",
    );
    expect(status!.status).toBe("expired");

    const walletBefore = await wallet(brandA, IDS.brandAOwner);
    await confirm("BDOLD000000000001", "SEL-LATE", 40_000);
    expect(await wallet(brandA, IDS.brandAOwner)).toBe(walletBefore + 40_000);
  });

  it("shows the wallet only to brand members", async () => {
    const ownerView = await wallet(brandA, IDS.brandAOwner);
    expect(await wallet(brandA, IDS.brandAViewer)).toBe(ownerView);

    await actAs(db, IDS.creator1, "authenticated");
    await expect(
      db.query("select public.brand_wallet_summary($1::uuid)", [brandA]),
    ).rejects.toThrow(/not allowed to view/);

    await actAs(db, IDS.brandBOwner, "authenticated");
    await expect(
      db.query("select * from public.list_brand_deposits($1::uuid)", [brandA]),
    ).rejects.toThrow(/not allowed to view/);

    await actAs(db, null, "anon");
    await expect(
      db.query("select public.brand_wallet_summary($1::uuid)", [brandA]),
    ).rejects.toThrow(/permission denied/);

    await actAs(db, IDS.brandAViewer, "authenticated");
    const aList = await rows<{ reference: string }>(
      db,
      "select * from public.list_brand_deposits($1::uuid)",
      [brandA],
    );
    await actAs(db, IDS.brandBOwner, "authenticated");
    const bList = await rows<{ reference: string }>(
      db,
      "select * from public.list_brand_deposits($1::uuid)",
      [brandB],
    );
    expect(aList.length).toBeGreaterThan(0);
    expect(bList.length).toBe(10);
    const aRefs = new Set(aList.map((r) => r.reference));
    expect(bList.some((r) => aRefs.has(r.reference))).toBe(false);
  });

  it("keeps the deposits table out of reach and immutable", async () => {
    await actAs(db, IDS.brandAOwner, "authenticated");
    await expect(db.query("select * from ledger.deposits")).rejects.toThrow(/permission denied/);

    await asPostgres(db);
    const confirmed = await one<{ id: string }>(
      db,
      "select id from ledger.deposits where status = 'confirmed' limit 1",
    );
    expect(confirmed).not.toBeNull();

    await expect(
      db.query("update ledger.deposits set amount = amount + 1 where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/deposit details cannot change/);
    await expect(
      db.query("update ledger.deposits set status = 'pending' where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/invalid deposit status change/);
    await expect(
      db.query("delete from ledger.deposits where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/cannot be deleted/);
  });

  it("keeps the ledger consistent after all of it", async () => {
    await actAs(db, null, "service_role");
    const report = await rows<{ check_name: string; ok: boolean; detail: string }>(
      db,
      "select * from public.ledger_integrity_report()",
    );
    expect(report).toHaveLength(4);
    for (const row of report) {
      expect(row.ok, `${row.check_name}: ${row.detail}`).toBe(true);
    }
  });
});