// src/tui.tsx
import { Plugin } from "@opencode/plugin/tui";
import { readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createRoot, createSignal, For } from "solid-js";

// src/utils.ts
function stripJsonComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function utcDate(d) {
  return d.toISOString().slice(0, 10);
}
function usageDateRange(now = /* @__PURE__ */ new Date(), period = "last30Days") {
  const to = utcDate(now);
  if (period === "monthToDate") {
    const from2 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    return { from: utcDate(from2), to };
  }
  const from = new Date(now.getTime() - 29 * 864e5);
  return { from: utcDate(from), to };
}
function buildUsageUrl(now = /* @__PURE__ */ new Date(), period = "last30Days") {
  const { from, to } = usageDateRange(now, period);
  const params = new URLSearchParams({ from, to, group_by: "day,model" });
  return `https://api.nano-gpt.com/api/v1/usage?${params.toString()}`;
}
function topModels(data, view = "byModel") {
  if (view === "lastDay") {
    const lastDate = data?.to;
    const rows2 = Array.isArray(data?.byDayModel) ? data.byDayModel.filter((r) => r?.date === lastDate) : [];
    if (rows2.length) {
      return rows2.map((r) => ({ model: r.model, requests: r.requests, netCostUsd: r.netCostUsd })).sort((a, b) => (b.requests ?? 0) - (a.requests ?? 0)).slice(0, 6);
    }
  }
  const rows = Array.isArray(data?.byModel) ? data.byModel : [];
  return rows.map((r) => ({ model: r.model, requests: r.requests, netCostUsd: r.netCostUsd })).sort((a, b) => (b.requests ?? 0) - (a.requests ?? 0)).slice(0, 6);
}
function bar(pct, width = 12) {
  if (pct == null) return "";
  const v = Number(pct);
  if (!Number.isFinite(v)) return "";
  const filled = Math.max(0, Math.min(width, Math.round(v * width)));
  return `[${"\u2588".repeat(filled)}${"\u2591".repeat(width - filled)}] ${(v * 100).toFixed(0)}%`;
}
function fmt(n) {
  if (n == null) return "?";
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + "k";
  return v.toLocaleString();
}
function money(n) {
  if (n == null) return "?";
  const v = Number(n);
  if (!Number.isFinite(v)) return String(n);
  return "$" + v.toFixed(2);
}
function quotaLine(q) {
  if (!q) return "n/a";
  if (q.degraded) return "unknown (degraded)";
  const used = q.used, remaining = q.remaining, pct = q.percentUsed;
  const limit = used != null && remaining != null ? used + remaining : null;
  const parts = [
    used != null ? `used ${fmt(used)}` : "used ?",
    limit != null ? `/ ${fmt(limit)}` : "",
    pct != null ? `(${(pct * 100).toFixed(0)}%)` : ""
  ].filter(Boolean);
  return parts.join(" ");
}
function getUsagePeriodFromValue(v) {
  const s = String(v ?? "last30Days").toLowerCase().replace(/[\s_-]/g, "");
  return s === "monthtodate" || s === "mtd" ? "monthToDate" : "last30Days";
}
function getUsageModelViewFromValue(v) {
  const s = String(v ?? "byModel").toLowerCase().replace(/[\s_-]/g, "");
  return s === "lastday" ? "lastDay" : "byModel";
}

