export const metadata = {
  title: "Shopify Portfolio Dashboard",
  description: "Live multi-store Shopify analytics with custom date ranges and cross-brand consolidation",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B0F1A",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: "#0B0F1A" }}>{children}</body>
    </html>
  );
}
