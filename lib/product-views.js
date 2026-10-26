// lib/product-views.js
// Estimated "Product Views" funnel step.
//
// Shopify's sessions schema has no page-type breakdown of page views, and no
// "sessions that viewed a product" metric. The only product split it exposes is
// the landing page type. So the step is an allocation:
//
//   product share  = pageviews on product-landing sessions ÷ all pageviews
//   product views  = sessions × product share
//
// clamped per bucket so it sits between Add to Cart and Sessions — a funnel
// whose second step is smaller than its third would be nonsense, and every
// session that added to cart necessarily viewed a product.
//
// Buckets with no pageview data (days synced before this metric existed) borrow
// the share of the whole range instead of reading as zero.

export function isProductLanding(type) {
  return /product/i.test(String(type || ""));
}

/**
 * @param {number[]} se   sessions per bucket
 * @param {number[]} ca   sessions with cart additions per bucket
 * @param {number[]} pg   all pageviews per bucket
 * @param {number[]} ppg  pageviews from product-landing sessions per bucket
 * @returns {{ pv: number[]|null, share: number|null }}  pv is null when there's no pageview data at all
 */
export function estimateProductViews(se, ca, pg, ppg) {
  const n = (se || []).length;
  const totalPg = (pg || []).reduce((a, b) => a + (Number(b) || 0), 0);
  const totalPpg = (ppg || []).reduce((a, b) => a + (Number(b) || 0), 0);
  if (!n || totalPg <= 0) return { pv: null, share: null };

  const rangeShare = totalPpg / totalPg;
  const pv = Array.from({ length: n }, (_, i) => {
    const s = Number(se[i]) || 0;
    const c = Number(ca?.[i]) || 0;
    const p = Number(pg?.[i]) || 0;
    const share = p > 0 ? (Number(ppg?.[i]) || 0) / p : rangeShare;
    const est = Math.round(s * share);
    return Math.max(c, Math.min(s, est));
  });

  return { pv, share: parseFloat((rangeShare * 100).toFixed(2)) };
}
