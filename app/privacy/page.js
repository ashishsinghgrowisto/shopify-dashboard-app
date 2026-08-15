// app/privacy/page.js
// Public privacy policy. App review requires a reachable privacy policy URL, and
// it has to describe what the app genuinely does — a boilerplate policy claiming
// to collect customer records would contradict the scopes we request.

export const metadata = {
  title: "Privacy Policy — Growisto Analytics",
  description:
    "How the Growisto Analytics app handles data from connected Shopify stores.",
};

const CL = {
  bg: "#0B0F1A",
  cd: "#131825",
  bd: "#1E2A42",
  tx: "#E2E8F0",
  mt: "#94A3B8",
  al: "#C4B5FD",
};

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 30 }}>
      <h2 style={{ fontSize: 15, margin: "0 0 10px", color: CL.tx }}>{title}</h2>
      <div style={{ fontSize: 13.5, lineHeight: 1.8, color: CL.mt }}>{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <main
      style={{
        margin: 0,
        background: CL.bg,
        color: CL.tx,
        fontFamily: "system-ui, -apple-system, sans-serif",
        minHeight: "100vh",
        padding: "48px 20px",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ fontSize: 26, margin: "0 0 6px" }}>Privacy Policy</h1>
        <p style={{ fontSize: 13, color: CL.mt, margin: "0 0 34px" }}>
          Growisto Analytics · last updated 15 August 2026
        </p>

        <Section title="Who we are">
          Growisto Analytics is operated by Growisto Inc. It is a private reporting tool used by
          Growisto to report on the performance of Shopify stores belonging to its own clients. It is
          not offered to the general public. Questions about this policy or about data held on your
          store: <a href="mailto:cro@growisto.com" style={{ color: CL.al }}>cro@growisto.com</a>.
        </Section>

        <Section title="What the app reads">
          The app requests a single Shopify scope, <code style={{ color: CL.al }}>read_reports</code>,
          and uses it to read <strong style={{ color: CL.tx }}>aggregate analytics only</strong>:
          sessions, add-to-cart and checkout counts, conversion rate, order counts, and sales totals,
          each as a daily figure for the store as a whole. It also reads aggregate traffic-source and
          campaign breakdowns.
          <br />
          <br />
          The app does <strong style={{ color: CL.tx }}>not</strong> read, request, or receive
          customer names, email addresses, phone numbers, shipping addresses, individual orders, or
          payment details. It writes nothing back to your store and changes no products, themes,
          orders or settings.
        </Section>

        <Section title="What we store, and for how long">
          Two things are stored, both in a Postgres database hosted in the United States:
          <br />
          <br />
          <strong style={{ color: CL.tx }}>1. Your store&rsquo;s access token</strong> — encrypted at
          rest with AES-256-GCM, used solely to make the analytics queries described above. It is
          destroyed as soon as the app is uninstalled.
          <br />
          <br />
          <strong style={{ color: CL.tx }}>2. Daily aggregate totals</strong> — one row per store per
          day. These are counts and currency sums with no customer-level detail, kept so that
          reporting does not have to re-query Shopify on every page load. They are retained for the
          duration of the client relationship and erased on request or on a{" "}
          <code style={{ color: CL.al }}>shop/redact</code> request from Shopify.
        </Section>

        <Section title="Who else sees it">
          Store data is visible only to Growisto staff, through a password-protected dashboard. It is
          never shown to other merchants, never sold, never used for advertising, and never used to
          train models. Two infrastructure providers process data on our behalf: Vercel (application
          hosting) and Neon (database hosting).
        </Section>

        <Section title="Uninstalling, and your rights">
          Uninstalling the app from <strong style={{ color: CL.tx }}>Settings → Apps and sales
          channels</strong> in your Shopify admin immediately revokes our access and destroys the
          stored token. Shopify then sends us a{" "}
          <code style={{ color: CL.al }}>shop/redact</code> request 48 hours later, at which point the
          stored aggregates for your store are deleted.
          <br />
          <br />
          You may ask us at any time what we hold about your store, or ask for it to be deleted,
          by emailing <a href="mailto:cro@growisto.com" style={{ color: CL.al }}>cro@growisto.com</a>.
          We respond to Shopify&rsquo;s{" "}
          <code style={{ color: CL.al }}>customers/data_request</code> and{" "}
          <code style={{ color: CL.al }}>customers/redact</code> webhooks; because no customer-level
          data is stored, there is generally nothing to return or erase in response to them.
        </Section>

        <Section title="Changes">
          If this policy changes materially, connected merchants will be notified by email at the
          address on their Shopify account before the change takes effect.
        </Section>
      </div>
    </main>
  );
}
