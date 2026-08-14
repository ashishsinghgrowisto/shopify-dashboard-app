"use client";

import { useMemo, useState } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  ComposedChart, Line, BarChart, Bar, Area, Cell, PieChart, Pie,
} from "recharts";

// ═══════════════════════════════════════════════════════════════════
// Theme
// ═══════════════════════════════════════════════════════════════════
export const CL = {
  bg: "#0B0F1A", cd: "#131825", bd: "#1E2A42", gn: "#22C55E", rd: "#EF4444",
  am: "#F59E0B", tx: "#E2E8F0", mt: "#94A3B8", dm: "#64748B", gr: "#1E293B",
  al: "#C4B5FD",
};

// ═══════════════════════════════════════════════════════════════════
// Number helpers
// ═══════════════════════════════════════════════════════════════════
const f$ = (v) => "$" + Math.round(Number(v) || 0).toLocaleString();
const fInt = (v) => Math.round(Number(v) || 0).toLocaleString();
const sum = (a) => (a || []).reduce((x, y) => x + (Number(y) || 0), 0);
const mean = (a) => ((a || []).length ? sum(a) / a.length : 0);
const pct = (a, b) => (!b ? 0 : ((a - b) / b) * 100);
const safeDiv = (a, b) => (b ? a / b : 0);

function rng(arr) {
  const v = (arr || []).filter((x) => Number(x) > 0);
  return v.length ? { lo: Math.min(...v), hi: Math.max(...v) } : { lo: 0, hi: 1 };
}

function hBg(val, lo, hi, inv) {
  if (!val || lo === hi) return "transparent";
  let t = (val - lo) / (hi - lo);
  if (inv) t = 1 - t;
  t = Math.max(0, Math.min(1, t));
  let r, g, b;
  if (t < 0.25) { const p = t / 0.25; r = 153 + 67 * p; g = 27 + 23 * p; b = 27 + 3 * p; }
  else if (t < 0.5) { const p = (t - 0.25) / 0.25; r = 220 - 3 * p; g = 50 + 69 * p; b = 30 - 24 * p; }
  else if (t < 0.75) { const p = (t - 0.5) / 0.25; r = 217 - 116 * p; g = 119 + 44 * p; b = 6 + 7 * p; }
  else { const p = (t - 0.75) / 0.25; r = 101 - 79 * p; g = 163; b = 13 + 61 * p; }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},0.38)`;
}

function hTx(val, lo, hi, inv) {
  if (!val || lo === hi) return CL.mt;
  let t = (val - lo) / (hi - lo);
  if (inv) t = 1 - t;
  t = Math.max(0, Math.min(1, t));
  if (t < 0.2) return "#FCA5A5";
  if (t < 0.4) return "#FDBA74";
  if (t < 0.6) return "#FDE68A";
  if (t < 0.8) return "#BEF264";
  return "#86EFAC";
}

// ═══════════════════════════════════════════════════════════════════
// Primitive UI
// ═══════════════════════════════════════════════════════════════════
const thS = {
  padding: "6px", textAlign: "center", fontSize: 8, fontWeight: 700,
  textTransform: "uppercase", letterSpacing: "0.04em",
  borderBottom: "2px solid " + CL.bd, position: "sticky", top: 0,
  background: CL.cd, zIndex: 1,
};

function Pill({ color, children }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 3, padding: "2px 7px",
      borderRadius: 5, fontSize: 10, fontWeight: 600,
      background: color + "18", color,
    }}>{children}</span>
  );
}

function Delta({ value, inverse }) {
  if (value === null || value === undefined || !isFinite(value)) {
    return <span style={{ fontSize: 9, color: CL.dm }}>—</span>;
  }
  const good = inverse ? value < 0 : value >= 0;
  return (
    <Pill color={good ? CL.gn : CL.rd}>
      {value >= 0 ? "▲" : "▼"}{Math.abs(value).toFixed(1)}%
    </Pill>
  );
}

function Card({ label, value, sub, delta, inverse }) {
  return (
    <div style={{ background: CL.cd, border: "1px solid " + CL.bd, borderRadius: 11, padding: 13 }}>
      <div style={{ fontSize: 9, color: CL.mt, fontWeight: 600, textTransform: "uppercase", marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: CL.tx }}>{value}</div>
      {sub && <div style={{ fontSize: 9, color: CL.dm, marginBottom: 2 }}>{sub}</div>}
      {delta !== undefined && <Delta value={delta} inverse={inverse} />}
    </div>
  );
}

function CardGrid({ children, min = 140 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(auto-fit,minmax(${min}px,1fr))`, gap: 9, marginBottom: 14 }}>
      {children}
    </div>
  );
}

function CB({ title, subtitle, h = 280, children }) {
  return (
    <div style={{ background: CL.cd, border: "1px solid " + CL.bd, borderRadius: 11, padding: 16, marginBottom: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: CL.tx, marginBottom: subtitle ? 2 : 9 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 10, color: CL.dm, marginBottom: 8 }}>{subtitle}</div>}
      <ResponsiveContainer width="100%" height={h}>{children}</ResponsiveContainer>
    </div>
  );
}

function Panel({ title, subtitle, children, scroll }) {
  return (
    <div style={{
      background: CL.cd, border: "1px solid " + CL.bd, borderRadius: 11,
      padding: 14, marginBottom: 12, overflowX: scroll ? "auto" : "visible",
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: CL.tx, marginBottom: subtitle ? 2 : 8 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 10, color: CL.dm, marginBottom: 8 }}>{subtitle}</div>}
      {children}
    </div>
  );
}

function TT({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{ background: "#1A2035", border: "1px solid " + CL.bd, borderRadius: 6, padding: "7px 11px", maxWidth: 300 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: CL.tx, marginBottom: 3 }}>{label}</div>
      {payload.filter((x) => x.value !== 0 && x.value !== null).map((x, i) => {
        const v = x.value;
        const disp = typeof v === "number"
          ? (x.dataKey && /rate|cv|conv|pct/i.test(String(x.dataKey)) ? v.toFixed(2) + "%"
            : v >= 1000 ? v.toLocaleString() : v.toFixed(v % 1 === 0 ? 0 : 2))
          : String(v);
        return (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 1 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: x.color || x.stroke }} />
            <span style={{ fontSize: 9, color: CL.mt }}>{x.name}:</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: CL.tx }}>{disp}</span>
          </div>
        );
      })}
    </div>
  );
}

function Leg() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
      <span style={{ fontSize: 9, color: CL.dm }}>Low</span>
      <div style={{ height: 8, flex: 1, maxWidth: 200, borderRadius: 4, background: "linear-gradient(90deg, rgba(153,27,27,0.5), rgba(217,119,6,0.5), rgba(22,163,74,0.5))" }} />
      <span style={{ fontSize: 9, color: CL.dm }}>High</span>
    </div>
  );
}

