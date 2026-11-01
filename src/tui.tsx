import { Plugin } from '@opencode/plugin/tui'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRoot, createSignal, For } from 'solid-js'
import {
  bar,
  buildUsageUrl as buildUsageUrlUtil,
  fmt,
  getUsageModelViewFromValue,
  getUsagePeriodFromValue,
  money,
  quotaLine,
  stripJsonComments,
  topModels as topModelsUtil,
} from './utils'

const SUB_URL = 'https://api.nano-gpt.com/api/subscription/v1/usage'
const BALANCE_URL = 'https://api.nano-gpt.com/api/check-balance'
const REFRESH_MS = 60_000

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
function loadConfig(): any {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
  for (const name of ['opencode.jsonc', 'opencode.json']) {
    const raw = readText(join(base, 'opencode', name))
    if (!raw) continue
    try {
      return JSON.parse(stripJsonComments(raw))
    } catch {
      /* ignore */
    }
  }
  return {}
}
function getConfigOption(key: string): any {
  const env = process.env[`NANOGPT_${key.replace(/([A-Z])/g, '_$1').toUpperCase()}`]
  if (env != null) return env
  const cfg = loadConfig()
  return cfg?.provider?.nanogpt?.options?.[key] ?? cfg?.nanogpt?.[key]
}
function getUsagePeriod(): 'last30Days' | 'monthToDate' {
  return getUsagePeriodFromValue(getConfigOption('usagePeriod'))
}
function getUsageModelView(): 'byModel' | 'lastDay' {
  return getUsageModelViewFromValue(getConfigOption('usageModelView'))
}
function buildUsageUrl(): string {
  return buildUsageUrlUtil(new Date(), getUsagePeriod())
}
function topModels(data: any, view: 'byModel' | 'lastDay'): Array<any> {
  return topModelsUtil(data, view)
}
function getApiKey(): string | undefined {
  if (process.env.NANOGPT_API_KEY) return process.env.NANOGPT_API_KEY
  const parsed = loadConfig()
  const key = parsed?.provider?.nanogpt?.options?.apiKey
  if (typeof key === 'string' && key) return key
  return undefined
}

