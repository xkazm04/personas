/**
 * bpLink - where the Release card sends the operator: bp's Release tab for
 * the product (spark one-control, WP3). bp composes and finishes releases;
 * Personas only opens it, in the system browser.
 *
 *   <lens_scan.bp_url>/?product=<slug>&page=ledger&tab=release
 *
 * `lens_scan.bp_url` is an app setting (Rust `settings_keys::LENS_SCAN_BP_URL`),
 * `http://localhost:3000` (Next's default port) when unset or blank.
 *
 * The slug: bp names a product by the slug in its own registry
 * (`bp.products.local.json`), which Personas cannot read. A product's registry
 * slug is, by convention, its repo folder name, so the slug is derived from
 * the row's root as bp's slug rule allows it (`^[a-z0-9][a-z0-9-]{0,62}$`).
 *
 * React-free.
 */
export const BP_URL_SETTING = 'lens_scan.bp_url';
export const BP_URL_DEFAULT = 'http://localhost:3000';
/** What the operator runs in bp's root to start it. */
export const BP_START_COMMAND = 'npm run dev';

/** The setting's value, or the default when unset, blank, or not an http(s) URL. */
export function bpBaseUrl(setting: string | null | undefined): string {
  const v = (setting ?? '').trim();
  if (!/^https?:\/\//i.test(v)) return BP_URL_DEFAULT;
  return v.replace(/\/+$/, '');
}

/** bp's slug for a product, from its repo root's folder name. */
export function bpSlug(root: string): string {
  const folder = root.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  const slug = folder.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63);
  return slug || 'product';
}

/** The Release tab of one product in bp. */
export function bpReleaseUrl(base: string, slug: string): string {
  const q = new URLSearchParams({ product: slug, page: 'ledger', tab: 'release' });
  return `${base}/?${q.toString()}`;
}
