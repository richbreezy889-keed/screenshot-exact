import { beforeAll, describe, expect, it } from "vitest";
import { createCampaign } from "./support/campaigns";
import { actAs, asPostgres, IDS, one, openDatabase, rows, seedIdentity, type Db } from "./support/db";

type Side = "debit" | "credit";
type Line = { account_id: string; side: Side; amount: number };

describe("ledger core (phase 1)", () => {
  let db: Db;
  let brandId: string;
  let campaignId: string;
  let acc: {
    selcom: string;
    wallet: string;
    escrow: string;
    pending: string;
    payable: string;
    transit: string;
    fees: string;
  };
  let depositTxn = "";
  let depositLines: Line[] = [];

  async function ensure(
    kind: string,
    owner: { brand?: string; campaign?: string; creator?: string } = {},
  ): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ id: string }>(
      db,
      "select public.ledger_ensure_account($1::text, $2::uuid, $3::uuid, $4::uuid) as id",
      [kind, owner.brand ?? null, owner.campaign ?? null, owner.creator ?? null],
    );
    return result!.id;
  }

  async function post(key: string, lines: unknown[], kind = "test"): Promise<string> {
    await actAs(db, null, "service_role");
    const result = await one<{ id: string }>(
      db,
      "select public.ledger_post($1::text, $2::text, $3::jsonb, $4::text) as id",
      [kind, key, JSON.stringify(lines), null],
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

  async function transactionCount(): Promise<number> {
    await asPostgres(db);
    const result = await one<{ n: string | number | bigint }>(
      db,
      "select count(*) as n from ledger.transactions",
    );
    return Number(result!.n);
  }

  beforeAll(async () => {
    db = await openDatabase();
    const ids = await seedIdentity(db);
    brandId = ids.brandA;
    const campaign = await createCampaign(db, brandId);
    campaignId = campaign.id;

    acc = {
      selcom: await ensure("selcom_holdings"),
      wallet: await ensure("brand_wallet", { brand: brandId }),
      escrow: await ensure("campaign_escrow", { campaign: campaignId }),
      pending: await ensure("creator_pending", { creator: IDS.creator1 }),
      payable: await ensure("creator_payable", { creator: IDS.creator1 }),
      transit: await ensure("payout_in_transit"),
      fees: await ensure("platform_fees"),
    };
  });

  it("creates each account once and reuses it", async () => {
    expect(await ensure("selcom_holdings")).toBe(acc.selcom);
    expect(await ensure("brand_wallet", { brand: brandId })).toBe(acc.wallet);
    expect(await ensure("creator_payable", { creator: IDS.creator1 })).toBe(acc.payable);

    await asPostgres(db);
    const count = await one<{ n: string | number | bigint }>(
      db,
      "select count(*) as n from ledger.accounts",
    );
    expect(Number(count!.n)).toBe(7);
  });

  it("refuses accounts with the wrong owner or kind", async () => {
    await expect(ensure("brand_wallet")).rejects.toThrow(/accounts_owner_check/);
    await expect(ensure("creator_payable", { brand: brandId })).rejects.toThrow(/accounts_owner_check/);
    await expect(ensure("platform_fees", { brand: brandId })).rejects.toThrow(/accounts_owner_check/);
    await expect(ensure("mystery_account")).rejects.toThrow(/accounts_kind_check/);
  });

  it("posts a deposit and moves both balances", async () => {
    depositLines = [
      { account_id: acc.selcom, side: "debit", amount: 1_000_000 },
      { account_id: acc.wallet, side: "credit", amount: 1_000_000 },
    ];
    depositTxn = await post("dep-1", depositLines, "deposit");

    expect(await balance(acc.selcom)).toBe(1_000_000);
    expect(await balance(acc.wallet)).toBe(1_000_000);
  });

  it("refuses an unbalanced transaction and writes nothing", async () => {
    const before = await transactionCount();
    await expect(
      post("bad-unbalanced", [
        { account_id: acc.selcom, side: "debit", amount: 100 },
        { account_id: acc.wallet, side: "credit", amount: 90 },
      ]),
    ).rejects.toThrow(/does not balance/);

    expect(await transactionCount()).toBe(before);
    expect(await balance(acc.selcom)).toBe(1_000_000);
    expect(await balance(acc.wallet)).toBe(1_000_000);
  });

  it("refuses the same account twice in one transaction", async () => {
    await expect(
      post("bad-twice", [
        { account_id: acc.wallet, side: "debit", amount: 50 },
        { account_id: acc.wallet, side: "credit", amount: 50 },
      ]),
    ).rejects.toThrow(/only once/);
  });

  it("refuses malformed lines", async () => {
    const cases: unknown[][] = [
      [
        { account_id: acc.selcom, side: "debit", amount: 0 },
        { account_id: acc.wallet, side: "credit", amount: 0 },
      ],
      [
        { account_id: acc.selcom, side: "debit", amount: -5 },
        { account_id: acc.wallet, side: "credit", amount: -5 },
      ],
      [
        { account_id: acc.selcom, side: "debit", amount: 10.5 },
        { account_id: acc.wallet, side: "credit", amount: 10.5 },
      ],
      [
        { account_id: acc.selcom, side: "sideways", amount: 10 },
        { account_id: acc.wallet, side: "credit", amount: 10 },
      ],
      [
        { side: "debit", amount: 10 },
        { account_id: acc.wallet, side: "credit", amount: 10 },
      ],
      [{ account_id: acc.selcom, side: "debit", amount: 10 }],
    ];

    for (let index = 0; index < cases.length; index += 1) {
      await expect(post(`bad-line-${index}`, cases[index]!)).rejects.toThrow(
        /whole positive amount|at least two lines/,
      );
    }
  });

  it("refuses to overdraw an account and writes nothing", async () => {
    const before = await transactionCount();
    await expect(
      post("bad-overdraw", [
        { account_id: acc.wallet, side: "debit", amount: 1_000_001 },
        { account_id: acc.escrow, side: "credit", amount: 1_000_001 },
      ]),
    ).rejects.toThrow(/accounts_balance_check/);

    expect(await transactionCount()).toBe(before);
    expect(await balance(acc.wallet)).toBe(1_000_000);
    expect(await balance(acc.escrow)).toBe(0);
  });

  it("funds a campaign and accrues earnings with the fee", async () => {
    await post("fund-1", [
      { account_id: acc.wallet, side: "debit", amount: 600_000 },
      { account_id: acc.escrow, side: "credit", amount: 600_000 },
    ]);
    expect(await balance(acc.wallet)).toBe(400_000);
    expect(await balance(acc.escrow)).toBe(600_000);

    await post("accrue-1", [
      { account_id: acc.escrow, side: "debit", amount: 100_000 },
      { account_id: acc.pending, side: "credit", amount: 85_000 },
      { account_id: acc.fees, side: "credit", amount: 15_000 },
    ]);
    expect(await balance(acc.escrow)).toBe(500_000);
    expect(await balance(acc.pending)).toBe(85_000);
    expect(await balance(acc.fees)).toBe(15_000);
    expect(await balance(acc.selcom)).toBe(1_000_000);
  });

  it("treats a repeated key as the same transaction", async () => {
    expect(await post("dep-1", depositLines, "deposit")).toBe(depositTxn);
    expect(await balance(acc.selcom)).toBe(1_000_000);

    await expect(
      post(
        "dep-1",
        [
          { account_id: acc.selcom, side: "debit", amount: 2_000_000 },
          { account_id: acc.wallet, side: "credit", amount: 2_000_000 },
        ],
        "deposit",
      ),
    ).rejects.toThrow(/different content/);

    await asPostgres(db);
    const count = await one<{ n: string | number | bigint }>(
      db,
      "select count(*) as n from ledger.transactions where idempotency_key = 'dep-1'",
    );
    expect(Number(count!.n)).toBe(1);
  });

  it("is append-only", async () => {
    await asPostgres(db);
    await expect(db.query("update ledger.entries set amount = 1")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from ledger.entries")).rejects.toThrow(/append-only/);
    await expect(db.query("update ledger.transactions set memo = 'x'")).rejects.toThrow(/append-only/);
    await expect(db.query("delete from ledger.transactions")).rejects.toThrow(/append-only/);
    await expect(db.query("truncate ledger.entries")).rejects.toThrow(/append-only/);
  });

  it("protects account identity and balances", async () => {
    await asPostgres(db);
    await expect(db.query("update ledger.accounts set balance = balance + 1")).rejects.toThrow(
      /only through ledger entries/,
    );
    await expect(
      db.query("update ledger.accounts set kind = 'platform_fees' where id = $1", [acc.wallet]),
    ).rejects.toThrow(/identity cannot change/);
    await expect(db.query("delete from ledger.accounts where id = $1", [acc.wallet])).rejects.toThrow(
      /cannot be deleted/,
    );
  });

  it("refuses entries that do not balance, even when written directly", async () => {
    await asPostgres(db);
    await expect(
      db.query(
        `with t as (
           insert into ledger.transactions (kind, idempotency_key, content_hash)
           values ('direct', 'direct-1', 'x')
           returning id
         )
         insert into ledger.entries (transaction_id, account_id, side, amount)
         select t.id, $1, 'debit', 100 from t`,
        [acc.wallet],
      ),
    ).rejects.toThrow(/does not balance/);

    const leftover = await one<{ n: string | number | bigint }>(
      db,
      "select count(*) as n from ledger.transactions where idempotency_key = 'direct-1'",
    );
    expect(Number(leftover!.n)).toBe(0);
    expect(await balance(acc.wallet)).toBe(400_000);
  });

  it("keeps apps out of the ledger", async () => {
    const callers: [string | null, "anon" | "authenticated"][] = [
      [null, "anon"],
      [IDS.brandAOwner, "authenticated"],
    ];

    for (const [userId, role] of callers) {
      await actAs(db, userId, role);
      await expect(db.query("select public.ledger_balance($1::uuid)", [acc.wallet])).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query("select public.ledger_ensure_account('platform_fees')")).rejects.toThrow(
        /permission denied/,
      );
      await expect(db.query("select * from public.ledger_integrity_report()")).rejects.toThrow(
        /permission denied/,
      );
      await expect(
        db.query("select public.ledger_post('x', 'k', '[]'::jsonb)"),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from ledger.accounts")).rejects.toThrow(/permission denied/);
    }

    await actAs(db, null, "service_role");
    await expect(db.query("select * from ledger.entries")).rejects.toThrow(/permission denied/);
    await expect(
      db.query(
        "insert into ledger.entries (transaction_id, account_id, side, amount) values (gen_random_uuid(), $1, 'debit', 1)",
        [acc.wallet],
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("reports a clean integrity check", async () => {
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

  it("stays consistent through a long run of random valid transactions", async () => {
    let seed = 20261114;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pick = (max: number) => 1 + Math.floor(rand() * max);

    for (let index = 0; index < 150; index += 1) {
      const key = `rand-${index}`;
      const action = Math.floor(rand() * 7);

      if (action === 0) {
        const amount = pick(500_000);
        await post(key, [
          { account_id: acc.selcom, side: "debit", amount },
          { account_id: acc.wallet, side: "credit", amount },
        ]);
      } else if (action === 1) {
        const available = await balance(acc.wallet);
        if (available === 0) continue;
        const amount = pick(available);
        await post(key, [
          { account_id: acc.wallet, side: "debit", amount },
          { account_id: acc.escrow, side: "credit", amount },
        ]);
      } else if (action === 2) {
        const available = await balance(acc.escrow);
        if (available === 0) continue;
        const gross = pick(available);
        const fee = Math.floor((gross * 15) / 100);
        const lines: Line[] = [
          { account_id: acc.escrow, side: "debit", amount: gross },
          { account_id: acc.pending, side: "credit", amount: gross - fee },
        ];
        if (fee > 0) lines.push({ account_id: acc.fees, side: "credit", amount: fee });
        await post(key, lines);
      } else if (action === 3) {
        const available = await balance(acc.pending);
        if (available === 0) continue;
        const amount = pick(available);
        await post(key, [
          { account_id: acc.pending, side: "debit", amount },
          { account_id: acc.payable, side: "credit", amount },
        ]);
      } else if (action === 4) {
        const available = await balance(acc.payable);
        if (available === 0) continue;
        const amount = pick(available);
        await post(key, [
          { account_id: acc.payable, side: "debit", amount },
          { account_id: acc.transit, side: "credit", amount },
        ]);
      } else if (action === 5) {
        const available = await balance(acc.transit);
        if (available === 0) continue;
        const amount = pick(available);
        await post(key, [
          { account_id: acc.transit, side: "debit", amount },
          { account_id: acc.selcom, side: "credit", amount },
        ]);
      } else {
        const available = await balance(acc.escrow);
        if (available === 0) continue;
        const amount = pick(available);
        await post(key, [
          { account_id: acc.escrow, side: "debit", amount },
          { account_id: acc.wallet, side: "credit", amount },
        ]);
      }
    }

    await actAs(db, null, "service_role");
    const report = await rows<{ check_name: string; ok: boolean; detail: string }>(
      db,
      "select * from public.ledger_integrity_report()",
    );
    for (const row of report) {
      expect(row.ok, `${row.check_name}: ${row.detail}`).toBe(true);
    }

    await asPostgres(db);
    const lowest = await one<{ m: string | number | bigint }>(
      db,
      "select min(balance) as m from ledger.accounts",
    );
    expect(Number(lowest!.m)).toBeGreaterThanOrEqual(0);
  });
});