export default Plugin.define({
  id: 'opencode-nanogpt-usage-tui',
  setup(context: any) {
    const theme = context.theme
    try {
      context.ui.toast.show({
        message: 'NanoGPT usage plugin loaded',
        variant: 'info',
        duration: 2000,
      })
    } catch {
      /* ignore */
    }

    const [apiKey, setApiKey] = createRoot(() => createSignal<string | undefined>(getApiKey()))
    const [usage, setUsage] = createRoot(() => createSignal<any>(null))
    const [sub, setSub] = createRoot(() => createSignal<any>(null))
    const [balance, setBalance] = createRoot(() => createSignal<any>(null))
    const [error, setError] = createRoot(() => createSignal<string | null>(null))
    const [_loading, setLoading] = createRoot(() => createSignal(true))
    const [lastRefresh, setLastRefresh] = createRoot(() => createSignal<number | null>(null))

    async function fetchJson(url: string, key: string) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        })
        if (!res.ok) {
          let msg = `${res.status} ${res.statusText}`
          try {
            const body = await res.json()
            if (body?.error?.message) msg = `${res.status}: ${body.error.message}`
          } catch {
            /* ignore */
          }
          throw new Error(msg)
        }
        return res.json()
      } finally {
        clearTimeout(timer)
      }
    }

    async function fetchBalance(key: string) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(BALANCE_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}`, 'x-api-key': key },
          signal: controller.signal,
        })
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
        return res.json()
      } finally {
        clearTimeout(timer)
      }
    }

    async function fetchSubscription(key: string) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      try {
        const res = await fetch(SUB_URL, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal,
        })
        if (!res.ok) return null
        return res.json()
      } catch {
        return null
      } finally {
        clearTimeout(timer)
      }
    }

    async function refresh() {
      if (!apiKey()) setApiKey(getApiKey())
      if (!apiKey()) {
        setError('No NanoGPT API key found')
        setLoading(false)
        return
      }
      setLoading(true)
      setError(null)
      try {
        const [u, s, b] = await Promise.all([
          fetchJson(buildUsageUrl(), apiKey()!),
          fetchSubscription(apiKey()!),
          fetchBalance(apiKey()!),
        ])
        setUsage(u)
        setSub(s)
        setBalance(b)
        setLastRefresh(Date.now())
      } catch (e: any) {
        setError(String(e?.message ?? e))
        try {
          context.ui.toast.show({
            message: 'NanoGPT usage error: ' + String(e?.message ?? e),
            variant: 'error',
            duration: 4000,
          })
        } catch {
          /* ignore */
        }
      } finally {
        setLoading(false)
      }
    }

    const Panel = () => (
      <box flexDirection="column" padding={0} gap={0}>
        <text fg={theme?.text?.base}>NanoGPT Usage</text>
        {balance() && <text>Balance: {money(balance().usd_balance)}</text>}
        {error() && <text fg={theme?.text?.error ?? '#ff5555'}>{error()}</text>}
        {usage() && (
          <>
            <text fg={theme?.text?.muted}>
              {usage().from} → {usage().to} ({usage().totals?.requests ?? 0} req)
            </text>
            <text>
              Net {money(usage().totals?.netCostUsd)} / gross {money(usage().totals?.costUsd)}
            </text>
            <text>
              Tokens {fmt(usage().totals?.totalTokens)} (in {fmt(usage().totals?.inputTokens)}, out{' '}
              {fmt(usage().totals?.outputTokens)})
            </text>
            {topModels(usage(), getUsageModelView()).length > 0 && (
              <>
                <text fg={theme?.text?.muted}>Top models:</text>
                <For each={topModels(usage(), getUsageModelView())}>
                  {(m: any) => (
                    <text>
                      {'• '}
                      {m.model}: {m.requests} {money(m.netCostUsd)}
                    </text>
                  )}
                </For>
              </>
            )}
          </>
        )}
        {sub() && (
          <>
            <text fg={theme?.text?.muted}>
              Subscription: {sub().state} {sub().active ? '(active)' : ''}
            </text>
            <text>Quota: {bar(sub().weeklyInputTokens?.percentUsed)}</text>
            <text>{quotaLine(sub().weeklyInputTokens)}</text>
            {sub().period?.currentPeriodEnd && (
              <text>Period ends {new Date(sub().period.currentPeriodEnd).toLocaleString()}</text>
            )}
          </>
        )}
        {lastRefresh() && (
          <text fg={theme?.text?.faint ?? theme?.text?.muted}>
            Updated {new Date(lastRefresh()!).toLocaleTimeString()}
          </text>
        )}
      </box>
    )

    if (context.ui?.slot) {
      context.ui.slot({ append: 'sidebar.content', render: () => <Panel /> })
    } else if (context.ui?.registerSlot) {
      context.ui.registerSlot?.({ id: 'nanogpt-usage', append: 'sidebar.content', render: () => <Panel /> })
    } else if (context.ui?.add) {
      try {
        context.ui.add({ append: 'sidebar.content', render: () => <Panel /> })
      } catch {
        /* ignore */
      }
    }

    const stopEvents = context.data.listen(({ details }: any) => {
      if (
        details?.type === 'session.execution.succeeded' ||
        details?.type === 'session.execution.failed'
      ) {
        void refresh()
      }
    })

    void refresh()
    const timer = setInterval(() => void refresh(), REFRESH_MS)

    context.keymap.layer(() => ({
      mode: 'global',
      commands: [
        {
          id: 'nanogpt.usage.refresh',
          title: 'Refresh NanoGPT usage',
          group: 'NanoGPT',
          palette: true,
          run: () => void refresh(),
        },
      ],
    }))

    return () => {
      stopEvents()
      clearInterval(timer)
    }
  },
})
