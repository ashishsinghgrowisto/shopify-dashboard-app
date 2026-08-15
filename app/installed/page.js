// app/installed/page.js
// The page a MERCHANT sees when they open this app inside their Shopify admin.
//
// Two states, and which one renders is decided by cryptography, not by a query
// parameter:
//
//   1. Signed request from Shopify  → this store's own numbers.
//   2. Anything else                → a neutral "access is active" card.
//
// Shopify appends hmac/shop/timestamp when it sends a merchant to the App URL,
// signed with the app's secret. Verifying that HMAC is what proves both that
// Shopify sent the request and WHICH shop is asking. Without it, anyone could
// read any store's revenue by editing ?shop= in the address bar.
//
// This page shows one store: the one that was signed for. It never touches the
// agency's cross-client rollup — that lives behind the password gate at "/".

import crypto from "crypto";
import { allAppSecrets } from "../../lib/oauth-apps";
import { getShop } from "../../lib/token-store";
import { dbAvailable, getSql } from "../../lib/db";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Analytics access connected",
};

const CL = {
  bg: "#0B0F1A", cd: "#131825", bd: "#1E2A42",
  tx: "#E2E8F0", mt: "#94A3B8", dm: "#64748B", gn: "#22C55E", al: "#C4B5FD",
};

// Shopify signs the query string. Recompute over everything except the
// signature fields and compare in constant time.
function verifiedShop(searchParams) {
  const provided = searchParams?.hmac;
  const shop = String(searchParams?.shop || "").toLowerCase();
  if (!provided || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) return null;

  const message = Object.keys(searchParams)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => `${k}=${searchParams[k]}`)
    .join("&");

  const given = Buffer.from(String(provided), "utf8");
  for (const secret of allAppSecrets()) {
    const digest = Buffer.from(
      crypto.createHmac("sha256", secret).update(message).digest("hex"),
      "utf8"
    );
    if (digest.length === given.length && crypto.timingSafeEqual(digest, given)) {
      return shop;
    }
  }
  return null;
}

async function loadStoreSummary(shop) {
  if (!dbAvailable()) return null;
  const sql = getSql();
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const to = iso(new Date(today.getTime() - 86400000));
  const from = iso(new Date(today.getTime() - 30 * 86400000));

  const rows = await sql.query(
    `SELECT day::text AS day, net_sales, orders, sessions, completed_checkout
     FROM daily_metrics
     WHERE shop_domain = $1 AND day >= $2::date AND day <= $3::date
     ORDER BY day ASC`,
    [shop, from, to]
  );
  const list = Array.isArray(rows) ? rows : rows?.rows || [];
  if (!list.length) return { empty: true, from, to };

  const sum = (k) => list.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const sessions = sum("sessions");
  const orders = sum("orders");
  const checkouts = sum("completed_checkout");
  const net = sum("net_sales");

  return {
    empty: false,
    from,
    to,
    sessions,
    orders,
    net,
    // Recomputed from totals, never averaged across days — averaging a rate
    // over days weights a quiet Tuesday the same as Black Friday.
    conversion: sessions > 0 ? (checkouts / sessions) * 100 : 0,
    aov: orders > 0 ? net / orders : 0,
    days: list.map((r) => ({ day: r.day, sessions: Number(r.sessions) || 0 })),
  };
}

