// app/installed/page.js
// The page a MERCHANT sees when they open this app inside their Shopify admin.
//
// This deliberately shows nothing about the agency portfolio. The dashboard
// aggregates revenue across many client stores, so it must never render inside
// any single client's admin. The app's "App URL" in the Shopify Dev Dashboard
// points here, and this route is the only one exempt from the password gate.

export const metadata = {
  title: "Analytics access connected",
};

const CL = {
  bg: "#0B0F1A", cd: "#131825", bd: "#1E2A42",
  tx: "#E2E8F0", mt: "#94A3B8", dm: "#64748B", gn: "#22C55E", al: "#C4B5FD",
};

export default function InstalledPage() {
  return (
    <main style={{
      minHeight: "100vh", background: CL.bg, color: CL.tx,
      fontFamily: "system-ui, -apple-system, sans-serif",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 24,
    }}>
      <div style={{
        background: CL.cd, border: "1px solid " + CL.bd, borderRadius: 14,
        padding: 32, maxWidth: 560, width: "100%",
      }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 7,
          fontSize: 11, fontWeight: 700, letterSpacing: ".08em",
          textTransform: "uppercase", color: CL.gn, marginBottom: 12,
        }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: CL.gn }} />
          Connected
        </div>

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
          padding: "14px 16px", marginBottom: 18,
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

        <p style={{ fontSize: 12.5, color: CL.mt, lineHeight: 1.75, margin: "0 0 6px" }}>
          There&apos;s nothing to configure here. To revoke access at any time, uninstall
          the app from <strong style={{ color: CL.tx }}>Settings &rarr; Apps and sales channels</strong>.
        </p>

        <p style={{ fontSize: 11.5, color: CL.dm, lineHeight: 1.7, marginTop: 20, marginBottom: 0 }}>
          Questions about what&apos;s being accessed? Contact your agency contact directly.
        </p>
      </div>
    </main>
  );
}
