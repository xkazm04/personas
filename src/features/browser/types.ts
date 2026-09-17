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

/**
 * `scheme://host[:port]` — the ascii serialization `url::Url::origin()`
 * produces — OR a wildcard PATTERN in the same shape (`https://*.example.com`,
 * `http://localhost:*`). See `isBrowserOriginPattern` for the grammar.
 */
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
 * The one grammar both an exact origin and a wildcard PATTERN answer to.
 *
 *   scheme  `http` | `https`
 *   host    dns labels, optionally preceded by ONE `*.` label
 *   port    digits, or `*`, or omitted
 *
 * Refused by construction, because the capture groups cannot express them: a
 * bare `*` host, a `*` inside a label (`https://ex*mple.com`), a path, a query,
 * a fragment or userinfo. This mirrors the Rust repo's rules; the server still
 * decides, and this exists so the Add-site form can disable a doomed submit.
 */
const ORIGIN_GRAMMAR =
  /^(https?):\/\/(\*\.)?((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)(?::(\d{1,5}|\*))?$/i;

/** What the origin field is made of, once it has been found well-formed. */
export interface BrowserOriginParts {
  scheme: 'http' | 'https';
  /** True when the host carried a leading `*.` label. */
  wildcardHost: boolean;
  /** The host WITHOUT the `*.` label — `example.com` for `*.example.com`. */
  host: string;
  /** The port as written: digits, `*`, or null when it was omitted. */
  port: string | null;
}

/** Trim, drop the single trailing slash an address bar hands back, lowercase. */
function canonical(raw: string): string {
  return raw.trim().replace(/\/$/, '').toLowerCase();
}

/** The grammar above, parsed. `null` when the input does not answer to it. */
export function parseBrowserOrigin(raw: string): BrowserOriginParts | null {
  const match = ORIGIN_GRAMMAR.exec(canonical(raw));
  if (!match) return null;
  return {
    scheme: match[1] as 'http' | 'https',
    wildcardHost: !!match[2],
    host: match[3] ?? '',
    port: match[4] ?? null,
  };
}

/**
 * True when this origin is a WELL-FORMED pattern rather than one concrete origin.
 *
 * DELIBERATELY NARROWER THAN RUST'S `is_origin_pattern`, which answers on the
 * token so that a door refusing patterns cannot be walked past by a malformed
 * one. That is a gate's question. This is a RENDERING question — does this row
 * cover more than one site, and can it be expanded to something navigable — and
 * a malformed pattern answers neither, so it is not one here. A malformed
 * pattern also cannot reach a row: the server refuses it on write.
 */
export function isBrowserOriginPattern(origin: string): boolean {
  const parts = parseBrowserOrigin(origin);
  return !!parts && (parts.wildcardHost || parts.port === '*');
}

/**
 * Does `concrete` fall inside `pattern`?
 *
 * The three rules, each of which has a test naming the trap it closes:
 *   - `*.example.com` covers the apex AND any subdomain depth, and NOTHING
 *     else: `evil-example.com` and `example.com.evil` are both outside it,
 *     because the match is on a label boundary and not on a substring.
 *   - `:*` covers any port and the absence of one; a written port must be
 *     equal; an omitted port means "no port", not "any port".
 *   - the scheme must be equal. `http` is not a weaker `https`.
 */
export function originMatchesPattern(pattern: string, concrete: string): boolean {
  const p = parseBrowserOrigin(pattern);
  const c = parseBrowserOrigin(concrete);
  if (!p || !c) return false;
  // A pattern on both sides is not a match question, it is two patterns.
  if (c.wildcardHost || c.port === '*') return false;
  if (p.scheme !== c.scheme) return false;
  if (p.wildcardHost) {
    if (c.host !== p.host && !c.host.endsWith(`.${p.host}`)) return false;
  } else if (c.host !== p.host) return false;
  if (p.port === '*') return true;
  return p.port === c.port;
}

/** Why the origin field is refusing — the form turns this into copy. */
export type BrowserOriginProblem =
  /** Nothing typed yet. */
  | 'empty'
  /** A full web address was pasted: there is a path, query, fragment or userinfo. */
  | 'url_not_origin'
  /** A `*` sits somewhere the grammar does not allow one. */
  | 'wildcard_misplaced'
  /** Anything else — no scheme, an unparseable host, a scheme that is not http(s). */
  | 'not_an_origin';

/**
 * `null` when the value is something Rust will accept. Exported so the form can
 * say WHICH mistake was made: "that is a URL" and "that wildcard is not allowed
 * there" are different problems and one message for both teaches neither.
 */
export function browserOriginProblem(raw: string): BrowserOriginProblem | null {
  const value = raw.trim().replace(/\/$/, '');
  if (!value) return 'empty';
  if (!/^https?:\/\//i.test(value)) return 'not_an_origin';
  // Anything left after the authority (path / query / fragment / userinfo)
  // means the user pasted a URL, not an origin.
  const authority = value.slice(value.indexOf('://') + 3);
  if (/[/?#@]/.test(authority)) return 'url_not_origin';
  if (authority.includes('*')) {
    return parseBrowserOrigin(value) ? null : 'wildcard_misplaced';
  }
  // An exact origin keeps the WHATWG round-trip it has always had, so hosts the
  // hand-written grammar does not model (an IPv6 literal, say) still pass.
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'not_an_origin';
  }
  if (!parsed.hostname) return 'not_an_origin';
  return parsed.origin.toLowerCase() === value.toLowerCase() ? null : 'not_an_origin';
}

/**
 * `scheme://host[:port]`, an exact origin or a pattern, and nothing else. The
 * server stays the one that decides; this only stops a doomed call.
 */
export function isValidBrowserOrigin(raw: string): boolean {
  return browserOriginProblem(raw) === null;
}

/**
 * The form's normalisation: what gets sent as `origin`.
 *
 * A pattern is lowercased and trimmed BY HAND rather than round-tripped through
 * `new URL`, which rejects `*` outright and would hand the raw string back
 * unchanged — capitalisation and all.
 */
export function normalizeBrowserOrigin(raw: string): BrowserOrigin {
  const value = raw.trim().replace(/\/$/, '');
  if (value.includes('*')) return value.toLowerCase();
  try {
    return new URL(value).origin;
  } catch {
    return value;
  }
}
