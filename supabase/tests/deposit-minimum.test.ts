import { beforeAll, describe, expect, it } from "vitest";
import { actAs, asPostgres, IDS, one, openDatabase, seedIdentity, type Db } from "./support/db";

describe("deposit minimum follows platform settings", () => {
  let db: Db;
  let brandA: string;

  async function setMinimum(amount: number) {
    await actAs(db, IDS.admin, "authenticated");
    await db.query("update public.platform_settings set min_topup = $1 where id = true", [amount]);
  }

  async function request(amount: number) {
    await actAs(db, IDS.brandAOwner, "authenticated");
    return one<{ reference: string }>(
      db,
      "select * from public.request_deposit($1::uuid, $2::bigint)",
      [brandA, amount],
    );
  }

  beforeAll(async () => {
    db = await openDatabase();
    brandA = (await seedIdentity(db)).brandA;
  });

  it("enforces the seeded minimum on both sides", async () => {
    await asPostgres(db);
    const row = await one<{ min_topup: string | number | bigint }>(
      db,
      "select min_topup from public.platform_settings where id = true",
    );
    const minimum = Number(row!.min_topup);
    expect(minimum).toBeGreaterThan(1);

    await expect(request(minimum - 1)).rejects.toThrow(new RegExp(`between ${minimum} and`));
    expect((await request(minimum))!.reference).toMatch(/^BD[0-9A-F]{16}$/);
  });

  it("follows a raised minimum", async () => {
    await setMinimum(20_000);
    await expect(request(19_999)).rejects.toThrow(/between 20000 and/);
    expect((await request(20_000))!.reference).toMatch(/^BD/);
  });

  it("follows a lowered minimum", async () => {
    await setMinimum(15_000);
    await expect(request(14_999)).rejects.toThrow(/between 15000 and/);
    expect((await request(15_000))!.reference).toMatch(/^BD/);
  });
});