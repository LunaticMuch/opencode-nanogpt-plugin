import { Plugin } from "@opencode/plugin/tui"
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { createRoot, createSignal } from "solid-js"

const SUB_URL = "https://api.nano-gpt.com/api/subscription/v1/usage"
const BALANCE_URL = "https://api.nano-gpt.com/api/check-balance"
const REFRESH_MS = 60_000

function readText(path: string): string | undefined {
  try { return readFileSync(path, "utf8") } catch { return undefined }
}
function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
}
function loadConfig(): any {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config")
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const raw = readText(join(base, "opencode", name))
    if (!raw) continue
    try { return JSON.parse(stripJsonComments(raw)) } catch { /* ignore */ }
  }
  return {}
}
function loadApiKeyFromConfig(): string | undefined {
  const parsed = loadConfig()
  const key = parsed?.provider?.nanogpt?.options?.apiKey
  if (typeof key === "string" && key) return key
  return undefined
}
function getConfigOption(key: string): any {
  const env = process.env[`NANOGPT_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`]
  if (env != null) return env
  const cfg = loadConfig()
  return cfg?.provider?.nanogpt?.options?.[key] ?? cfg?.nanogpt?.[key]
}
function getUsagePeriod(): "last30Days" | "monthToDate" {
  const v = String(getConfigOption("usagePeriod") ?? "last30Days").toLowerCase().replace(/[\s_-]/g, "")
  return v === "monthtodate" || v === "mtd" ? "monthToDate" : "last30Days"
}
function getUsageModelView(): "byModel" | "lastDay" {
  const v = String(getConfigOption("usageModelView") ?? "byModel").toLowerCase().replace(/[\s_-]/g, "")
  return v === "lastday" ? "lastDay" : "byModel"
}
function utcDate(d: Date): string { return d.toISOString().slice(0, 10) }
function usageDateRange(): { from: string; to: string } {
  const now = new Date()
  const to = utcDate(now)
  if (getUsagePeriod() === "monthToDate") {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { from: utcDate(from), to }
  }
  const from = new Date(now.getTime() - 29 * 86400000)
  return { from: utcDate(from), to }
}
function buildUsageUrl(): string {
  const { from, to } = usageDateRange()
  const params = new URLSearchParams({ from, to, group_by: "day,model" })
  return `https://api.nano-gpt.com/api/v1/usage?${params.toString()}`
}
function topModels(data: any, view: "byModel" | "lastDay"): Array<any> {
  if (view === "lastDay") {
    const lastDate = data?.to
    const rows = Array.isArray(data?.byDayModel) ? data.byDayModel.filter((r: any) => r?.date === lastDate) : []
    if (rows.length) {
      return rows
        .map((r: any) => ({ model: r.model, requests: r.requests, netCostUsd: r.netCostUsd }))
        .sort((a: any, b: any) => (b.requests ?? 0) - (a.requests ?? 0))
        .slice(0, 6)
    }
  }
  const rows = Array.isArray(data?.byModel) ? data.byModel : []
  return rows
    .map((r: any) => ({ model: r.model, requests: r.requests, netCostUsd: r.netCostUsd }))
    .sort((a: any, b: any) => (b.requests ?? 0) - (a.requests ?? 0))
    .slice(0, 6)
}
function bar(pct: unknown, width = 12): string {
  if (pct == null) return ""
  const v = Number(pct)
  if (!Number.isFinite(v)) return ""
  const filled = Math.max(0, Math.min(width, Math.round(v * width)))
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${(v * 100).toFixed(0)}%`
}
function getApiKey(): string | undefined {
  if (process.env.NANOGPT_API_KEY) return process.env.NANOGPT_API_KEY
  return loadApiKeyFromConfig()
}
function fmt(n: unknown): string {
  if (n == null) return "?"
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + "M"
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + "k"
  return v.toLocaleString()
}
function money(n: unknown): string {
  if (n == null) return "?"
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  return "$" + v.toFixed(2)
}
function quotaLine(q: any): string {
  if (!q) return "n/a"
  if (q.degraded) return "unknown (degraded)"
  const used = q.used, remaining = q.remaining, pct = q.percentUsed
  const limit = used != null && remaining != null ? used + remaining : null
  const parts = [used != null ? `used ${fmt(used)}` : "used ?", limit != null ? `/ ${fmt(limit)}` : "", pct != null ? `(${(pct * 100).toFixed(0)}%)` : ""].filter(Boolean)
  return parts.join(" ")
}

export default Plugin.define({
  id: "opencode-nanogpt-usage-tui",
  setup(context: any) {
    const theme = context.theme
    try { context.ui.toast.show({ message: "NanoGPT usage plugin loaded", variant: "info", duration: 2000 }) } catch {}

    const [apiKey, setApiKey] = createRoot(() => createSignal<string | undefined>(getApiKey()))
    const [usage, setUsage] = createRoot(() => createSignal<any>(null))
    const [sub, setSub] = createRoot(() => createSignal<any>(null))
    const [balance, setBalance] = createRoot(() => createSignal<any>(null))
    const [error, setError] = createRoot(() => createSignal<string | null>(null))
    const [loading, setLoading] = createRoot(() => createSignal(true))
    const [lastRefresh, setLastRefresh] = createRoot(() => createSignal<number | null>(null))

    async function fetchJson(url: string, key: string) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal })
        if (!res.ok) {
          let msg = `${res.status} ${res.statusText}`
          try { const body = await res.json(); if (body?.error?.message) msg = `${res.status}: ${body.error.message}` } catch {}
          throw new Error(msg)
        }
        return res.json()
      } finally { clearTimeout(timer) }
    }

    async function fetchBalance(key: string) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(BALANCE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "x-api-key": key },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      } finally { clearTimeout(timer) }
    }

    async function fetchSubscription(key: string) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(SUB_URL, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal })
        if (!res.ok) return null
        return res.json()
      } catch { return null }
      finally { clearTimeout(timer) }
    }

    async function refresh() {
      if (!apiKey()) setApiKey(getApiKey())
      if (!apiKey()) { setError("No NanoGPT API key found"); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const [u, s, b] = await Promise.all([fetchJson(buildUsageUrl(), apiKey()!), fetchSubscription(apiKey()!), fetchBalance(apiKey()!)])
        setUsage(u); setSub(s); setBalance(b); setLastRefresh(Date.now())
      } catch (e: any) {
        setError(String(e?.message ?? e))
        try { context.ui.toast.show({ message: "NanoGPT usage error: " + String(e?.message ?? e), variant: "error", duration: 4000 }) } catch {}
      } finally { setLoading(false) }
    }

    const Panel = () => (
      <box flexDirection="column" padding={0} gap={0}>
        <text fg={theme?.text?.base}>NanoGPT Usage</text>
        {balance() && <text>Balance: {money(balance().usd_balance)}</text>}
        {error() && <text fg={theme?.text?.error ?? "#ff5555"}>{error()}</text>}
        {usage() && (
          <>
            <text fg={theme?.text?.muted}>{usage().from} → {usage().to} ({usage().totals?.requests ?? 0} req)</text>
            <text>Net {money(usage().totals?.netCostUsd)} / gross {money(usage().totals?.costUsd)}</text>
            <text>Tokens {fmt(usage().totals?.totalTokens)} (in {fmt(usage().totals?.inputTokens)}, out {fmt(usage().totals?.outputTokens)})</text>
            {topModels(usage(), getUsageModelView()).length > 0 && (
              <>
                <text fg={theme?.text?.muted}>Top models:</text>
                {topModels(usage(), getUsageModelView()).map((m: any) => <text>{"• "}{m.model}: {m.requests} {money(m.netCostUsd)}</text>)}
              </>
            )}
          </>
        )}
        {sub() && (
          <>
            <text fg={theme?.text?.muted}>Subscription: {sub().state} {sub().active ? "(active)" : ""}</text>
            <text>Quota: {bar(sub().weeklyInputTokens?.percentUsed)}</text>
            <text>{quotaLine(sub().weeklyInputTokens)}</text>
            {sub().period?.currentPeriodEnd && <text>Period ends {new Date(sub().period.currentPeriodEnd).toLocaleString()}</text>}
          </>
        )}
        {lastRefresh() && <text fg={theme?.text?.faint ?? theme?.text?.muted}>Updated {new Date(lastRefresh()!).toLocaleTimeString()}</text>}
      </box>
    )

    context.ui.slot({ append: "sidebar.content", render: () => <Panel /> })

    const stopEvents = context.data.listen(({ details }: any) => {
      if (details?.type === "session.execution.succeeded" || details?.type === "session.execution.failed") {
        void refresh()
      }
    })

    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)

    context.keymap.layer(() => ({
      mode: "global",
      commands: [{ id: "nanogpt.usage.refresh", title: "Refresh NanoGPT usage", group: "NanoGPT", palette: true, run: () => void refresh() }],
    }))

    return () => {
      stopEvents()
      clearInterval(timer)
    }
  },
})