function HC({ v, val, lo, hi, inv, bold }) {
  const bg = val ? hBg(val, lo, hi, inv) : "transparent";
  const tc = val ? hTx(val, lo, hi, inv) : CL.mt;
  return (
    <td style={{
      padding: "5px 8px", textAlign: "center", fontSize: 10, fontWeight: bold ? 700 : 600,
      color: tc, background: bg, borderBottom: "1px solid " + CL.bd + "20",
      borderLeft: val ? "3px solid " + tc : "3px solid transparent",
    }}>{v}</td>
  );
}

function DTd({ value, inverse }) {
  if (value === null || value === undefined || !isFinite(value)) {
    return <td style={{ padding: "5px 6px", textAlign: "center", fontSize: 10, borderBottom: "1px solid " + CL.bd + "20", color: CL.dm }}>—</td>;
  }
  const good = inverse ? value < 0 : value >= 0;
  return (
    <td style={{
      padding: "5px 6px", textAlign: "center", fontSize: 10,
      borderBottom: "1px solid " + CL.bd + "20",
      background: good ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
    }}>
      <Pill color={good ? CL.gn : CL.rd}>{value >= 0 ? "+" : ""}{value.toFixed(1)}%</Pill>
    </td>
  );
}

function PlainTd({ children, align = "center", bold }) {
  return (
    <td style={{
      padding: "5px 6px", textAlign: align, fontSize: 10,
      color: bold ? CL.tx : CL.mt, fontWeight: bold ? 700 : 400,
      borderBottom: "1px solid " + CL.bd + "20",
    }}>{children}</td>
  );
}

function LabelTd({ children, color }) {
  return (
    <td style={{
      padding: "5px 6px", textAlign: "left", fontSize: 10, fontWeight: 600,
      color: color || CL.tx, borderBottom: "1px solid " + CL.bd + "20", whiteSpace: "nowrap",
    }}>{children}</td>
  );
}

function SectionHead({ title, range, compare, accent }) {
  return (
    <div style={{ marginBottom: 12, marginTop: 18 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: CL.tx, margin: 0 }}>{title}</h2>
      <p style={{ fontSize: 11, color: CL.mt, margin: "2px 0 0" }}>
        <span style={{ color: accent || CL.al }}>{range}</span>
        {compare && <> <span style={{ color: CL.dm }}>vs</span> <span style={{ color: CL.am }}>{compare}</span></>}
      </p>
    </div>
  );
}

