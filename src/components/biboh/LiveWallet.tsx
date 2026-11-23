import { useState, type FormEvent } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useApp, dict, type TKey } from "@/lib/i18n"
import { useAuth } from "@/lib/auth"
import { getSupabase } from "@/lib/supabase"
import {
  WalletFailure,
  createBrandWith,
  fetchBrandDeposits,
  fetchWalletStatement,
  fetchWalletSummary,
  getMyBrandId,
} from "@/lib/wallet-api"
import { MoneyText, Panel } from "@/components/biboh/primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

const REASON_KEY: Record<string, TKey> = {
  notAllowed: "walletLive.errNotAllowed" as TKey,
  network: "walletLive.errNetwork" as TKey,
  unknown: "walletLive.errUnknown" as TKey,
}

function errorKey(err: unknown): TKey {
  const reason = err instanceof WalletFailure ? err.reason : "unknown"
  return REASON_KEY[reason] ?? REASON_KEY["unknown"]!
}

/** Translates a known code, falling back to "other" so raw codes never show. */
function labelFor(t: (k: TKey) => string, prefix: string, code: string | null): string {
  const key = `${prefix}.${code ?? ""}`
  if (code && key in dict) return t(key as TKey)
  return t(`${prefix}.other` as TKey)
}

function formatWhen(iso: string | null, lang: string): string {
  if (!iso) return "-"
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return "-"
  return d.toLocaleDateString(lang === "sw" ? "sw-TZ" : "en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function Signed({ value }: { value: number }) {
  return (
    <span className={value >= 0 ? "font-semibold text-success" : "font-semibold"}>
      {value >= 0 ? "+" : "-"}
      <MoneyText value={Math.abs(value)} />
    </span>
  )
}

export function LiveWallet() {
  const { t, lang } = useApp()
  const { user } = useAuth()
  const qc = useQueryClient()
  const uid = user?.id ?? ""

  const brandQ = useQuery({
    queryKey: ["brandId", uid],
    enabled: !!uid,
    retry: 1,
    queryFn: () => getMyBrandId(getSupabase(), uid),
  })
  const brandId = brandQ.data ?? null

  const summaryQ = useQuery({
    queryKey: ["wallet", "summary", brandId],
    enabled: !!brandId,
    retry: 1,
    queryFn: () => fetchWalletSummary(getSupabase(), brandId as string),
  })
  const statementQ = useQuery({
    queryKey: ["wallet", "statement", brandId],
    enabled: !!brandId,
    retry: 1,
    queryFn: () => fetchWalletStatement(getSupabase(), brandId as string),
  })
  const depositsQ = useQuery({
    queryKey: ["wallet", "deposits", brandId],
    enabled: !!brandId,
    retry: 1,
    queryFn: () => fetchBrandDeposits(getSupabase(), brandId as string),
  })

  const [brandName, setBrandName] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<TKey | null>(null)

  async function handleCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setCreateError(null)
    setCreating(true)
    try {
      await createBrandWith(getSupabase(), brandName)
      await qc.invalidateQueries({ queryKey: ["brandId", uid] })
    } catch (err) {
      setCreateError(errorKey(err))
    } finally {
      setCreating(false)
    }
  }

  const header = (
    <div>
      <h1 className="text-2xl font-bold md:text-3xl">{t("wallet")}</h1>
      <p className="mt-1 text-muted-foreground">{t("walletLedgerSub")}</p>
    </div>
  )

  if (brandQ.isLoading) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        {header}
        <p role="status" className="text-muted-foreground">{t("walletLive.loading" as TKey)}</p>
      </div>
    )
  }

  if (brandQ.isError) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        {header}
        <Panel className="space-y-3">
          <p role="alert" className="text-sm text-destructive">{t(errorKey(brandQ.error))}</p>
          <Button type="button" variant="outline" onClick={() => void brandQ.refetch()}>
            {t("walletLive.retry" as TKey)}
          </Button>
        </Panel>
      </div>
    )
  }

  if (!brandId) {
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        {header}
        <Panel className="max-w-md space-y-4">
          <h2 className="font-semibold">{t("walletLive.createBrandTitle" as TKey)}</h2>
          <p className="text-sm text-muted-foreground">{t("walletLive.createBrandBody" as TKey)}</p>
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="brand-name">{t("walletLive.brandName" as TKey)}</Label>
              <Input
                id="brand-name"
                required
                maxLength={80}
                value={brandName}
                onChange={(e) => setBrandName(e.target.value)}
              />
            </div>
            {createError && (
              <p role="alert" className="text-sm text-destructive">{t(createError)}</p>
            )}
            <Button type="submit" disabled={creating || !brandName.trim()}>
              {creating ? t("walletLive.loading" as TKey) : t("walletLive.createBrand" as TKey)}
            </Button>
          </form>
        </Panel>
      </div>
    )
  }

  const failed = summaryQ.error ?? statementQ.error ?? depositsQ.error
  const retryAll = () => {
    void summaryQ.refetch()
    void statementQ.refetch()
    void depositsQ.refetch()
  }
  const statement = statementQ.data ?? []
  const deposits = depositsQ.data ?? []

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {header}

      {failed && (
        <Panel className="space-y-3">
          <p role="alert" className="text-sm text-destructive">{t(errorKey(failed))}</p>
          <Button type="button" variant="outline" onClick={retryAll}>
            {t("walletLive.retry" as TKey)}
          </Button>
        </Panel>
      )}

      <div className="rounded-2xl border border-transparent bg-gradient-brand p-5 text-primary-foreground shadow-soft sm:max-w-sm">
        <p className="text-sm opacity-90">{t("walletLive.available" as TKey)}</p>
        <p className="mt-3 font-display text-2xl font-bold">
          {summaryQ.data === undefined ? "-" : <MoneyText value={summaryQ.data} smallPrefix />}
        </p>
      </div>

      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t("walletLive.statement" as TKey)}</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("walletLive.comingSoon" as TKey)}</span>
            <Button type="button" disabled>
              <Plus className="h-4 w-4" aria-hidden />
              {t("topUp")}
            </Button>
          </div>
        </div>

        {statementQ.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">{t("walletLive.loading" as TKey)}</p>
        ) : statement.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("walletLive.noStatement" as TKey)}</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">{t("walletLive.colDate" as TKey)}</th>
                    <th className="py-2 pr-3 font-medium">{t("walletLive.colType" as TKey)}</th>
                    <th className="py-2 pr-3 font-medium">{t("walletLive.colAmount" as TKey)}</th>
                    <th className="py-2 font-medium">{t("walletLive.colBalance" as TKey)}</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.map((row) => (
                    <tr key={row.entry_id} className="border-t">
                      <td className="py-2 pr-3">{formatWhen(row.occurred_at, lang)}</td>
                      <td className="py-2 pr-3">{labelFor(t, "walletLive.kind", row.kind)}</td>
                      <td className="py-2 pr-3"><Signed value={Number(row.amount)} /></td>
                      <td className="py-2 font-semibold"><MoneyText value={Number(row.balance_after)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="divide-y md:hidden">
              {statement.map((row) => (
                <li key={row.entry_id} className="space-y-1 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-medium">{labelFor(t, "walletLive.kind", row.kind)}</p>
                    <Signed value={Number(row.amount)} />
                  </div>
                  <p className="text-xs text-muted-foreground">{formatWhen(row.occurred_at, lang)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel className="space-y-4">
        <h2 className="font-semibold">{t("walletLive.deposits" as TKey)}</h2>
        {depositsQ.isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">{t("walletLive.loading" as TKey)}</p>
        ) : deposits.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("walletLive.noDeposits" as TKey)}</p>
        ) : (
          <ul className="divide-y">
            {deposits.map((d) => (
              <li key={d.deposit_id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium"><MoneyText value={Number(d.amount)} /></p>
                  <p className="text-xs text-muted-foreground">
                    {formatWhen(d.confirmed_at ?? d.created_at, lang)} · {d.reference}
                  </p>
                </div>
                <span className="rounded-full border px-2.5 py-0.5 text-xs">
                  {labelFor(t, "walletLive.status", d.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}