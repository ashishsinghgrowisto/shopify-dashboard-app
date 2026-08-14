"use client";

import { useCallback, useEffect, useState } from "react";
import Dashboard from "../components/Dashboard";

const CL = { bg: "#0B0F1A", cd: "#131825", bd: "#1E2A42", tx: "#E2E8F0", mt: "#94A3B8", al: "#C4B5FD", rd: "#EF4444" };

function iso(t) {
  return new Date(t).toISOString().slice(0, 10);
}

function defaultRanges() {
  const yesterday = Date.now() - 86400000;
  const to = iso(yesterday);
  const from = iso(yesterday - 29 * 86400000);
  const cto = iso(new Date(from + "T00:00:00Z").getTime() - 86400000);
  const cfrom = iso(new Date(cto + "T00:00:00Z").getTime() - 29 * 86400000);
  return { range: { from, to }, compare: { from: cfrom, to: cto } };
}

function Centered({ children }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", background: CL.bg, color: CL.tx,
      fontFamily: "system-ui, sans-serif", padding: 40,
    }}>{children}</div>
  );
}

export default function Home() {
  const defaults = defaultRanges();
  const [range, setRange] = useState(defaults.range);
  const [compare, setCompare] = useState(defaults.compare);
  const [granularity, setGranularity] = useState(null);
  const [payload, setPayload] = useState(null);
  const [error, setError] = useState(null);
  const [hint, setHint] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (r, c, g, forceRefresh) => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      from: r.from, to: r.to, cfrom: c.from, cto: c.to,
    });
    if (g) params.set("granularity", g);
    if (forceRefresh) params.set("refresh", "1");

    try {
      const res = await fetch(`/api/dashboard?${params.toString()}`);
      const json = await res.json();
      if (!res.ok || json.error) {
        setError(json.error || `API returned ${res.status}`);
        setHint(json.hint || null);
      } else {
        setPayload(json);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(defaults.range, defaults.compare, null, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRefetch = useCallback((opts = {}) => {
    const r = opts.range || range;
    const c = opts.compare || compare;
    const g = opts.granularity !== undefined ? opts.granularity : granularity;
    if (opts.range) setRange(opts.range);
    if (opts.compare) setCompare(opts.compare);
    if (opts.granularity !== undefined) setGranularity(opts.granularity);
    load(r, c, g, Boolean(opts.forceRefresh));
  }, [range, compare, granularity, load]);

  if (!payload && loading) {
    return (
      <Centered>
        <div style={{
          width: 40, height: 40, border: "3px solid " + CL.bd,
          borderTop: "3px solid " + CL.al, borderRadius: "50%",
          animation: "spin 1s linear infinite",
        }} />
        <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
        <p style={{ marginTop: 16, fontSize: 13, color: CL.mt }}>
          Querying Shopify analytics across your stores…
        </p>
        <p style={{ marginTop: 4, fontSize: 11, color: "#64748B" }}>
          First load runs live ShopifyQL queries per store — this can take a few seconds.
        </p>
      </Centered>
    );
  }

  if (error && !payload) {
    return (
      <Centered>
        <div style={{
          background: CL.cd, border: "1px solid " + CL.rd, borderRadius: 12,
          padding: 24, maxWidth: 620, width: "100%",
        }}>
          <h2 style={{ fontSize: 17, color: CL.rd, margin: "0 0 12px" }}>Couldn&apos;t load dashboard data</h2>
          <p style={{ fontSize: 13, color: CL.mt, lineHeight: 1.6, margin: "0 0 12px" }}>{error}</p>
          {hint && <p style={{ fontSize: 12, color: CL.tx, lineHeight: 1.6, margin: "0 0 12px" }}>{hint}</p>}
          <p style={{ fontSize: 11, color: "#64748B", lineHeight: 1.7, margin: 0 }}>
            Run <code style={{ color: CL.al }}>/api/diagnose</code> to see exactly which store and which
            dataset failed. An <code style={{ color: CL.al }}>ACCESS_DENIED</code> error means the app needs
            the <code style={{ color: CL.al }}>read_reports</code> scope plus Level 2 protected customer
            data access.
          </p>
          <button onClick={() => load(range, compare, granularity, true)} style={{
            marginTop: 18, padding: "8px 16px", background: CL.al, color: CL.bg,
            border: "none", borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: "pointer",
          }}>Retry</button>
        </div>
      </Centered>
    );
  }

  if (!payload) return null;

  return <Dashboard payload={payload} onRefetch={onRefetch} loading={loading} />;
}
