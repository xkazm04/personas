/**
 * Browser control — the frontend's single import point for the wire contract.
 *
 * WP0 hand-wrote these shapes; WP1 then declared the same ones in Rust with
 * `#[derive(TS)] #[ts(export)]`, so the ones that have a generated twin are
 * now RE-EXPORTED from `@/lib/bindings` rather than re-declared here. That is
 * the whole point of this module: the feature keeps one import path, and the
 * shapes behind it are the ones Rust actually serialises.
 *
 * Still hand-declared, because Rust has no `#[ts(export)]` type for them yet:
 *   - `BrowserTab` (the `browser-tabs` event payload — `tabs::Tab` is a plain
 *     serde struct in `browser_bridge::webview::tabs`),
 *   - `BrowserRefusal` / `BrowserRefusalCode` (a refusal travels as an
 *     `AppError` string today; the code vocabulary is shared by convention),
 *   - `BrowserPrincipal` / `BrowserOrigin` / `BrowserBackendKind` /
 *     `BrowserControlTier` (narrowings of `string` / `number` that ts-rs
 *     cannot express).
 * When a Rust binding lands for any of them, delete the local declaration and
 * add it to the re-export block — nothing else in the feature moves.
 */

// --- generated bindings, re-exported ----------------------------------------
export type { BrowserSite } from '@/lib/bindings/BrowserSite';
export type { BrowserSiteScan } from '@/lib/bindings/BrowserSiteScan';
export type { BrowserScanStatus } from '@/lib/bindings/BrowserScanStatus';
export type { BrowserToolClass } from '@/lib/bindings/BrowserToolClass';
export type { BrowserPageTool } from '@/lib/bindings/BrowserPageTool';
export type { BrowserScanForm } from '@/lib/bindings/BrowserScanForm';
export type { BrowserScanFormKind } from '@/lib/bindings/BrowserScanFormKind';
export type { BrowserLoginForm } from '@/lib/bindings/BrowserLoginForm';
export type { BrowserScanTransport } from '@/lib/bindings/BrowserScanTransport';
export type { BrowserSideEffects } from '@/lib/bindings/BrowserSideEffects';
export type { BrowserScanBlocker } from '@/lib/bindings/BrowserScanBlocker';
export type { UpsertBrowserSiteInput } from '@/lib/bindings/UpsertBrowserSiteInput';

// --- hand-declared ----------------------------------------------------------

/** `scheme://host[:port]` — the ascii serialization `url::Url::origin()` produces. */
export type BrowserOrigin = string;

/** Who holds a tab lease or created a row. */
export type BrowserPrincipal = 'operator' | 'athena' | `session:${string}`;

/** Which backend drives a page. */
export type BrowserBackendKind = 'webview' | 'extension' | 'playwright';

/**
 * Controllability grade the scan assigns: 0 read-only, 1 generic hands, 2 the
 * page's own WebMCP tools. The binding types `scan_tier` as `number | null`
 * (ts-rs cannot narrow a `u8`); this is the vocabulary the UI renders.
 */
export type BrowserControlTier = 0 | 1 | 2;

/** The highest tier the scan can award — the denominator of the control meter. */
export const BROWSER_MAX_TIER = 2;

/** One open tab in the embedded Webview (event `browser-tabs`). */
export interface BrowserTab {
  id: number;
  url: string;
  title: string;
  origin: BrowserOrigin;
  focused: boolean;
  lease: BrowserPrincipal | null;
  can_go_back: boolean;
  can_go_forward: boolean;
}

/**
 * The closed refusal vocabulary every backend answers with. Rust emits the
 * code; `errorRegistry` maps it to copy. Every refusal carries a `hint` naming
 * the next command (agent-actionable-errors technique).
 */
export type BrowserRefusalCode =
  | 'origin_not_allowed'
  | 'origin_disabled'
  | 'refused_loosening'
  | 'budget_exhausted'
  | 'tab_leased'
  | 'tab_cap'
  | 'unknown_ref'
  | 'stale_page'
  | 'timeout'
  | 'validator_failed'
  | 'unsupported_platform'
  | 'no_backend'
  | 'pending_approval'
  | 'user_denied';

export interface BrowserRefusal {
  reason: BrowserRefusalCode;
  hint: string;
  origin?: BrowserOrigin;
  holder?: BrowserPrincipal;
}

/** Caps shared with Rust (`browser_bridge::backend`); a tripwire test on each side names the other. */
export const BROWSER_TAB_CAP = 8;
export const BROWSER_DEFAULT_BUDGET = 50;
export const BROWSER_SNAPSHOT_CAP_CHARS = 8000;

// --- origin validation ------------------------------------------------------

/**
 * `scheme://host[:port]` and nothing else — no path, no query, no fragment,
 * no credentials. The Rust repo normalises through `url::Url::origin()` and
 * REFUSES anything it cannot parse; this mirror exists only so the Add-site
 * form can disable its submit before the user fires a doomed call. The server
 * stays the one that decides.
 */
export function isValidBrowserOrigin(raw: string): boolean {
  // A single trailing slash is what a browser's address bar hands back for a
  // bare origin, so it is accepted and dropped rather than treated as a path.
  const value = raw.trim().replace(/\/$/, '');
  if (!value) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  // Anything left after the authority (path / query / fragment / userinfo)
  // means the user pasted a URL, not an origin.
  if (/[/?#@]/.test(value.slice(value.indexOf('://') + 3))) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (!parsed.hostname) return false;
  // Compare on the parsed origin so a capitalised host still passes and
  // normalises the way Rust will store it.
  return parsed.origin.toLowerCase() === value.toLowerCase();
}

/** The form's normalisation: what gets sent as `origin`. */
export function normalizeBrowserOrigin(raw: string): BrowserOrigin {
  const value = raw.trim().replace(/\/$/, '');
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}
