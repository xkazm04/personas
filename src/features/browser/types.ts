/**
 * Browser control — the frontend wire contract (spark browser-control, WP0).
 *
 * These shapes are the CONTRACT the parallel work packages build against.
 * WP1 declares the same shapes in Rust with `#[derive(TS)] #[ts(export)]`
 * and regenerates `src/lib/bindings/`; WP4 then re-points this module at the
 * generated bindings (`export type { BrowserSite } from '@/lib/bindings'`).
 * Until then nothing here may drift from the brief in
 * Spark/ideas/browser-control.md § Data & API without editing both.
 */

/** `scheme://host[:port]` — the ascii serialization `url::Url::origin()` produces. */
export type BrowserOrigin = string;

/** Who holds a tab lease or created a row. */
export type BrowserPrincipal = 'operator' | 'athena' | `session:${string}`;

/** Which backend drives a page. */
export type BrowserBackendKind = 'webview' | 'extension' | 'playwright';

/** Controllability grade the scan assigns: 0 read-only, 1 generic hands, 2 page's own WebMCP tools. */
export type BrowserControlTier = 0 | 1 | 2;

export type BrowserScanStatus = 'none' | 'running' | 'proposed' | 'confirmed' | 'failed';

/** Tool class after manifest derivation + per-origin tightening. */
export type BrowserToolClass = 'read' | 'auto' | 'gated';

export interface BrowserPageTool {
  name: string;
  description: string;
  reversible: boolean;
  side_effects: 'none' | 'internal' | 'external';
  class: BrowserToolClass;
}

export interface BrowserScanForm {
  name: string;
  fields: number;
  kind: 'login' | 'search' | 'payment' | 'other';
}

export interface BrowserLoginForm {
  user_ref: string;
  pass_ref: string;
  submit_ref: string;
}

export type BrowserScanBlocker = 'captcha' | 'login_wall' | 'csp_frozen_globals';

/** The JSON stored in `browser_sites.scan_report`. */
export interface BrowserSiteScan {
  transport: 'webmcp-native' | 'webmcp-polyfill' | 'none';
  page_tools: BrowserPageTool[];
  operable_count: number;
  landmarks: string[];
  forms: BrowserScanForm[];
  login_form: BrowserLoginForm | null;
  blockers: BrowserScanBlocker[];
  tier: BrowserControlTier;
  notes: string;
}

/** One row of `browser_sites`. */
export interface BrowserSite {
  origin: BrowserOrigin;
  label: string;
  enabled: boolean;
  /** tool name -> "gated" (tighten-only; an AUTO override over a declared GATED is refused). */
  overrides: Record<string, 'gated'>;
  /** Per-turn call budget for this origin. */
  budget: number;
  credential_id: string | null;
  scan_status: BrowserScanStatus;
  scan_tier: BrowserControlTier | null;
  scan_report: BrowserSiteScan | null;
  scan_at: number | null;
  first_seen: number;
  last_seen: number;
  created_by: BrowserPrincipal;
}

/** One open tab in the embedded Webview (event `browser://tabs`). */
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
