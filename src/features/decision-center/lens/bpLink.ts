/**
 * bpLink - where the Release card sends the operator: bp's Release tab for
 * the product (spark one-control, WP3). bp composes and finishes releases;
 * Personas only opens it, in the system browser.
 *
 *   <lens_scan.bp_url>/?product=<slug>&page=ledger&tab=release
 *
 * `lens_scan.bp_url` is an app setting (Rust `settings_keys::LENS_SCAN_BP_URL`),
 * `http://localhost:3010` (bp's own dev and start port, clear of the 3000
 * that local test servers take) when unset or blank.
 *
 * The slug: bp names a product by the slug in its own registry, which
 * Personas does not read. Personas asks bp instead (spark roadmap S6): bp's
 * product table (`bp_products`, `GET /api/products` from Rust) matched on the
 * canonical root (`bpSlugByRoot`). Only when bp does not answer does the
 * folder-name convention stand in (`bpSlug`), as bp's slug rule allows it
 * (`^[a-z0-9][a-z0-9-]{0,62}$`); a product registered under another slug, or
 * a worktree, is then wrong, which is why the table comes first.
 *
 * React-free.
 */
export const BP_URL_SETTING = 'lens_scan.bp_url';
export const BP_URL_DEFAULT = 'http://localhost:3010';
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

/** A root as bp's product table and Personas' projects compare it (Rust `normalize_root`): forward slashes, no verbatim
 *  prefix, no trailing slash, case-folded. */
export function normalizeRoot(root: string): string {
  const r = root.trim().replace(/\\/g, '/');
  return (r.startsWith('//?/') ? r.slice(4) : r).replace(/\/+$/, '').toLowerCase();
}

/** bp's slug for the product at this root, from bp's own product table; undefined when bp lists none there. */
export function bpSlugByRoot(rows: readonly { slug: string; root?: string }[], root: string): string | undefined {
  const key = normalizeRoot(root);
  return rows.find((r) => r.root !== undefined && normalizeRoot(r.root) === key)?.slug;
}

/** The Release tab of one product in bp. */
export function bpReleaseUrl(base: string, slug: string): string {
  const q = new URLSearchParams({ product: slug, page: 'ledger', tab: 'release' });
  return `${base}/?${q.toString()}`;
}
