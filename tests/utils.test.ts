import { describe, expect, it } from 'vitest'
import {
  bar,
  buildUsageUrl,
  fmt,
  getUsageModelViewFromValue,
  getUsagePeriodFromValue,
  money,
  quotaLine,
  stripJsonComments,
  topModels,
  usageDateRange,
  utcDate,
} from '../src/utils'

describe('stripJsonComments', () => {
  it('removes block comments', () => {
    expect(stripJsonComments('{"a":1} /* comment */')).toBe('{"a":1} ')
  })
  it('removes line comments not after colon', () => {
    expect(stripJsonComments('// comment\n{"a":1}')).toBe('\n{"a":1}')
  })
})

describe('utcDate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const d = new Date('2025-01-15T12:34:56Z')
    expect(utcDate(d)).toBe('2025-01-15')
  })
})

describe('usageDateRange', () => {
  it('returns last 30 days for default', () => {
    const now = new Date('2025-01-31T00:00:00Z')
    const { from, to } = usageDateRange(now, 'last30Days')
    expect(to).toBe('2025-01-31')
    expect(from).toBe('2025-01-02')
  })
  it('returns month to date', () => {
    const now = new Date('2025-01-31T00:00:00Z')
    const { from, to } = usageDateRange(now, 'monthToDate')
    expect(to).toBe('2025-01-31')
    expect(from).toBe('2025-01-01')
  })
})

describe('buildUsageUrl', () => {
  it('builds url with params', () => {
    const now = new Date('2025-01-31T00:00:00Z')
    const url = buildUsageUrl(now, 'last30Days')
    expect(url).toContain('https://api.nano-gpt.com/api/v1/usage?')
    expect(url).toContain('from=2025-01-02')
    expect(url).toContain('to=2025-01-31')
    expect(url).toContain('group_by=day%2Cmodel')
  })
})

describe('topModels', () => {
  const data = {
    to: '2025-01-31',
    byModel: [
      { model: 'a', requests: 10, netCostUsd: 0.1 },
      { model: 'b', requests: 5, netCostUsd: 0.05 },
    ],
    byDayModel: [
      { date: '2025-01-30', model: 'a', requests: 1, netCostUsd: 0.01 },
      { date: '2025-01-31', model: 'b', requests: 3, netCostUsd: 0.03 },
    ],
  }
  it('returns top models byModel', () => {
    const res = topModels(data, 'byModel')
    expect(res[0].model).toBe('a')
    expect(res.length).toBe(2)
  })
  it('returns top models lastDay', () => {
    const res = topModels(data, 'lastDay')
    expect(res[0].model).toBe('b')
    expect(res[0].requests).toBe(3)
  })
  it('falls back to empty array', () => {
    expect(topModels({}, 'byModel')).toEqual([])
  })
})

describe('bar', () => {
  it('returns empty for null', () => {
    expect(bar(null)).toBe('')
  })
  it('returns bar string', () => {
    expect(bar(0.5)).toContain('50%')
  })
  it('handles invalid', () => {
    expect(bar('x')).toBe('')
  })
})

describe('fmt', () => {
  it('formats millions', () => {
    expect(fmt(1_500_000)).toBe('1.50M')
  })
  it('formats thousands', () => {
    expect(fmt(1500)).toBe('1.5k')
  })
  it('formats small', () => {
    expect(fmt(123)).toBe('123')
  })
  it('handles null', () => {
    expect(fmt(null)).toBe('?')
  })
})

describe('money', () => {
  it('formats money', () => {
    expect(money(1.234)).toBe('$1.23')
  })
  it('handles null', () => {
    expect(money(null)).toBe('?')
  })
})

describe('quotaLine', () => {
  it('returns n/a for null', () => {
    expect(quotaLine(null)).toBe('n/a')
  })
  it('returns degraded', () => {
    expect(quotaLine({ degraded: true })).toBe('unknown (degraded)')
  })
  it('returns quota parts', () => {
    expect(quotaLine({ used: 10, remaining: 90, percentUsed: 0.1 })).toContain('used')
  })
})

describe('getUsagePeriodFromValue', () => {
  it('defaults to last30Days', () => {
    expect(getUsagePeriodFromValue(undefined)).toBe('last30Days')
  })
  it('parses month to date', () => {
    expect(getUsagePeriodFromValue('month_to_date')).toBe('monthToDate')
    expect(getUsagePeriodFromValue('MTD')).toBe('monthToDate')
  })
})

describe('getUsageModelViewFromValue', () => {
  it('defaults to byModel', () => {
    expect(getUsageModelViewFromValue(undefined)).toBe('byModel')
  })
  it('parses lastDay', () => {
    expect(getUsageModelViewFromValue('last-day')).toBe('lastDay')
    expect(getUsageModelViewFromValue('LASTDAY')).toBe('lastDay')
  })
  it('returns byModel otherwise', () => {
    expect(getUsageModelViewFromValue('by_model')).toBe('byModel')
  })
})
