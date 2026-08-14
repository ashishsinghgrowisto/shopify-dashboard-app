// lib/mock.js
// Deterministic synthetic data so the dashboard can be developed, reviewed and
// demoed before any real store token exists.
//
// Enable with MOCK_DATA=1 in the environment, or ?mock=1 on the API request.
// Shapes match lib/queries.js#fetchStoreData exactly, so the UI code path is identical.

import { pickGranularity, daysBetween } from "./queries";

const MOCK_STORES = [
  { key: "cp", label: "ColorProof", color: "#818CF8", icon: "CP", domain: "colorproof.myshopify.com", scale: 1.0 },
  { key: "nb", label: "NeumaBeauty", color: "#34D399", icon: "NB", domain: "neumabeauty.myshopify.com", scale: 0.72 },
  { key: "n4", label: "Number 4 Hair", color: "#F9A8D4", icon: "N4", domain: "number4hair.myshopify.com", scale: 0.55 },
  { key: "cpp", label: "ColorProof Pro", color: "#C084FC", icon: "CP", domain: "colorproof-pro.myshopify.com", scale: 0.34 },
  { key: "nbp", label: "Neuma Pro", color: "#2DD4BF", icon: "NP", domain: "neuma-pro.myshopify.com", scale: 0.28 },
  { key: "n4p", label: "Number 4 Pro", color: "#FB7185", icon: "NP", domain: "number4-pro.myshopify.com", scale: 0.19 },
];