function Empty({ what }) {
  return (
    <div style={{
      background: CL.cd, border: "1px dashed " + CL.bd, borderRadius: 11,
      padding: 28, textAlign: "center", color: CL.dm, fontSize: 12, marginBottom: 12,
    }}>
      No {what} returned for this date range.
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Period aggregation
// ═══════════════════════════════════════════════════════════════════
// Every metric is computed over the WHOLE selected range and compared against
// the whole comparison range. Ratios are recomputed from components, never averaged.

function totals(d) {
  if (!d) return null;
  const netSales = sum(d.s);
  const netSalesC = sum(d.sp);
  const orders = sum(d.or);
  const ordersC = sum(d.orp);
  const sessions = sum(d.se);
  const sessionsC = sum(d.sep);
  const carts = sum(d.ca);
  const cartsC = sum(d.cap);
  const reached = sum(d.rc);
  const reachedC = sum(d.rcp);
  const completed = sum(d.ck);
  const completedC = sum(d.ckp);
  return {
    netSales, netSalesC,
    grossSales: sum(d.gs), totalSales: sum(d.ts), discounts: sum(d.dc),
    orders, ordersC,
    sessions, sessionsC,
    carts, cartsC, reached, reachedC, completed, completedC,
    aov: safeDiv(netSales, orders), aovC: safeDiv(netSalesC, ordersC),
    convRate: safeDiv(completed, sessions) * 100, convRateC: safeDiv(completedC, sessionsC) * 100,
    atcRate: safeDiv(carts, sessions) * 100, atcRateC: safeDiv(cartsC, sessionsC) * 100,
    reachRate: safeDiv(reached, sessions) * 100, reachRateC: safeDiv(reachedC, sessionsC) * 100,
    cartToChk: safeDiv(reached, carts) * 100, cartToChkC: safeDiv(reachedC, cartsC) * 100,
    chkToDone: safeDiv(completed, reached) * 100, chkToDoneC: safeDiv(completedC, reachedC) * 100,
  };
}

function series(d, fields) {
  const n = (d.labels || []).length;
  return Array.from({ length: n }, (_, i) => {
    const row = { m: d.labels[i] };
    Object.entries(fields).forEach(([key, arr]) => {
      row[key] = (d[arr] && d[arr][i]) || 0;
    });
    return row;
  });
}

// ═══════════════════════════════════════════════════════════════════
// Single-store views
// ═══════════════════════════════════════════════════════════════════

function StoreOverview({ d, accent, name, rangeLabel, compareLabel }) {
  const t = totals(d);
  const cd = series(d, { s: "s", sp: "sp", cv: "cv", se: "se" });
  return (
    <div>
      <SectionHead title={`${name} — Summary`} range={rangeLabel} compare={compareLabel} accent={accent} />
      <CardGrid>
        <Card label="Net Sales" value={f$(t.netSales)} sub={"was " + f$(t.netSalesC)} delta={pct(t.netSales, t.netSalesC)} />
        <Card label="Orders" value={fInt(t.orders)} sub={"was " + fInt(t.ordersC)} delta={pct(t.orders, t.ordersC)} />
        <Card label="AOV" value={"$" + t.aov.toFixed(2)} sub={"was $" + t.aovC.toFixed(2)} delta={pct(t.aov, t.aovC)} />
        <Card label="Conv Rate" value={t.convRate.toFixed(2) + "%"} sub={"was " + t.convRateC.toFixed(2) + "%"} delta={pct(t.convRate, t.convRateC)} />
        <Card label="Sessions" value={fInt(t.sessions)} sub={"was " + fInt(t.sessionsC)} delta={pct(t.sessions, t.sessionsC)} />
      </CardGrid>
      <CB title="Net Sales" subtitle="Solid = selected range · dashed = comparison range (aligned by position)" h={250}>
        <ComposedChart data={cd}>
          <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
          <XAxis dataKey="m" tick={{ fontSize: 9, fill: CL.dm }} />
          <YAxis tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
          <Tooltip content={<TT />} />
          <Area type="monotone" dataKey="s" fill={accent + "15"} stroke="none" />
          <Line type="monotone" dataKey="s" stroke={accent} strokeWidth={2.5} dot={{ r: 2.5, fill: accent }} name="Selected" />
          <Line type="monotone" dataKey="sp" stroke={CL.am} strokeWidth={2} strokeDasharray="5 5" dot={false} name="Comparison" />
        </ComposedChart>
      </CB>
      <CB title="Conversion Rate" h={210}>
        <ComposedChart data={cd}>
          <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
          <XAxis dataKey="m" tick={{ fontSize: 9, fill: CL.dm }} />
          <YAxis tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => v + "%"} />
          <Tooltip content={<TT />} />
          <Line type="monotone" dataKey="cv" stroke={accent} strokeWidth={2.5} dot={{ r: 2.5, fill: accent }} name="Conv rate" />
        </ComposedChart>
      </CB>
    </div>
  );
}

function SalesView({ d, accent, rangeLabel, compareLabel }) {
  const cd = series(d, { s: "s", sp: "sp", gs: "gs", dc: "dc" });
  const r = rng(d.s);
  const t = totals(d);
  return (
    <div>
      <SectionHead title="Net Sales" range={rangeLabel} compare={compareLabel} accent={accent} />
      <CardGrid>
        <Card label="Net Sales" value={f$(t.netSales)} sub={"was " + f$(t.netSalesC)} delta={pct(t.netSales, t.netSalesC)} />
        <Card label="Gross Sales" value={f$(t.grossSales)} />
        <Card label="Discounts" value={f$(t.discounts)} />
        <Card label="Avg / bucket" value={f$(mean(d.s))} />
      </CardGrid>
      <CB title="Net Sales Trend" h={280}>
        <ComposedChart data={cd}>
          <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
          <XAxis dataKey="m" tick={{ fontSize: 9, fill: CL.dm }} />
          <YAxis tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
          <Tooltip content={<TT />} />
          <Area type="monotone" dataKey="s" fill={accent + "15"} stroke="none" />
          <Line type="monotone" dataKey="s" stroke={accent} strokeWidth={2.5} dot={{ r: 2.5, fill: accent }} name="Net sales" />
          <Line type="monotone" dataKey="sp" stroke={CL.am} strokeWidth={2} strokeDasharray="5 5" dot={false} name="Comparison" />
        </ComposedChart>
      </CB>
      <Panel title="Breakdown by period" scroll>
        <Leg />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: "left" }}>Period</th>
              <th style={{ ...thS, color: accent }}>Net Sales</th>
              <th style={thS}>Comparison</th>
              <th style={thS}>Δ%</th>
              <th style={thS}>Gross</th>
              <th style={thS}>Discounts</th>
            </tr>
          </thead>
          <tbody>
            {(d.labels || []).map((m, i) => (
              <tr key={i}>
                <LabelTd>{m}</LabelTd>
                <HC v={f$(d.s[i] || 0)} val={d.s[i]} lo={r.lo} hi={r.hi} />
                <PlainTd>{f$(d.sp[i] || 0)}</PlainTd>
                <DTd value={d.sp[i] ? pct(d.s[i] || 0, d.sp[i]) : null} />
                <PlainTd>{f$(d.gs[i] || 0)}</PlainTd>
                <PlainTd>{f$(d.dc[i] || 0)}</PlainTd>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function ConversionView({ d, accent, rangeLabel, compareLabel }) {
  const cd = series(d, { cv: "cv", cvp: "cvp", se: "se", ck: "ck" });
  const r = rng(d.cv);
  const t = totals(d);
  return (
    <div>
      <SectionHead title="Conversion" range={rangeLabel} compare={compareLabel} accent={accent} />
      <CardGrid>
        <Card label="Conv Rate" value={t.convRate.toFixed(2) + "%"} sub={"was " + t.convRateC.toFixed(2) + "%"} delta={pct(t.convRate, t.convRateC)} />
        <Card label="Sessions" value={fInt(t.sessions)} sub={"was " + fInt(t.sessionsC)} delta={pct(t.sessions, t.sessionsC)} />
        <Card label="Converted Sessions" value={fInt(t.completed)} sub={"was " + fInt(t.completedC)} delta={pct(t.completed, t.completedC)} />
        <Card label="Add-to-Cart Rate" value={t.atcRate.toFixed(2) + "%"} sub={"was " + t.atcRateC.toFixed(2) + "%"} delta={pct(t.atcRate, t.atcRateC)} />
      </CardGrid>
      <CB title="Conversion Rate vs Sessions" h={280}>
        <ComposedChart data={cd}>
          <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
          <XAxis dataKey="m" tick={{ fontSize: 9, fill: CL.dm }} />
          <YAxis yAxisId="l" tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => v + "%"} />
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
          <Tooltip content={<TT />} />
          <Bar yAxisId="r" dataKey="se" fill={CL.gr} name="Sessions" radius={[3, 3, 0, 0]} />
          <Line yAxisId="l" type="monotone" dataKey="cv" stroke={accent} strokeWidth={2.5} dot={{ r: 2.5, fill: accent }} name="Conv rate" />
          <Line yAxisId="l" type="monotone" dataKey="cvp" stroke={CL.am} strokeWidth={2} strokeDasharray="5 5" dot={false} name="Comparison" />
        </ComposedChart>
      </CB>
      <Panel title="Conversion by period" scroll>
        <Leg />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: "left" }}>Period</th>
              <th style={{ ...thS, color: accent }}>Conv %</th>
              <th style={thS}>Comparison</th>
              <th style={thS}>Δ%</th>
              <th style={thS}>Sessions</th>
              <th style={thS}>Converted</th>
            </tr>
          </thead>
          <tbody>
            {(d.labels || []).map((m, i) => (
              <tr key={i}>
                <LabelTd>{m}</LabelTd>
                <HC v={(d.cv[i] || 0).toFixed(2) + "%"} val={d.cv[i]} lo={r.lo} hi={r.hi} />
                <PlainTd>{(d.cvp[i] || 0).toFixed(2)}%</PlainTd>
                <DTd value={d.cvp[i] ? pct(d.cv[i] || 0, d.cvp[i]) : null} />
                <PlainTd>{fInt(d.se[i] || 0)}</PlainTd>
                <PlainTd>{fInt(d.ck[i] || 0)}</PlainTd>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

function AovView({ d, accent, rangeLabel, compareLabel }) {
  const cd = series(d, { av: "av", ap: "ap", or: "or" });
  const r = rng(d.av);
  const t = totals(d);
  return (
    <div>
      <SectionHead title="AOV & Orders" range={rangeLabel} compare={compareLabel} accent={accent} />
      <CardGrid>
        <Card label="AOV" value={"$" + t.aov.toFixed(2)} sub={"was $" + t.aovC.toFixed(2)} delta={pct(t.aov, t.aovC)} />
        <Card label="Orders" value={fInt(t.orders)} sub={"was " + fInt(t.ordersC)} delta={pct(t.orders, t.ordersC)} />
        <Card label="Net Sales" value={f$(t.netSales)} delta={pct(t.netSales, t.netSalesC)} />
        <Card label="Discount Rate" value={(safeDiv(t.discounts, t.grossSales) * 100).toFixed(1) + "%"} />
      </CardGrid>
      <CB title="AOV vs Orders" h={280}>
        <ComposedChart data={cd}>
          <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
          <XAxis dataKey="m" tick={{ fontSize: 9, fill: CL.dm }} />
          <YAxis yAxisId="l" tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => "$" + v.toFixed(0)} />
          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: CL.dm }} />
          <Tooltip content={<TT />} />
          <Bar yAxisId="r" dataKey="or" fill={CL.gr} name="Orders" radius={[3, 3, 0, 0]} />
          <Line yAxisId="l" type="monotone" dataKey="av" stroke={accent} strokeWidth={2.5} dot={{ r: 2.5, fill: accent }} name="AOV" />
          <Line yAxisId="l" type="monotone" dataKey="ap" stroke={CL.am} strokeWidth={2} strokeDasharray="5 5" dot={false} name="Comparison AOV" />
        </ComposedChart>
      </CB>
      <Panel title="AOV & orders by period" scroll>
        <Leg />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: "left" }}>Period</th>
              <th style={{ ...thS, color: accent }}>AOV</th>
              <th style={thS}>Comparison</th>
              <th style={thS}>Δ%</th>
              <th style={thS}>Orders</th>
              <th style={thS}>Net Sales</th>
            </tr>
          </thead>
          <tbody>
            {(d.labels || []).map((m, i) => (
              <tr key={i}>
                <LabelTd>{m}</LabelTd>
                <HC v={"$" + (d.av[i] || 0).toFixed(2)} val={d.av[i]} lo={r.lo} hi={r.hi} />
                <PlainTd>{"$" + (d.ap[i] || 0).toFixed(2)}</PlainTd>
                <DTd value={d.ap[i] ? pct(d.av[i] || 0, d.ap[i]) : null} />
                <PlainTd>{fInt(d.or[i] || 0)}</PlainTd>
                <PlainTd>{f$(d.s[i] || 0)}</PlainTd>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

const FUNNEL_STAGES = ["Sessions", "Add to Cart", "Reached Checkout", "Completed"];
const STAGE_COLORS = [CL.dm, CL.am, "#3B82F6", CL.gn];

function FunnelPanel({ label, values, color }) {
  const top = values[0] || 0;
  return (
    <div style={{ background: CL.cd, border: "1px solid " + CL.bd, borderRadius: 11, padding: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color, marginBottom: 10 }}>{label}</div>
      {FUNNEL_STAGES.map((st, si) => {
        const val = Math.round(values[si] || 0);
        const share = top > 0 ? (val / top) * 100 : 0;
        const drop = si > 0 && values[si - 1] > 0
          ? (((values[si - 1] - val) / values[si - 1]) * 100).toFixed(1)
          : null;
        return (
          <div key={si} style={{ marginBottom: si < 3 ? 2 : 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
              <span style={{ fontSize: 9, color: CL.mt, fontWeight: 600 }}>{st}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: CL.tx }}>
                {val.toLocaleString()} <span style={{ fontSize: 8, color: CL.dm }}>({share.toFixed(1)}%)</span>
              </span>
            </div>
            <div style={{ height: 18, background: CL.bg, borderRadius: 4, overflow: "hidden", marginBottom: 1 }}>
              <div style={{ height: "100%", width: Math.max(share, 1.5) + "%", background: STAGE_COLORS[si], borderRadius: 4 }} />
            </div>
            {drop && (
              <div style={{ textAlign: "center", fontSize: 8, color: CL.rd, fontWeight: 600, padding: "1px 0" }}>
                {"▼"} {drop}% drop
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FunnelView({ d, accent, rangeLabel, compareLabel, stores, byStore }) {
  const t = totals(d);
  const cur = [t.sessions, t.carts, t.reached, t.completed];
  const cmp = [t.sessionsC, t.cartsC, t.reachedC, t.completedC];
  const steps = [
    { l: "Sess → Cart", a: t.atcRate, b: t.atcRateC },
    { l: "Cart → Chk", a: t.cartToChk, b: t.cartToChkC },
    { l: "Chk → Complete", a: t.chkToDone, b: t.chkToDoneC },
    { l: "Overall", a: t.convRate, b: t.convRateC },
  ];
  return (
    <div>
      <SectionHead title="Conversion Funnel" range={rangeLabel} compare={compareLabel} accent={accent} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
        <FunnelPanel label={"Selected · " + rangeLabel} values={cur} color={accent} />
        <FunnelPanel label={"Comparison · " + compareLabel} values={cmp} color={CL.am} />
      </div>
      <CardGrid>
        {steps.map((m, i) => (
          <Card key={i} label={m.l} value={m.a.toFixed(2) + "%"} sub={"was " + m.b.toFixed(2) + "%"} delta={m.b > 0 ? pct(m.a, m.b) : undefined} />
        ))}
      </CardGrid>
      {stores && stores.length > 1 && (
        <Panel title="Stage pass-through by store" subtitle="Selected range vs comparison range" scroll>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: "left", minWidth: 110 }}>Store</th>
                {steps.map((s) => (
                  <th key={s.l} colSpan={3} style={thS}>{s.l}</th>
                ))}
              </tr>
              <tr>
                <th style={{ ...thS, textAlign: "left" }} />
                {steps.flatMap((s, i) => [
                  <th key={i + "a"} style={{ ...thS, fontSize: 7, color: CL.mt }}>Sel</th>,
                  <th key={i + "b"} style={{ ...thS, fontSize: 7, color: CL.mt }}>Cmp</th>,
                  <th key={i + "d"} style={{ ...thS, fontSize: 7, color: CL.mt }}>Δ</th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {stores.map((st) => {
                const sd = byStore[st.key];
                if (!sd) return null;
                const tt = totals(sd);
                const rows = [
                  [tt.atcRate, tt.atcRateC],
                  [tt.cartToChk, tt.cartToChkC],
                  [tt.chkToDone, tt.chkToDoneC],
                  [tt.convRate, tt.convRateC],
                ];
                return (
                  <tr key={st.key}>
                    <LabelTd color={st.color}>{st.label}</LabelTd>
                    {rows.flatMap(([a, b], i) => [
                      <PlainTd key={i + "a"} bold>{a.toFixed(2)}%</PlainTd>,
                      <PlainTd key={i + "b"}>{b.toFixed(2)}%</PlainTd>,
                      <DTd key={i + "d"} value={b > 0 ? pct(a, b) : null} />,
                    ])}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function TrafficView({ d, accent, rangeLabel, compareLabel }) {
  const refs = d.rf || [];
  const t = totals(d);
  const r = rng(refs.map((x) => x.s));
  const cd = series(d, { se: "se", sep: "sep", acr: "acr", ccr: "ccr" });
  return (
    <div>
      <SectionHead title="Traffic" range={rangeLabel} compare={compareLabel} accent={accent} />
      <CardGrid>
        <Card label="Sessions" value={fInt(t.sessions)} sub={"was " + fInt(t.sessionsC)} delta={pct(t.sessions, t.sessionsC)} />
        <Card label="Add-to-Cart Rate" value={t.atcRate.toFixed(2) + "%"} sub={"was " + t.atcRateC.toFixed(2) + "%"} delta={pct(t.atcRate, t.atcRateC)} />
        <Card label="Reached-Checkout Rate" value={t.reachRate.toFixed(2) + "%"} sub={"was " + t.reachRateC.toFixed(2) + "%"} delta={pct(t.reachRate, t.reachRateC)} />
        <Card label="Referrers Tracked" value={String(refs.length)} />
      </CardGrid>
      <CB title="Sessions Trend" h={240}>
        <ComposedChart data={cd}>
          <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
          <XAxis dataKey="m" tick={{ fontSize: 9, fill: CL.dm }} />
          <YAxis tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
          <Tooltip content={<TT />} />
          <Area type="monotone" dataKey="se" fill={accent + "15"} stroke="none" />
          <Line type="monotone" dataKey="se" stroke={accent} strokeWidth={2.5} dot={{ r: 2.5, fill: accent }} name="Sessions" />
          <Line type="monotone" dataKey="sep" stroke={CL.am} strokeWidth={2} strokeDasharray="5 5" dot={false} name="Comparison" />
        </ComposedChart>
      </CB>
      {refs.length === 0 ? <Empty what="referrer data" /> : (
        <Panel title="Top Referrers" scroll>
          <Leg />
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: "left" }}>Referrer</th>
                <th style={{ ...thS, color: accent }}>Sessions</th>
                <th style={thS}>Share</th>
                <th style={thS}>Conv %</th>
              </tr>
            </thead>
            <tbody>
              {refs.map((rf, i) => (
                <tr key={i}>
                  <LabelTd>{rf.n}</LabelTd>
                  <HC v={fInt(rf.s)} val={rf.s} lo={r.lo} hi={r.hi} />
                  <PlainTd>{(safeDiv(rf.s, t.sessions) * 100).toFixed(1)}%</PlainTd>
                  <HC v={(rf.r || 0).toFixed(2) + "%"} val={rf.r} lo={0} hi={Math.max(...refs.map((x) => x.r || 0), 1)} />
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

function CampaignView({ d, accent, rangeLabel, stores }) {
  const camps = d.ut || [];
  const chans = d.uc || [];
  const totSa = sum(camps.map((c) => c.sa));
  const totSe = sum(camps.map((c) => c.se));
  const totOr = sum(camps.map((c) => c.or));
  const saR = rng(camps.map((c) => c.sa));
  const isConsolidated = Boolean(stores && stores.length > 1);

  if (camps.length === 0 && chans.length === 0) {
    return (
      <div>
        <SectionHead title="Campaigns" range={rangeLabel} accent={accent} />
        <Empty what="campaign / UTM data" />
      </div>
    );
  }

  return (
    <div>
      <SectionHead title="Campaign Performance" range={rangeLabel} accent={accent} />
      <CardGrid min={130}>
        <Card label="Campaign Revenue" value={f$(totSa)} />
        <Card label="Campaign Sessions" value={fInt(totSe)} />
        <Card label="Campaign Orders" value={fInt(totOr)} />
        <Card label="Conv Rate" value={(safeDiv(totOr, totSe) * 100).toFixed(2) + "%"} />
        <Card label="AOV" value={"$" + safeDiv(totSa, totOr).toFixed(2)} />
      </CardGrid>

      {chans.length > 0 && (
        <CB title="Revenue by Channel" h={220}>
          <BarChart data={chans.slice(0, 10).map((c) => ({ n: c.ch, sa: c.sa, cl: c.cl }))}>
            <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
            <XAxis dataKey="n" tick={{ fontSize: 9, fill: CL.dm }} />
            <YAxis tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
            <Tooltip content={<TT />} />
            <Bar dataKey="sa" name="Revenue" radius={[4, 4, 0, 0]}>
              {chans.slice(0, 10).map((c, i) => <Cell key={i} fill={c.cl} />)}
            </Bar>
          </BarChart>
        </CB>
      )}

      {chans.length > 0 && (
        <Panel title="Channel Summary" scroll>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thS, textAlign: "left" }}>Channel</th>
                <th style={thS}>Campaigns</th>
                <th style={thS}>Sessions</th>
                <th style={thS}>Revenue</th>
                <th style={thS}>Orders</th>
                <th style={thS}>Conv %</th>
                <th style={thS}>AOV</th>
              </tr>
            </thead>
            <tbody>
              {chans.map((c, i) => (
                <tr key={i}>
                  <LabelTd>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: c.cl, marginRight: 5 }} />
                    {c.ch}
                  </LabelTd>
                  <PlainTd>{c.campaigns}</PlainTd>
                  <PlainTd>{fInt(c.se)}</PlainTd>
                  <HC v={f$(c.sa)} val={c.sa} lo={0} hi={Math.max(...chans.map((x) => x.sa), 1)} />
                  <PlainTd>{fInt(c.or)}</PlainTd>
                  <PlainTd>{(c.cv || 0).toFixed(2)}%</PlainTd>
                  <PlainTd>{"$" + (c.av || 0).toFixed(2)}</PlainTd>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title={`Campaigns (top ${Math.min(camps.length, 40)})`} scroll>
        <Leg />
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: "left", minWidth: 160 }}>Campaign</th>
              <th style={{ ...thS, textAlign: "left" }}>Channel</th>
              {isConsolidated && <th style={{ ...thS, textAlign: "left" }}>Stores</th>}
              <th style={thS}>Sessions</th>
              <th style={thS}>Revenue</th>
              <th style={thS}>Orders</th>
              <th style={thS}>Conv %</th>
              <th style={thS}>AOV</th>
            </tr>
          </thead>
          <tbody>
            {camps.slice(0, 40).map((c, i) => (
              <tr key={i}>
                <LabelTd>{c.nm}</LabelTd>
                <LabelTd color={c.cl}>{c.ch}</LabelTd>
                {isConsolidated && (
                  <td style={{ padding: "5px 6px", borderBottom: "1px solid " + CL.bd + "20" }}>
                    {Object.entries(c.byStore || {}).map(([k, v]) => (
                      <span key={k} title={`${v.label}: ${f$(v.sa)}`} style={{
                        display: "inline-block", width: 7, height: 7, borderRadius: "50%",
                        background: v.color, marginRight: 3,
                      }} />
                    ))}
                  </td>
                )}
                <PlainTd>{fInt(c.se)}</PlainTd>
                <HC v={f$(c.sa)} val={c.sa} lo={saR.lo} hi={saR.hi} />
                <PlainTd>{fInt(c.or)}</PlainTd>
                <PlainTd>{(c.cv || 0).toFixed(2)}%</PlainTd>
                <PlainTd>{"$" + (c.av || 0).toFixed(2)}</PlainTd>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Consolidated portfolio overview
// ═══════════════════════════════════════════════════════════════════

function PortfolioOverview({ all, stores, byStore, rangeLabel, compareLabel }) {
  const t = totals(all);
  const perStore = stores
    .map((st) => ({ st, t: totals(byStore[st.key]) }))
    .filter((x) => x.t)
    .sort((a, b) => b.t.netSales - a.t.netSales);

  const trend = useMemo(() => {
    const n = (all.labels || []).length;
    return Array.from({ length: n }, (_, i) => {
      const row = { m: all.labels[i] };
      stores.forEach((st) => {
        const sd = byStore[st.key];
        row[st.key] = (sd && sd.s[i]) || 0;
      });
      return row;
    });
  }, [all, stores, byStore]);

  const metricRows = [
    { l: "Net Sales", get: (x) => x.netSales, getC: (x) => x.netSalesC, fmt: f$ },
    { l: "Orders", get: (x) => x.orders, getC: (x) => x.ordersC, fmt: fInt },
    { l: "AOV", get: (x) => x.aov, getC: (x) => x.aovC, fmt: (v) => "$" + v.toFixed(2) },
    { l: "Sessions", get: (x) => x.sessions, getC: (x) => x.sessionsC, fmt: fInt },
    { l: "Conv %", get: (x) => x.convRate, getC: (x) => x.convRateC, fmt: (v) => v.toFixed(2) + "%" },
  ];

  const salesR = rng(perStore.map((p) => p.t.netSales));

  return (
    <div>
      <SectionHead title="Portfolio Summary — All Brands" range={rangeLabel} compare={compareLabel} />
      <CardGrid min={150}>
        <Card label="Net Sales" value={f$(t.netSales)} sub={"was " + f$(t.netSalesC)} delta={pct(t.netSales, t.netSalesC)} />
        <Card label="Orders" value={fInt(t.orders)} sub={"was " + fInt(t.ordersC)} delta={pct(t.orders, t.ordersC)} />
        <Card label="Blended AOV" value={"$" + t.aov.toFixed(2)} sub={"was $" + t.aovC.toFixed(2)} delta={pct(t.aov, t.aovC)} />
        <Card label="Blended Conv %" value={t.convRate.toFixed(2) + "%"} sub={"was " + t.convRateC.toFixed(2) + "%"} delta={pct(t.convRate, t.convRateC)} />
        <Card label="Sessions" value={fInt(t.sessions)} sub={"was " + fInt(t.sessionsC)} delta={pct(t.sessions, t.sessionsC)} />
        <Card label="Brands" value={String(perStore.length)} />
      </CardGrid>

      <Panel title="Store Comparison" subtitle="Selected range vs comparison range · ratios recomputed, not averaged" scroll>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...thS, textAlign: "left", minWidth: 120 }}>Store</th>
              {metricRows.map((m) => (
                <th key={m.l} colSpan={3} style={thS}>{m.l}</th>
              ))}
              <th style={thS}>Rev Share</th>
            </tr>
            <tr>
              <th style={{ ...thS, textAlign: "left" }} />
              {metricRows.flatMap((m, i) => [
                <th key={i + "a"} style={{ ...thS, fontSize: 7, color: CL.mt }}>Sel</th>,
                <th key={i + "b"} style={{ ...thS, fontSize: 7, color: CL.mt }}>Cmp</th>,
                <th key={i + "d"} style={{ ...thS, fontSize: 7, color: CL.mt }}>Δ</th>,
              ])}
              <th style={{ ...thS, fontSize: 7, color: CL.mt }}>%</th>
            </tr>
          </thead>
          <tbody>
            {perStore.map(({ st, t: tt }) => (
              <tr key={st.key}>
                <LabelTd color={st.color}>{st.label}</LabelTd>
                {metricRows.flatMap((m, i) => [
                  <PlainTd key={i + "a"} bold>{m.fmt(m.get(tt))}</PlainTd>,
                  <PlainTd key={i + "b"}>{m.fmt(m.getC(tt))}</PlainTd>,
                  <DTd key={i + "d"} value={m.getC(tt) > 0 ? pct(m.get(tt), m.getC(tt)) : null} />,
                ])}
                <HC v={(safeDiv(tt.netSales, t.netSales) * 100).toFixed(1) + "%"} val={tt.netSales} lo={salesR.lo} hi={salesR.hi} />
              </tr>
            ))}
            <tr style={{ borderTop: "2px solid " + CL.bd }}>
              <LabelTd>All Brands</LabelTd>
              {metricRows.flatMap((m, i) => [
                <PlainTd key={i + "a"} bold>{m.fmt(m.get(t))}</PlainTd>,
                <PlainTd key={i + "b"}>{m.fmt(m.getC(t))}</PlainTd>,
                <DTd key={i + "d"} value={m.getC(t) > 0 ? pct(m.get(t), m.getC(t)) : null} />,
              ])}
              <PlainTd bold>100%</PlainTd>
            </tr>
          </tbody>
        </table>
      </Panel>

      <CB title="Net Sales by Store" h={300}>
        <ComposedChart data={trend}>
          <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
          <XAxis dataKey="m" tick={{ fontSize: 9, fill: CL.dm }} />
          <YAxis tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => "$" + (v / 1000).toFixed(0) + "k"} />
          <Tooltip content={<TT />} />
          {stores.map((st) => (
            <Line key={st.key} type="monotone" dataKey={st.key} stroke={st.color}
              strokeWidth={2} dot={{ r: 2, fill: st.color }} name={st.label} />
          ))}
        </ComposedChart>
      </CB>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 12 }}>
        <CB title="Revenue Contribution" h={260}>
          <PieChart>
            <Tooltip content={<TT />} />
            <Pie data={perStore.map((p) => ({ name: p.st.label, value: p.t.netSales }))}
              dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50}
              stroke={CL.bg} strokeWidth={2}>
              {perStore.map((p, i) => <Cell key={i} fill={p.st.color} />)}
            </Pie>
          </PieChart>
        </CB>
        <CB title="Conversion Rate by Store" h={260}>
          <BarChart data={perStore.map((p) => ({ n: p.st.label, cv: p.t.convRate, cl: p.st.color }))} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" stroke={CL.gr} />
            <XAxis type="number" tick={{ fontSize: 9, fill: CL.dm }} tickFormatter={(v) => v + "%"} />
            <YAxis type="category" dataKey="n" tick={{ fontSize: 9, fill: CL.dm }} width={90} />
            <Tooltip content={<TT />} />
            <Bar dataKey="cv" name="Conv rate" radius={[0, 4, 4, 0]}>
              {perStore.map((p, i) => <Cell key={i} fill={p.st.color} />)}
            </Bar>
          </BarChart>
        </CB>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Date range controls
// ═══════════════════════════════════════════════════════════════════

function iso(d) {
  return new Date(d).toISOString().slice(0, 10);
}
function addDays(dateStr, n) {
  return iso(new Date(dateStr + "T00:00:00Z").getTime() + n * 86400000);
}
function daysIn(from, to) {
  return Math.round((new Date(to + "T00:00:00Z") - new Date(from + "T00:00:00Z")) / 86400000) + 1;
}
function fmtRange(from, to) {
  const opts = { month: "short", day: "numeric", year: "2-digit", timeZone: "UTC" };
  const a = new Date(from + "T00:00:00Z").toLocaleDateString("en-US", opts);
  const b = new Date(to + "T00:00:00Z").toLocaleDateString("en-US", opts);
  return `${a} – ${b}`;
}

const PRESETS = [
  { id: "7d", label: "Last 7 days", days: 7 },
  { id: "30d", label: "Last 30 days", days: 30 },
  { id: "90d", label: "Last 90 days", days: 90 },
  { id: "12m", label: "Last 12 months", days: 365 },
];

function DateInput({ value, onChange, min, max, accent }) {
  return (
    <input type="date" value={value} min={min} max={max}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      style={{
        background: CL.bg, color: CL.tx, border: "1px solid " + (accent || CL.bd),
        borderRadius: 5, padding: "4px 7px", fontSize: 10, fontFamily: "inherit",
        colorScheme: "dark",
      }} />
  );
}

function ControlBar({ range, compare, onApply, granularity, onGranularity }) {
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [cfrom, setCfrom] = useState(compare.from);
  const [cto, setCto] = useState(compare.to);

  const dirty = from !== range.from || to !== range.to || cfrom !== compare.from || cto !== compare.to;
  const yesterday = iso(Date.now() - 86400000);

  function applyPreset(days) {
    const nTo = yesterday;
    const nFrom = addDays(nTo, -(days - 1));
    const nCto = addDays(nFrom, -1);
    const nCfrom = addDays(nCto, -(days - 1));
    setFrom(nFrom); setTo(nTo); setCfrom(nCfrom); setCto(nCto);
    onApply({ from: nFrom, to: nTo }, { from: nCfrom, to: nCto });
  }

  function autoCompare(mode) {
    const len = daysIn(from, to);
    let nCfrom, nCto;
    if (mode === "prev") {
      nCto = addDays(from, -1);
      nCfrom = addDays(nCto, -(len - 1));
    } else {
      nCfrom = addDays(from, -365);
      nCto = addDays(to, -365);
    }
    setCfrom(nCfrom); setCto(nCto);
    onApply({ from, to }, { from: nCfrom, to: nCto });
  }

  const btn = (active) => ({
    padding: "4px 9px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit",
    fontSize: 10, fontWeight: 600,
    border: "1px solid " + (active ? CL.al : CL.bd),
    background: active ? CL.al + "18" : CL.bg,
    color: active ? CL.al : CL.mt,
  });

  return (
    <div style={{ background: CL.bg, border: "1px solid " + CL.bd, borderRadius: 8, padding: "10px 12px", marginBottom: 8 }}>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 9 }}>
        {PRESETS.map((p) => (
          <button key={p.id} onClick={() => applyPreset(p.days)}
            style={btn(daysIn(range.from, range.to) === p.days && range.to === yesterday)}>
            {p.label}
          </button>
        ))}
        <span style={{ width: 1, background: CL.bd, margin: "0 4px" }} />
        {["day", "week", "month"].map((g) => (
          <button key={g} onClick={() => onGranularity(g)} style={btn(granularity === g)}>{g}</button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: CL.al, marginBottom: 4 }}>
            {"▸"} Date range
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <DateInput value={from} max={to} accent={CL.al} onChange={setFrom} />
            <span style={{ fontSize: 9, color: CL.dm }}>to</span>
            <DateInput value={to} min={from} max={yesterday} accent={CL.al} onChange={setTo} />
          </div>
        </div>

        <div>
          <div style={{ fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: CL.am, marginBottom: 4 }}>
            {"◆"} Compare to
          </div>
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <DateInput value={cfrom} max={cto} accent={CL.am} onChange={setCfrom} />
            <span style={{ fontSize: 9, color: CL.dm }}>to</span>
            <DateInput value={cto} min={cfrom} accent={CL.am} onChange={setCto} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 5 }}>
          <button onClick={() => autoCompare("prev")} style={btn(false)}>Previous period</button>
          <button onClick={() => autoCompare("year")} style={btn(false)}>Previous year</button>
        </div>

        <button onClick={() => onApply({ from, to }, { from: cfrom, to: cto })}
          disabled={!dirty}
          style={{
            padding: "6px 14px", borderRadius: 6, border: "none",
            cursor: dirty ? "pointer" : "default", fontFamily: "inherit",
            fontSize: 11, fontWeight: 700,
            background: dirty ? CL.al : CL.gr, color: dirty ? CL.bg : CL.dm,
          }}>
          Apply
        </button>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 9, flexWrap: "wrap" }}>
        <span style={{ color: CL.al }}>{"▸"} {fmtRange(range.from, range.to)} ({daysIn(range.from, range.to)}d)</span>
        <span style={{ color: CL.am }}>{"◆"} {fmtRange(compare.from, compare.to)} ({daysIn(compare.from, compare.to)}d)</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Warnings
// ═══════════════════════════════════════════════════════════════════

function Warnings({ warnings, failedStores }) {
  const [open, setOpen] = useState(false);
  const items = [
    ...(failedStores || []).map((f) => ({
      severity: "error",
      text: `${f.label}: ${f.message}`,
    })),
    ...(warnings || []).map((w) => ({
      severity: w.code === "ACCESS_DENIED" || w.code === "BAD_TOKEN" ? "error" : "warn",
      text: `${w.store} · ${w.dataset}: ${w.message}`,
    })),
  ];
  if (items.length === 0) return null;
  const errors = items.filter((i) => i.severity === "error").length;
  const color = errors > 0 ? CL.rd : CL.am;

  return (
    <div style={{ margin: "10px 0 4px" }}>
      <button onClick={() => setOpen(!open)} style={{
        display: "flex", alignItems: "center", gap: 7, width: "100%",
        background: color + "10", border: "1px solid " + color + "35",
        borderRadius: 8, padding: "8px 12px", cursor: "pointer",
        fontFamily: "inherit", color: CL.tx, fontSize: 11, textAlign: "left",
      }}>
        <span style={{ color }}>{errors > 0 ? "⚠" : "ℹ"}</span>
        <span style={{ flex: 1 }}>
          {errors > 0
            ? `${errors} store/dataset error${errors > 1 ? "s" : ""}`
            : `${items.length} data notice${items.length > 1 ? "s" : ""}`}
          {" — "}{open ? "hide" : "show details"}
        </span>
      </button>
      {open && (
        <div style={{ background: CL.cd, border: "1px solid " + CL.bd, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "10px 12px" }}>
          {items.map((i, idx) => (
            <div key={idx} style={{
              fontSize: 10, lineHeight: 1.6, marginBottom: 6,
              color: i.severity === "error" ? "#FCA5A5" : CL.mt,
            }}>• {i.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main
// ═══════════════════════════════════════════════════════════════════

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "Net Sales" },
  { id: "conversion", label: "Conversion" },
  { id: "aov", label: "AOV & Orders" },
  { id: "funnel", label: "Funnel" },
  { id: "traffic", label: "Traffic" },
  { id: "campaigns", label: "Campaigns" },
];

export default function Dashboard({ payload, onRefetch, loading }) {
  const [view, setView] = useState("all");
  const [tab, setTab] = useState("overview");

  const stores = payload.stores || [];
  const byStore = payload.byStore || {};
  const all = payload.all;
  const range = payload.range;
  const compare = payload.compare;

  const rangeLabel = fmtRange(range.from, range.to);
  const compareLabel = fmtRange(compare.from, compare.to);

  const isAll = view === "all";
  const current = isAll ? all : byStore[view];
  const currentStore = stores.find((s) => s.key === view);
  const accent = isAll ? CL.al : currentStore?.color || CL.al;
  const name = isAll ? "All Brands" : currentStore?.label || view;

  const viewOptions = [
    { key: "all", label: "All Brands", color: CL.al, icon: "★" },
    ...stores,
  ];

  function renderTab() {
    if (!current) {
      return <Empty what="data" />;
    }
    const shared = { d: current, accent, rangeLabel, compareLabel, name };
    switch (tab) {
      case "overview":
        return isAll
          ? <PortfolioOverview all={all} stores={stores} byStore={byStore} rangeLabel={rangeLabel} compareLabel={compareLabel} />
          : <StoreOverview {...shared} />;
      case "sales": return <SalesView {...shared} />;
      case "conversion": return <ConversionView {...shared} />;
      case "aov": return <AovView {...shared} />;
      case "funnel":
        return <FunnelView {...shared} stores={isAll ? stores : null} byStore={byStore} />;
      case "traffic": return <TrafficView {...shared} />;
      case "campaigns":
        return <CampaignView {...shared} stores={isAll ? stores : null} />;
      default: return null;
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: CL.bg, color: CL.tx, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <div style={{ background: CL.cd, borderBottom: "1px solid " + CL.bd, padding: "12px 16px 10px", position: "sticky", top: 0, zIndex: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8, gap: 10, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Shopify Portfolio Dashboard</h1>
            <p style={{ fontSize: 9, color: CL.mt, margin: "1px 0 0" }}>
              {stores.length} store{stores.length === 1 ? "" : "s"} connected
              {payload.granularity ? ` · ${payload.granularity} buckets` : ""}
              {payload.lastUpdated ? ` · fetched ${new Date(payload.lastUpdated).toLocaleTimeString()}` : ""}
              {payload.meta?.elapsedMs ? ` · ${(payload.meta.elapsedMs / 1000).toFixed(1)}s` : ""}
            </p>
          </div>
          <button onClick={() => onRefetch({ forceRefresh: true })} disabled={loading}
            style={{
              display: "flex", alignItems: "center", gap: 5, background: CL.bg,
              border: "1px solid " + CL.bd, borderRadius: 6, padding: "5px 11px",
              cursor: loading ? "default" : "pointer", fontFamily: "inherit",
              color: loading ? CL.dm : CL.mt, fontSize: 10, fontWeight: 600,
            }}>
            {loading ? "Loading…" : "↻ Refresh live data"}
          </button>
        </div>

        <ControlBar
          range={range}
          compare={compare}
          granularity={payload.granularity}
          onGranularity={(g) => onRefetch({ granularity: g })}
          onApply={(r, c) => onRefetch({ range: r, compare: c })}
        />

        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {viewOptions.map((o) => {
            const active = view === o.key;
            return (
              <button key={o.key} onClick={() => setView(o.key)} style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 11px",
                borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
                border: active ? "2px solid " + o.color : "1px solid " + CL.bd,
                background: active ? o.color + "15" : CL.cd,
              }}>
                <div style={{
                  width: 20, height: 20, borderRadius: 5,
                  background: active ? o.color : CL.dm + "30",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 9, fontWeight: 700, color: active ? "#0B0F1A" : CL.dm,
                }}>{o.icon}</div>
                <span style={{ fontSize: 11, fontWeight: 600, color: active ? CL.tx : CL.mt }}>{o.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 2, padding: "6px 16px", borderBottom: "1px solid " + CL.bd, background: CL.cd, overflowX: "auto" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "6px 14px", borderRadius: 6, border: "none", cursor: "pointer",
            fontFamily: "inherit", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
            background: tab === t.id ? accent : "transparent",
            color: tab === t.id ? "#0B0F1A" : CL.mt,
          }}>{t.label}</button>
        ))}
      </div>

      <div style={{ padding: "0 16px 40px", maxWidth: 1280, margin: "0 auto" }}>
        <Warnings warnings={payload.warnings} failedStores={payload.failedStores} />
        <div style={{ opacity: loading ? 0.5 : 1, transition: "opacity .2s" }}>{renderTab()}</div>
      </div>
    </div>
  );
}