// src/tui.tsx
import { jsx, jsxs } from "@opentui/solid/jsx-runtime";
var SUB_URL = "https://api.nano-gpt.com/api/subscription/v1/usage";
var BALANCE_URL = "https://api.nano-gpt.com/api/check-balance";
var REFRESH_MS = 6e4;
function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return void 0;
  }
}
function loadConfig() {
  const base = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  for (const name of ["opencode.jsonc", "opencode.json"]) {
    const raw = readText(join(base, "opencode", name));
    if (!raw) continue;
    try {
      return JSON.parse(stripJsonComments(raw));
    } catch {
    }
  }
  return {};
}
function getConfigOption(key) {
  const env = process.env[`NANOGPT_${key.replace(/([A-Z])/g, "_$1").toUpperCase()}`];
  if (env != null) return env;
  const cfg = loadConfig();
  return cfg?.provider?.nanogpt?.options?.[key] ?? cfg?.nanogpt?.[key];
}
function getUsagePeriod() {
  return getUsagePeriodFromValue(getConfigOption("usagePeriod"));
}
function getUsageModelView() {
  return getUsageModelViewFromValue(getConfigOption("usageModelView"));
}
function buildUsageUrl2() {
  return buildUsageUrl(/* @__PURE__ */ new Date(), getUsagePeriod());
}
function topModels2(data, view) {
  return topModels(data, view);
}
function getApiKey() {
  if (process.env.NANOGPT_API_KEY) return process.env.NANOGPT_API_KEY;
  const parsed = loadConfig();
  const key = parsed?.provider?.nanogpt?.options?.apiKey;
  if (typeof key === "string" && key) return key;
  return void 0;
}
var tui_default = Plugin.define({
  id: "opencode-nanogpt-usage-tui",
  setup(context) {
    const theme = context.theme;
    try {
      context.ui.toast.show({
        message: "NanoGPT usage plugin loaded",
        variant: "info",
        duration: 2e3
      });
    } catch {
    }
    let disposeSolid;
    const root = createRoot((dispose) => {
      disposeSolid = dispose;
      const [apiKey2, setApiKey2] = createSignal(getApiKey());
      const [usage2, setUsage2] = createSignal(null);
      const [sub2, setSub2] = createSignal(null);
      const [balance2, setBalance2] = createSignal(null);
      const [error2, setError2] = createSignal(null);
      const [_loading2, setLoading2] = createSignal(true);
      const [lastRefresh2, setLastRefresh2] = createSignal(null);
      return { apiKey: apiKey2, setApiKey: setApiKey2, usage: usage2, setUsage: setUsage2, sub: sub2, setSub: setSub2, balance: balance2, setBalance: setBalance2, error: error2, setError: setError2, _loading: _loading2, setLoading: setLoading2, lastRefresh: lastRefresh2, setLastRefresh: setLastRefresh2 };
    });
    const [apiKey, setApiKey] = [root.apiKey, root.setApiKey];
    const [usage, setUsage] = [root.usage, root.setUsage];
    const [sub, setSub] = [root.sub, root.setSub];
    const [balance, setBalance] = [root.balance, root.setBalance];
    const [error, setError] = [root.error, root.setError];
    const [_loading, setLoading] = [root._loading, root.setLoading];
    const [lastRefresh, setLastRefresh] = [root.lastRefresh, root.setLastRefresh];
    async function fetchJson(url, key) {
      const controller = new AbortController();
      const timer2 = setTimeout(() => controller.abort(), 15e3);
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal
        });
        if (!res.ok) {
          let msg = `${res.status} ${res.statusText}`;
          try {
            const body = await res.json();
            if (body?.error?.message) msg = `${res.status}: ${body.error.message}`;
          } catch {
          }
          throw new Error(msg);
        }
        return res.json();
      } finally {
        clearTimeout(timer2);
      }
    }
    async function fetchBalance(key) {
      const controller = new AbortController();
      const timer2 = setTimeout(() => controller.abort(), 15e3);
      try {
        const res = await fetch(BALANCE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "x-api-key": key },
          signal: controller.signal
        });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      } finally {
        clearTimeout(timer2);
      }
    }
    async function fetchSubscription(key) {
      const controller = new AbortController();
      const timer2 = setTimeout(() => controller.abort(), 15e3);
      try {
        const res = await fetch(SUB_URL, {
          headers: { Authorization: `Bearer ${key}` },
          signal: controller.signal
        });
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      } finally {
        clearTimeout(timer2);
      }
    }
    async function refresh() {
      if (!apiKey()) setApiKey(getApiKey());
      if (!apiKey()) {
        setError("No NanoGPT API key found");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [u, s, b] = await Promise.all([
          fetchJson(buildUsageUrl2(), apiKey()),
          fetchSubscription(apiKey()),
          fetchBalance(apiKey())
        ]);
        setUsage(u);
        setSub(s);
        setBalance(b);
        setLastRefresh(Date.now());
      } catch (e) {
        setError(String(e?.message ?? e));
        try {
          context.ui.toast.show({
            message: "NanoGPT usage error: " + String(e?.message ?? e),
            variant: "error",
            duration: 4e3
          });
        } catch {
        }
      } finally {
        setLoading(false);
      }
    }
    const Panel = () => /* @__PURE__ */ jsxs("box", { flexDirection: "column", padding: 0, gap: 0, children: [
      /* @__PURE__ */ jsx("text", { fg: theme?.text?.base, children: "NanoGPT Usage" }),
      balance() && /* @__PURE__ */ jsxs("text", { children: [
        "Balance: ",
        money(balance().usd_balance)
      ] }),
      error() && /* @__PURE__ */ jsx("text", { fg: theme?.text?.error ?? "#ff5555", children: error() }),
      usage() ? /* @__PURE__ */ jsxs("box", { flexDirection: "column", children: [
        /* @__PURE__ */ jsxs("text", { fg: theme?.text?.muted, children: [
          usage().from,
          " \u2192 ",
          usage().to,
          " (",
          usage().totals?.requests ?? 0,
          " req)"
        ] }),
        /* @__PURE__ */ jsxs("text", { children: [
          "Net ",
          money(usage().totals?.netCostUsd),
          " / gross ",
          money(usage().totals?.costUsd)
        ] }),
        /* @__PURE__ */ jsxs("text", { children: [
          "Tokens ",
          fmt(usage().totals?.totalTokens),
          " (in ",
          fmt(usage().totals?.inputTokens),
          ", out",
          " ",
          fmt(usage().totals?.outputTokens),
          ")"
        ] }),
        topModels2(usage(), getUsageModelView()).length > 0 && /* @__PURE__ */ jsxs("box", { flexDirection: "column", children: [
          /* @__PURE__ */ jsx("text", { fg: theme?.text?.muted, children: "Top models:" }),
          /* @__PURE__ */ jsx(For, { each: topModels2(usage(), getUsageModelView()), children: (m) => /* @__PURE__ */ jsxs("text", { children: [
            "\u2022 ",
            m.model,
            ": ",
            m.requests,
            " ",
            money(m.netCostUsd)
          ] }) })
        ] })
      ] }) : null,
      sub() ? /* @__PURE__ */ jsxs("box", { flexDirection: "column", children: [
        /* @__PURE__ */ jsxs("text", { fg: theme?.text?.muted, children: [
          "Subscription: ",
          sub().state,
          " ",
          sub().active ? "(active)" : ""
        ] }),
        /* @__PURE__ */ jsxs("text", { children: [
          "Quota: ",
          bar(sub().weeklyInputTokens?.percentUsed)
        ] }),
        /* @__PURE__ */ jsx("text", { children: quotaLine(sub().weeklyInputTokens) }),
        sub().period?.currentPeriodEnd && /* @__PURE__ */ jsxs("text", { children: [
          "Period ends ",
          new Date(sub().period.currentPeriodEnd).toLocaleString()
        ] })
      ] }) : null,
      lastRefresh() && /* @__PURE__ */ jsxs("text", { fg: theme?.text?.faint ?? theme?.text?.muted, children: [
        "Updated ",
        new Date(lastRefresh()).toLocaleTimeString()
      ] })
    ] });
    try {
      const ui = context?.ui;
      if (typeof ui?.slot === "function") {
        ui.slot({ append: "sidebar.content", render: () => /* @__PURE__ */ jsx(Panel, {}) });
      }
    } catch {
    }
    let stopEvents;
    try {
      if (context.data?.listen && typeof context.data.listen === "function") {
        stopEvents = context.data.listen(({ details }) => {
          if (details?.type === "session.execution.succeeded" || details?.type === "session.execution.failed") {
            void refresh();
          }
        });
      }
    } catch {
    }
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    try {
      if (context.keymap?.layer && typeof context.keymap.layer === "function") {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "nanogpt.usage.refresh",
              title: "Refresh NanoGPT usage",
              group: "NanoGPT",
              palette: true,
              run: () => void refresh()
            }
          ]
        }));
      }
    } catch {
    }
    return () => {
      try {
        stopEvents?.();
      } catch {
      }
      try {
        clearInterval(timer);
      } catch {
      }
      try {
        disposeSolid?.();
      } catch {
      }
    };
  }
});

export {
  tui_default
};