// Cheap deterministic PRNG so refreshes don't reshuffle the numbers
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function labelsFor(from, to, granularity) {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const step = granularity === "month" ? 30 : granularity === "week" ? 7 : 1;
  const total = daysBetween(from, to);
  const count = Math.max(1, Math.ceil(total / step));
  const start = new Date(from + "T00:00:00Z").getTime();
  const labels = [];
  const buckets = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(start + i * step * 86400000);
    buckets.push(d.toISOString().slice(0, 10));
    labels.push(
      granularity === "month"
        ? `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`
        : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`
    );
  }
  return { labels, buckets };
}

const REFERRERS = [
  ["Direct / none", 0.31], ["google", 0.24], ["klaviyo", 0.12], ["instagram", 0.09],
  ["facebook", 0.07], ["meta ads", 0.06], ["bing", 0.04], ["tiktok", 0.03],
  ["pinterest", 0.02], ["reddit", 0.02],
];

const CAMPAIGNS = [
  ["summer-sale-2026", "Email"], ["welcome-flow", "Email"], ["abandoned-cart", "Email"],
  ["retargeting-broad", "Paid"], ["prospecting-lal", "Paid"], ["brand-search", "Search"],
  ["influencer-jul", "Social"], ["sms-flash", "SMS"], ["loyalty-vip", "Email"],
  ["pmax-catalog", "Paid"],
];

const CHANNEL_COLORS = {
  Email: "#818CF8", Paid: "#3B82F6", Search: "#F59E0B",
  Social: "#EC4899", SMS: "#A78BFA", Direct: "#34D399",
};

function buildStore(store, range, compare, granularity) {
  const { labels, buckets } = labelsFor(range.from, range.to, granularity);
  const n = labels.length;
  const rnd = seeded(hash(store.key));

  const s = [], gs = [], ts = [], dc = [], or = [], av = [];
  const se = [], ca = [], rc = [], ck = [], cv = [];
  const sp = [], orp = [], ap = [], sep = [], cap = [], rcp = [], ckp = [], cvp = [];

  for (let i = 0; i < n; i++) {
    const seasonal = 1 + 0.18 * Math.sin((i / Math.max(n - 1, 1)) * Math.PI * 2);
    const weekend = granularity === "day" && (i % 7 === 5 || i % 7 === 6) ? 0.82 : 1;
    const noise = 0.85 + rnd() * 0.3;
    const growth = 1 + (i / Math.max(n - 1, 1)) * 0.12;
    const base = 4200 * store.scale * seasonal * weekend * noise * growth;

    const sessions = Math.round((base / 4200) * 5400 * store.scale + rnd() * 300);
    const carts = Math.round(sessions * (0.088 + rnd() * 0.02));
    const reached = Math.round(carts * (0.55 + rnd() * 0.1));
    const completed = Math.round(reached * (0.62 + rnd() * 0.12));
    const orders = completed;
    const netSales = Math.round(orders * (78 + rnd() * 26));

    s.push(netSales);
    gs.push(Math.round(netSales * 1.14));
    ts.push(Math.round(netSales * 1.08));
    dc.push(Math.round(netSales * 0.11));
    or.push(orders);
    av.push(orders ? parseFloat((netSales / orders).toFixed(2)) : 0);
    se.push(sessions);
    ca.push(carts);
    rc.push(reached);
    ck.push(completed);
    cv.push(sessions ? parseFloat(((completed / sessions) * 100).toFixed(2)) : 0);

    // Comparison period: slightly weaker, so deltas are mostly positive
    const cf = 0.86 + rnd() * 0.14;
    const cSessions = Math.round(sessions * (0.9 + rnd() * 0.14));
    const cCarts = Math.round(cSessions * (0.082 + rnd() * 0.02));
    const cReached = Math.round(cCarts * (0.53 + rnd() * 0.1));
    const cCompleted = Math.round(cReached * (0.6 + rnd() * 0.12));
    sp.push(Math.round(netSales * cf));
    orp.push(cCompleted);
    ap.push(cCompleted ? parseFloat(((netSales * cf) / cCompleted).toFixed(2)) : 0);
    sep.push(cSessions);
    cap.push(cCarts);
    rcp.push(cReached);
    ckp.push(cCompleted);
    cvp.push(cSessions ? parseFloat(((cCompleted / cSessions) * 100).toFixed(2)) : 0);
  }

  const totalSessions = se.reduce((a, b) => a + b, 0);
  const rf = REFERRERS.map(([name, share]) => {
    const sessions = Math.round(totalSessions * share * (0.85 + rnd() * 0.3));
    return {
      n: name,
      s: sessions,
      r: parseFloat((1.1 + rnd() * 2.6).toFixed(2)),
    };
  }).sort((a, b) => b.s - a.s);

  const totalSales = s.reduce((a, b) => a + b, 0);
  const ut = CAMPAIGNS.map(([nm, ch], i) => {
    const weight = (CAMPAIGNS.length - i) / CAMPAIGNS.length;
    const sessions = Math.round(totalSessions * 0.06 * weight * (0.7 + rnd() * 0.6));
    const orders = Math.round(sessions * (0.015 + rnd() * 0.03));
    const sa = Math.round(orders * (80 + rnd() * 40));
    return {
      nm, ch,
      se: sessions,
      sa,
      or: orders,
      cv: sessions ? parseFloat(((orders / sessions) * 100).toFixed(2)) : 0,
      av: orders ? parseFloat((sa / orders).toFixed(2)) : 0,
      cl: CHANNEL_COLORS[ch] || "#6B7280",
    };
  }).sort((a, b) => b.sa - a.sa);

  const chanMap = new Map();
  ut.forEach((c) => {
    const prev = chanMap.get(c.ch) || { ch: c.ch, se: 0, sa: 0, or: 0, campaigns: 0, cl: c.cl };
    prev.se += c.se; prev.sa += c.sa; prev.or += c.or; prev.campaigns += 1;
    chanMap.set(c.ch, prev);
  });
  const uc = [...chanMap.values()].map((ch) => ({
    ...ch,
    cv: ch.se ? parseFloat(((ch.or / ch.se) * 100).toFixed(2)) : 0,
    av: ch.or ? parseFloat((ch.sa / ch.or).toFixed(2)) : 0,
  })).sort((a, b) => b.sa - a.sa);

  const rate = (a, b) => a.map((v, i) => (b[i] > 0 ? parseFloat(((v / b[i]) * 100).toFixed(2)) : 0));

  return {
    labels, buckets,
    s, sp, gs, ts, dc, or, orp, av, ap,
    se, ca, rc, ck, sep, cap, rcp, ckp, cv, cvp,
    acr: rate(ca, se), ccr: rate(rc, se), c2c: rate(rc, ca),
    acrp: rate(cap, sep), ccrp: rate(rcp, sep), c2cp: rate(rcp, cap),
    rf, ut, uc,
    _totalSales: totalSales,
  };
}

export function isMockEnabled(searchParams) {
  if (searchParams && searchParams.get("mock") === "1") return true;
  return process.env.MOCK_DATA === "1";
}

export function buildMockPayload(range, compare, granularityOverride) {
  const granularity = pickGranularity(range.from, range.to, granularityOverride);
  const byStore = {};
  MOCK_STORES.forEach((st) => {
    const built = buildStore(st, range, compare, granularity);
    delete built._totalSales;
    byStore[st.key] = built;
  });
  const stores = MOCK_STORES.map(({ key, label, color, icon, domain }) => ({
    key, label, color, icon, domain,
  }));
  return { stores, byStore, granularity };
}
