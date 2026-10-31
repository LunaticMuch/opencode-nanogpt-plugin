export function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

export function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function usageDateRange(
  now: Date = new Date(),
  period: 'last30Days' | 'monthToDate' = 'last30Days',
): { from: string; to: string } {
  const to = utcDate(now)
  if (period === 'monthToDate') {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    return { from: utcDate(from), to }
  }
  const from = new Date(now.getTime() - 29 * 86400000)
  return { from: utcDate(from), to }
}

export function buildUsageUrl(
  now: Date = new Date(),
  period: 'last30Days' | 'monthToDate' = 'last30Days',
): string {
  const { from, to } = usageDateRange(now, period)
  const params = new URLSearchParams({ from, to, group_by: 'day,model' })
  return `https://api.nano-gpt.com/api/v1/usage?${params.toString()}`
}

export function topModels(data: any, view: 'byModel' | 'lastDay' = 'byModel'): Array<any> {
  if (view === 'lastDay') {
    const lastDate = data?.to
    const rows = Array.isArray(data?.byDayModel)
      ? data.byDayModel.filter((r: any) => r?.date === lastDate)
      : []
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

export function bar(pct: unknown, width = 12): string {
  if (pct == null) return ''
  const v = Number(pct)
  if (!Number.isFinite(v)) return ''
  const filled = Math.max(0, Math.min(width, Math.round(v * width)))
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}] ${(v * 100).toFixed(0)}%`
}

export function fmt(n: unknown): string {
  if (n == null) return '?'
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  if (Math.abs(v) >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M'
  if (Math.abs(v) >= 1_000) return (v / 1_000).toFixed(1) + 'k'
  return v.toLocaleString()
}

export function money(n: unknown): string {
  if (n == null) return '?'
  const v = Number(n)
  if (!Number.isFinite(v)) return String(n)
  return '$' + v.toFixed(2)
}

export function quotaLine(q: any): string {
  if (!q) return 'n/a'
  if (q.degraded) return 'unknown (degraded)'
  const used = q.used,
    remaining = q.remaining,
    pct = q.percentUsed
  const limit = used != null && remaining != null ? used + remaining : null
  const parts = [
    used != null ? `used ${fmt(used)}` : 'used ?',
    limit != null ? `/ ${fmt(limit)}` : '',
    pct != null ? `(${(pct * 100).toFixed(0)}%)` : '',
  ].filter(Boolean)
  return parts.join(' ')
}

export function getUsagePeriodFromValue(v: unknown): 'last30Days' | 'monthToDate' {
  const s = String(v ?? 'last30Days')
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  return s === 'monthtodate' || s === 'mtd' ? 'monthToDate' : 'last30Days'
}

export function getUsageModelViewFromValue(v: unknown): 'byModel' | 'lastDay' {
  const s = String(v ?? 'byModel')
    .toLowerCase()
    .replace(/[\s_-]/g, '')
  return s === 'lastday' ? 'lastDay' : 'byModel'
}
