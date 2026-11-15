import { beforeAll, describe, expect, it } from "vitest";
import { actAs, asPostgres, IDS, one, openDatabase, rows, seedIdentity, type Db } from "./support/db";

type Role = "anon" | "authenticated";
type Requested = {
  payout_id: string;
  reference: string;
  amount: string | number | bigint;
  destination: string;
  status: string;
};

describe("creator payouts (phase 2c)", () => {
  let db: Db;
  let seedSeq = 0;
  let firstReference = "";
  const DEST = "0712345678";

  async function ensure(kind: string, creator: string | null = null): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ id: string }>(
      db,
      "select public.ledger_ensure_account($1::text, null::uuid, null::uuid, $2::uuid) as id",
      [kind, creator],
    );
    return result!.id;
  }

  async function balance(id: string): Promise<number> {
    await actAs(db, null, "service_role");
    const result = await one<{ b: string | number | bigint }>(
      db,
      "select public.ledger_balance($1::uuid) as b",
      [id],
    );
    return Number(result!.b);
  }

  const payableOf = async (creator: string) => balance(await ensure("creator_payable", creator));
  const transitBalance = async () => balance(await ensure("payout_in_transit"));
  const selcomBalance = async () => balance(await ensure("selcom_holdings"));

  async function seedPayable(creator: string, amount: number) {
    seedSeq += 1;
    const selcom = await ensure("selcom_holdings");
    const payable = await ensure("creator_payable", creator);
    await actAs(db, null, "service_role");
    await one(db, "select public.ledger_post('seed', $1::text, $2::jsonb) as id", [
      `payout-seed-${seedSeq}`,
      JSON.stringify([
        { account_id: selcom, side: "debit", amount },
        { account_id: payable, side: "credit", amount },
      ]),
    ]);
  }

  async function request(
    userId: string | null,
    role: Role,
    amount: number,
    destination = DEST,
  ): Promise<Requested> {
    await actAs(db, userId, role);
    const result = await one<Requested>(
      db,
      "select * from public.request_payout($1::bigint, $2::text)",
      [amount, destination],
    );
    return result!;
  }

  async function confirm(reference: string, providerRef: string): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ id: string }>(
      db,
      "select public.confirm_payout($1::text, $2::text) as id",
      [reference, providerRef],
    );
    return result!.id;
  }

  async function fail(reference: string): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ s: string }>(
      db,
      "select public.fail_payout($1::text, null::text) as s",
      [reference],
    );
    return result!.s;
  }

  beforeAll(async () => {
    db = await openDatabase();
    await seedIdentity(db);
    await seedPayable(IDS.creator1, 1_000_000);
    await seedPayable(IDS.creator2, 50_000);
  });

  it("moves the amount to in transit and stores the number in one format", async () => {
    const payableBefore = await payableOf(IDS.creator1);
    const transitBefore = await transitBalance();

    const requested = await request(IDS.creator1, "authenticated", 200_000, "+255 712 345 678");
    firstReference = requested.reference;

    expect(requested.reference).toMatch(/^PO[0-9A-F]{16}$/);
    expect(requested.destination).toBe("255712345678");
    expect(requested.status).toBe("requested");
    expect(Number(requested.amount)).toBe(200_000);

    expect(await payableOf(IDS.creator1)).toBe(payableBefore - 200_000);
    expect(await transitBalance()).toBe(transitBefore + 200_000);

    const other = await request(IDS.creator1, "authenticated", 1_000, "0612345678");
    expect(other.destination).toBe("255612345678");
    await fail(other.reference);
  });

  it("refuses everything that is not a creator asking for a valid amount", async () => {
    await expect(request(IDS.brandAOwner, "authenticated", 5_000)).rejects.toThrow(
      /only creator accounts/,
    );
    await expect(request(null, "anon", 5_000)).rejects.toThrow(/permission denied/);

    await expect(request(IDS.creator1, "authenticated", 999)).rejects.toThrow(
      /payout amount must be between/,
    );
    await expect(request(IDS.creator1, "authenticated", 50_000_001)).rejects.toThrow(
      /payout amount must be between/,
    );

    for (const bad of ["12345", "0512345678", "+254712345678", "abc", ""]) {
      await expect(request(IDS.creator1, "authenticated", 5_000, bad)).rejects.toThrow(
        /valid Tanzanian mobile number/,
      );
    }

    await expect(request(IDS.creator2, "authenticated", 60_000)).rejects.toThrow(
      /insufficient payable balance/,
    );
  });

  it("limits how many payouts can be open at once", async () => {
    for (let index = 0; index < 5; index += 1) {
      await request(IDS.creator2, "authenticated", 1_000);
    }
    await expect(request(IDS.creator2, "authenticated", 1_000)).rejects.toThrow(
      /too many open payouts/,
    );
  });

  it("settles from Selcom's holdings once, however often it is repeated", async () => {
    const selcomBefore = await selcomBalance();
    const transitBefore = await transitBalance();

    const txn = await confirm(firstReference, "SEL-PO-1");

    expect(await selcomBalance()).toBe(selcomBefore - 200_000);
    expect(await transitBalance()).toBe(transitBefore - 200_000);

    expect(await confirm(firstReference, "SEL-PO-1")).toBe(txn);
    expect(await selcomBalance()).toBe(selcomBefore - 200_000);

    await expect(confirm(firstReference, "SEL-PO-OTHER")).rejects.toThrow(
      /different provider reference/,
    );
    await expect(fail(firstReference)).rejects.toThrow(/confirmed payout cannot be failed/);
  });

  it("refuses blank provider references and unknown payouts", async () => {
    await expect(confirm(firstReference, "   ")).rejects.toThrow(/provider reference is required/);
    await expect(confirm("PONOSUCHREFERENCE", "SEL-X")).rejects.toThrow(/unknown payout reference/);
    await expect(fail("PONOSUCHREFERENCE")).rejects.toThrow(/unknown payout reference/);
  });

  it("refuses one Selcom payment settling two payouts", async () => {
    const first = await request(IDS.creator1, "authenticated", 10_000);
    const second = await request(IDS.creator1, "authenticated", 10_000);

    await confirm(first.reference, "SEL-PO-DUP");
    const transitBefore = await transitBalance();

    await expect(confirm(second.reference, "SEL-PO-DUP")).rejects.toThrow(/duplicate key|unique/);
    expect(await transitBalance()).toBe(transitBefore);

    await asPostgres(db);
    const state = await one<{ status: string }>(
      db,
      "select status from ledger.payouts where reference = $1",
      [second.reference],
    );
    expect(state!.status).toBe("requested");
  });

  it("a failed payout returns the money and cannot be confirmed afterwards", async () => {
    const payableBefore = await payableOf(IDS.creator1);
    const requested = await request(IDS.creator1, "authenticated", 30_000);
    expect(await payableOf(IDS.creator1)).toBe(payableBefore - 30_000);

    expect(await fail(requested.reference)).toBe("failed");
    expect(await payableOf(IDS.creator1)).toBe(payableBefore);

    expect(await fail(requested.reference)).toBe("failed");
    expect(await payableOf(IDS.creator1)).toBe(payableBefore);

    await expect(confirm(requested.reference, "SEL-PO-LATE")).rejects.toThrow(/marked failed/);
  });

  it("shows payouts and balances only to their owner", async () => {
    const payable = await payableOf(IDS.creator1);

    await actAs(db, IDS.creator1, "authenticated");
    const mine = await rows<{ reference: string; destination: string }>(
      db,
      "select * from public.list_my_payouts()",
    );
    expect(mine.some((r) => r.reference === firstReference)).toBe(true);

    const balances = await one<{
      pending: string | number | bigint;
      payable: string | number | bigint;
      in_flight: string | number | bigint;
    }>(db, "select * from public.creator_balances()");
    expect(Number(balances!.payable)).toBe(payable);

    await asPostgres(db);
    const open = await one<{ n: string | number | bigint }>(
      db,
      "select coalesce(sum(amount), 0) as n from ledger.payouts where creator_id = $1 and status = 'requested'",
      [IDS.creator1],
    );
    expect(Number(balances!.in_flight)).toBe(Number(open!.n));

    await actAs(db, IDS.creator2, "authenticated");
    const theirs = await rows<{ reference: string }>(db, "select * from public.list_my_payouts()");
    expect(theirs.some((r) => r.reference === firstReference)).toBe(false);
    expect(theirs.length).toBe(5);

    await actAs(db, IDS.brandAOwner, "authenticated");
    const brandView = await rows(db, "select * from public.list_my_payouts()");
    expect(brandView).toHaveLength(0);

    await actAs(db, null, "anon");
    await expect(db.query("select * from public.list_my_payouts()")).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.query("select * from public.creator_balances()")).rejects.toThrow(
      /permission denied/,
    );

    await actAs(db, IDS.creator1, "authenticated");
    await expect(db.query("select * from ledger.payouts")).rejects.toThrow(/permission denied/);
    await expect(
      db.query("select public.confirm_payout('x', 'y')"),
    ).rejects.toThrow(/permission denied/);
    await expect(db.query("select public.fail_payout('x')")).rejects.toThrow(/permission denied/);
  });

  it("keeps payouts immutable", async () => {
    await asPostgres(db);
    const confirmed = await one<{ id: string }>(
      db,
      "select id from ledger.payouts where status = 'confirmed' limit 1",
    );
    expect(confirmed).not.toBeNull();

    await expect(
      db.query("update ledger.payouts set amount = amount + 1 where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/payout details cannot change/);
    await expect(
      db.query("update ledger.payouts set status = 'requested' where id = $1", [confirmed!.id]),
    ).rejects.toThrow(/invalid payout status change/);
    await expect(
      db.query("delete from ledger.payouts where id = $1", [confirmed!.id]),
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