function money(n) {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function Stat({ label, value, sub }) {
  return (
    <div style={{
      background: CL.bg, border: "1px solid " + CL.bd, borderRadius: 10,
      padding: "14px 16px", flex: "1 1 130px", minWidth: 130,
    }}>
      <div style={{
        fontSize: 10.5, fontWeight: 700, color: CL.mt, textTransform: "uppercase",
        letterSpacing: ".06em", marginBottom: 6,
      }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: CL.tx, lineHeight: 1.15 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: CL.dm, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function Sparkline({ days }) {
  const max = Math.max(...days.map((d) => d.sessions), 1);
  return (
    <div>
      <div style={{
        display: "flex", alignItems: "flex-end", gap: 2, height: 52,
        marginBottom: 6,
      }}
        role="img"
        aria-label={`Daily sessions for the last ${days.length} days, peak ${max}`}
      >
        {days.map((d) => (
          <div
            key={d.day}
            title={`${d.day}: ${d.sessions} sessions`}
            style={{
              flex: 1,
              height: `${Math.max((d.sessions / max) * 100, 2)}%`,
              background: CL.al,
              opacity: 0.85,
              borderRadius: "2px 2px 0 0",
            }}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: CL.dm }}>
        <span>{days[0]?.day}</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </div>
  );
}

function Card({ children }) {
  return (
    <main style={{
      minHeight: "100vh", background: CL.bg, color: CL.tx,
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: CL.cd, border: "1px solid " + CL.bd, borderRadius: 14,
        padding: 32, maxWidth: 640, width: "100%",
      }}>{children}</div>
    </main>
  );
}

function ConnectedBadge() {
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 7,
      fontSize: 11, fontWeight: 700, letterSpacing: ".08em",
      textTransform: "uppercase", color: CL.gn, marginBottom: 12,
    }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: CL.gn }} />
      Connected
    </div>
  );
}

function Footer() {
  return (
    <>
      <p style={{ fontSize: 12.5, color: CL.mt, lineHeight: 1.75, margin: "18px 0 6px" }}>
        To revoke access at any time, uninstall the app from{" "}
        <strong style={{ color: CL.tx }}>Settings &rarr; Apps and sales channels</strong>.
      </p>
      <p style={{ fontSize: 11.5, color: CL.dm, lineHeight: 1.7, marginTop: 14, marginBottom: 0 }}>
        Questions about what&apos;s being accessed? Contact your agency contact directly.
      </p>
    </>
  );
}

export default async function InstalledPage({ searchParams }) {
  const params = (await searchParams) || {};
  const shop = verifiedShop(params);

  // ── Unsigned visit: say what the app does, show no numbers ────────
  if (!shop) {
    return (
      <Card>
        <ConnectedBadge />
        <h1 style={{ fontSize: 21, margin: "0 0 10px", fontWeight: 700 }}>
          Analytics access is active
        </h1>
        <p style={{ fontSize: 13.5, color: CL.mt, lineHeight: 1.75, margin: "0 0 18px" }}>
          This app gives your agency read-only access to this store&apos;s aggregate
          analytics — sessions, conversion rate, orders and net sales — so those
          numbers can appear in their reporting.
        </p>
        <div style={{
          background: CL.bg, border: "1px solid " + CL.bd, borderRadius: 10,
          padding: "14px 16px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: CL.al, textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 8 }}>
            What it can and can&apos;t do
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: CL.mt, lineHeight: 1.9 }}>
            <li>Reads aggregate analytics reports only</li>
            <li>Makes no changes to products, orders, themes or settings</li>
            <li>Does not write anything back to this store</li>
            <li>Shows this store&apos;s data only to your agency, never to anyone else</li>
          </ul>
        </div>
        <p style={{ fontSize: 12, color: CL.dm, lineHeight: 1.7, marginTop: 16, marginBottom: 0 }}>
          Open this app from your Shopify admin to see this store&apos;s last 30 days.
        </p>
        <Footer />
      </Card>
    );
  }

  // ── Signed by Shopify: this store's own last 30 days ──────────────
  let record = null;
  let summary = null;
  try {
    record = await getShop(shop);
    summary = await loadStoreSummary(shop);
  } catch {
    summary = null;
  }

  const name = shop.replace(/\.myshopify\.com$/, "");

  return (
    <Card>
      <ConnectedBadge />
      <h1 style={{ fontSize: 21, margin: "0 0 4px", fontWeight: 700 }}>
        {name} — last 30 days
      </h1>
      <p style={{ fontSize: 12.5, color: CL.mt, margin: "0 0 20px" }}>
        The same figures your agency sees for this store. Nobody else&apos;s data appears here.
      </p>

      {!summary || summary.empty ? (
        <div style={{
          background: CL.bg, border: "1px solid " + CL.bd, borderRadius: 10,
          padding: "16px 18px", fontSize: 13, color: CL.mt, lineHeight: 1.7,
        }}>
          {record
            ? "Access is active. The first sync runs tonight — your numbers will appear here after that."
            : "Access is active. Numbers will appear here once the first sync has run."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 18 }}>
            <Stat label="Net sales" value={money(summary.net)} sub={`AOV ${money(summary.aov)}`} />
            <Stat label="Orders" value={summary.orders.toLocaleString()} />
            <Stat label="Sessions" value={summary.sessions.toLocaleString()} />
            <Stat label="Conversion" value={`${summary.conversion.toFixed(2)}%`} sub="sessions that checked out" />
          </div>

          <div style={{
            background: CL.bg, border: "1px solid " + CL.bd, borderRadius: 10,
            padding: "14px 16px",
          }}>
            <div style={{
              fontSize: 10.5, fontWeight: 700, color: CL.mt, textTransform: "uppercase",
              letterSpacing: ".06em", marginBottom: 10,
            }}>Sessions per day</div>
            <Sparkline days={summary.days} />
          </div>
        </>
      )}

      <p style={{ fontSize: 11.5, color: CL.dm, lineHeight: 1.7, marginTop: 16, marginBottom: 0 }}>
        Figures cover {summary?.from} to {summary?.to} and update once a day. This app reads
        aggregate reports only — no customer names, emails, addresses or individual orders.
      </p>
      <Footer />
    </Card>
  );
}
