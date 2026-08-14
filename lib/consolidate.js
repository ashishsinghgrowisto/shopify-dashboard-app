// lib/consolidate.js
// Rolls every connected store up into one "All Brands" dataset.
//
// The important rule: additive metrics are summed, ratio metrics are RECOMPUTED
// from the summed components. Averaging conversion rates or AOVs across stores
// would weight a 200-session store the same as a 200,000-session one.

function sumArrays(list, n) {
  const out = new Array(n).fill(0);
  list.forEach((arr) => {
    if (!arr) return;
    for (let i = 0; i < n; i++) out[i] += Number(arr[i]) || 0;
  });
  return out;
}

function ratio(numerator, denominator, asPct = true) {
  return numerator.map((v, i) => {
    const d = denominator[i];
    if (!d) return 0;
    const r = asPct ? (v / d) * 100 : v / d;
    return parseFloat(r.toFixed(2));
  });
}

export function consolidate(byStore, storeMeta) {
  const keys = Object.keys(byStore);
  if (keys.length === 0) return null;

  const datasets = keys.map((k) => byStore[k]);
  const n = Math.max(...datasets.map((d) => (d.labels || []).length), 0);
  if (n === 0) return null;

  const labels =
    (datasets.find((d) => (d.labels || []).length === n) || {}).labels || [];
  const buckets =
    (datasets.find((d) => (d.buckets || []).length === n) || {}).buckets || [];

  const pick = (field) => datasets.map((d) => d[field]);

  const s = sumArrays(pick("s"), n);
  const sp = sumArrays(pick("sp"), n);
  const gs = sumArrays(pick("gs"), n);
  const ts = sumArrays(pick("ts"), n);
  const dc = sumArrays(pick("dc"), n);
  const or = sumArrays(pick("or"), n);
  const orp = sumArrays(pick("orp"), n);
  const se = sumArrays(pick("se"), n);
  const ca = sumArrays(pick("ca"), n);
  const rc = sumArrays(pick("rc"), n);
  const ck = sumArrays(pick("ck"), n);
  const sep = sumArrays(pick("sep"), n);
  const cap = sumArrays(pick("cap"), n);
  const rcp = sumArrays(pick("rcp"), n);
  const ckp = sumArrays(pick("ckp"), n);

  // ── Referrers: merge by name across stores ──────────────────────
  const refMap = new Map();
  datasets.forEach((d) => {
    (d.rf || []).forEach((r) => {
      const prev = refMap.get(r.n) || { n: r.n, s: 0, weighted: 0 };
      prev.s += r.s;
      prev.weighted += (r.r || 0) * r.s; // session-weighted conversion rate
      refMap.set(r.n, prev);
    });
  });
  const rf = [...refMap.values()]
    .map((r) => ({
      n: r.n,
      s: r.s,
      r: r.s > 0 ? parseFloat((r.weighted / r.s).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.s - a.s)
    .slice(0, 12);

  // ── Campaigns: merge by campaign+channel, keep per-store split ───
  const campMap = new Map();
  keys.forEach((k, idx) => {
    const meta = storeMeta.find((m) => m.key === k) || { label: k, color: "#6B7280" };
    (datasets[idx].ut || []).forEach((c) => {
      const id = `${c.nm}||${c.ch}`;
      const prev =
        campMap.get(id) ||
        { nm: c.nm, ch: c.ch, se: 0, sa: 0, or: 0, cl: c.cl, byStore: {} };
      prev.se += c.se || 0;
      prev.sa += c.sa || 0;
      prev.or += c.or || 0;
      prev.byStore[k] = {
        label: meta.label,
        color: meta.color,
        se: c.se || 0,
        sa: c.sa || 0,
        or: c.or || 0,
      };
      campMap.set(id, prev);
    });
  });
  const ut = [...campMap.values()]
    .map((c) => {
      c.cv = c.se > 0 ? parseFloat(((c.or / c.se) * 100).toFixed(2)) : 0;
      c.av = c.or > 0 ? parseFloat((c.sa / c.or).toFixed(2)) : 0;
      return c;
    })
    .sort((a, b) => b.sa - a.sa)
    .slice(0, 60);

  // ── Channels ────────────────────────────────────────────────────
  const chanMap = new Map();
  datasets.forEach((d, idx) => {
    const k = keys[idx];
    (d.uc || []).forEach((ch) => {
      const prev =
        chanMap.get(ch.ch) ||
        { ch: ch.ch, se: 0, sa: 0, or: 0, campaigns: 0, cl: ch.cl, byStore: {} };
      prev.se += ch.se || 0;
      prev.sa += ch.sa || 0;
      prev.or += ch.or || 0;
      prev.campaigns += ch.campaigns || 0;
      prev.byStore[k] = { se: ch.se || 0, sa: ch.sa || 0, or: ch.or || 0 };
      chanMap.set(ch.ch, prev);
    });
  });
  const uc = [...chanMap.values()]
    .map((ch) => {
      ch.cv = ch.se > 0 ? parseFloat(((ch.or / ch.se) * 100).toFixed(2)) : 0;
      ch.av = ch.or > 0 ? parseFloat((ch.sa / ch.or).toFixed(2)) : 0;
      return ch;
    })
    .sort((a, b) => b.sa - a.sa);

  return {
    labels,
    buckets,
    s, sp, gs, ts, dc, or, orp,
    se, ca, rc, ck,
    sep, cap, rcp, ckp,
    // recomputed, not averaged
    av: ratio(s, or, false),
    ap: ratio(sp, orp, false),
    cv: ratio(ck, se),
    cvp: ratio(ckp, sep),
    acr: ratio(ca, se),
    ccr: ratio(rc, se),
    c2c: ratio(rc, ca),
    acrp: ratio(cap, sep),
    ccrp: ratio(rcp, sep),
    c2cp: ratio(rcp, cap),
    rf, ut, uc,
  };
}
