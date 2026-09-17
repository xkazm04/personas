// Browser control API — thin wrappers over the `browser_*` Tauri commands.
//
// The contract (deny-by-default whitelist, tighten-only overrides, per-turn
// budgets, the tab cap, who may take a lease) is owned by Rust and stated in
// `docs/features/browser.md` + `docs/architecture/browser-control.md`. Nothing
// here re-validates it: a client that disagreed with the server about a
// refusal would just produce two answers to one question. The UI *disables*
// controls it knows are illegal so the user never fires a doomed call, and the
// server is the one that refuses.
//
// WIRE SHAPE. Args are camelCase (Tauri's serde rename), results are the
// snake_case model shapes ts-rs generated. Every refusal arrives as a
// serialised `AppError` — branch on `kind` (`forbidden` = policy refusal,
// `validation` = malformed / cap / unsupported platform, `not_found` = no such
// tab or ref, `execution` = timeout), NEVER on the message text.
import type { UnlistenFn } from '@tauri-apps/api/event';

import { EventName, typedListen } from '@/lib/eventRegistry';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';
import { isTauriError, type TauriErrorKind } from '@/lib/types/tauriError';
import type { PickedTarget } from '@/lib/bindings/PickedTarget';
import type {
  BrowserScanStatus,
  BrowserSite,
  BrowserTab,
  BrowserToolClass,
  UpsertBrowserSiteInput,
} from '@/features/browser/types';

/** A controllability scan opens a real page and waits on it. 2 minutes. */
const SCAN_TIMEOUT_MS = 120_000;

// --- sites (the whitelist) --------------------------------------------------

export async function listSites(): Promise<BrowserSite[]> {
  return invoke<BrowserSite[]>('browser_sites_list');
}

/** Create-or-update. Omitted fields keep the row's value (or take the default). */
export async function upsertSite(input: UpsertBrowserSiteInput): Promise<BrowserSite> {
  return invoke<BrowserSite>('browser_sites_upsert', { input });
}

export async function deleteSite(origin: string): Promise<boolean> {
  return invoke<boolean>('browser_sites_delete', { origin });
}

export async function setSiteEnabled(origin: string, enabled: boolean): Promise<BrowserSite> {
  return invoke<BrowserSite>('browser_sites_set_enabled', { origin, enabled });
}

/**
 * Tighten one tool on one origin to "ask first", or clear the override
 * (`cls: null`). The repo refuses anything but `gated` with a `forbidden`
 * carrying `refused_loosening` — which is why the UI only ever offers the two
 * states and never an "auto" chip.
 */
export async function setSiteOverride(
  origin: string,
  tool: string,
  cls: BrowserToolClass | null,
): Promise<BrowserSite> {
  return invoke<BrowserSite>('browser_sites_set_override', { origin, tool, class: cls });
}

/** Bind a vault credential to an origin, or clear it with `null`. */
export async function bindSiteCredential(
  origin: string,
  credentialId: string | null,
): Promise<BrowserSite> {
  return invoke<BrowserSite>('browser_sites_bind_credential', { origin, credentialId });
}

// --- controllability scan (WP3) ---------------------------------------------
//
// These three are NOT yet in `commandNames.generated.ts` — WP3 is registering
// them in the same spark. They are typed through the sanctioned escape hatch
// `src/lib/commandNames.overrides.ts` (`UnregisteredCommand`); the Director
// removes those three lines once the generator reports them stale.

/** Start a scan. Findings land on the row (`scan_status` / `scan_report` / `scan_tier`). */
export async function scanSite(origin: string): Promise<void> {
  return invoke<void>('browser_scan_site', { origin }, { timeoutMs: SCAN_TIMEOUT_MS });
}

/**
 * Where a scan stands.
 *
 * ASSUMPTION, stated because WP3 had not landed when this was written: the
 * command answers with the same `BrowserScanStatus` vocabulary the row column
 * carries. Nothing in this feature DEPENDS on that — the store re-reads
 * `browser_sites_list`, which is authoritative for status, report and tier —
 * so a different return shape costs this one wrapper and no surface.
 */
export async function scanStatus(origin: string): Promise<BrowserScanStatus> {
  return invoke<BrowserScanStatus>('browser_scan_status', { origin });
}

/** Accept a proposed scan: the tier and the derived tool classes become live. */
export async function confirmScan(origin: string): Promise<void> {
  return invoke<void>('browser_scan_confirm', { origin });
}

// --- tabs (the embedded webview) --------------------------------------------

/** Open a tab on `url` and focus it. `principal` defaults to the operator. */
export async function openTab(url: string, principal?: string | null): Promise<number> {
  return invoke<number>('browser_webview_open', { url, principal: principal ?? null });
}

export async function closeTab(id: number): Promise<void> {
  return invoke<void>('browser_webview_close', { id });
}

export async function focusTab(id: number): Promise<void> {
  return invoke<void>('browser_webview_focus', { id });
}

export async function navigateTab(id: number, url: string): Promise<void> {
  return invoke<void>('browser_webview_navigate', { id, url });
}

export async function tabBack(id: number): Promise<void> {
  return invoke<void>('browser_webview_back', { id });
}

export async function tabForward(id: number): Promise<void> {
  return invoke<void>('browser_webview_forward', { id });
}

/** The seed a freshly mounted route reads before the first `browser-tabs` event. */
export async function listTabs(): Promise<BrowserTab[]> {
  return invoke<BrowserTab[]>('browser_webview_list');
}

/**
 * Where the page goes, in LOGICAL pixels relative to the main window's client
 * area. The page is a separate OS window drawn ABOVE the React tree, so this
 * is the only thing that positions it — and nothing may overlay the slot.
 */
export async function setViewport(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<void> {
  return invoke<void>('browser_webview_set_viewport', rect);
}

/**
 * Whether the route that owns the page host is on screen. `false` on
 * nav-away (and while a modal of ours is open) HIDES the host window and
 * keeps every tab: leaving the route is not closing anybody's page.
 */
export async function setVisible(visible: boolean): Promise<void> {
  return invoke<void>('browser_webview_set_visible', { visible });
}

/**
 * Take a tab back from whoever holds it. Answers with the principal that held
 * it, or `null` when it was already free — revoking a free tab is the same
 * outcome, not an error.
 */
export async function revokeLease(tab: number): Promise<string | null> {
  return invoke<string | null>('browser_lease_revoke', { tab });
}

// --- twin draft-into-page (the pick / fill / submit trio) --------------------
//
// The Twin toolbar arms the page: `pickTarget` resolves with the writable box
// the user clicks NEXT (the page mints the ref at click time, so it is fresh
// by construction), `fillTarget` types the twin's draft straight into it, and
// `submitTarget` presses the box's own form control. Refs die with the page's
// ref generation — any navigation — which is why the lane resets on a url
// change rather than retrying a stale ref.

/**
 * `pickTarget` BLOCKS until the user clicks a box in the page, for up to ~3
 * minutes on the Rust side. The wrapper's own ceiling sits just above that so
 * the backend, not the IPC wrapper, is the one that gives up: a wrapper
 * timeout would leave the page armed with nobody listening for the answer.
 */
const PICK_TIMEOUT_MS = 200_000;

/** Wait for the user's next click on a writable box in tab `id`. */
export async function pickTarget(id: number): Promise<PickedTarget> {
  return invoke<PickedTarget>('browser_webview_pick_target', { id }, { timeoutMs: PICK_TIMEOUT_MS });
}

/**
 * Disarm a pending pick. The blocked `pickTarget` call rejects with a
 * `validation` error carrying `pick_cancelled` — see `isPickCancelled`.
 */
export async function pickCancel(id: number): Promise<void> {
  return invoke<void>('browser_webview_pick_cancel', { id });
}

/** Replace the box's content with `text` (existing text was sent as direction). */
export async function fillTarget(id: number, ref: string, text: string): Promise<void> {
  return invoke<void>('browser_webview_fill', { id, ref, text });
}

/** Press the submit control of the form the box belongs to. */
export async function submitTarget(id: number, ref: string): Promise<void> {
  return invoke<void>('browser_webview_submit', { id, ref });
}

/**
 * The one rejection the pick lane treats as SILENCE rather than failure: the
 * user (or a navigation) cancelled the pick. The kind is checked first because
 * that is the contract; the token is checked second because `validation` also
 * covers "unsupported platform" and a malformed id, which are real failures.
 */
export function isPickCancelled(err: unknown): boolean {
  return isTauriError(err) && err.kind === 'validation' && err.error.includes('pick_cancelled');
}

// --- events -----------------------------------------------------------------

/** The WHOLE tab list, every time any of it moves. Rust is authoritative. */
export function listenTabs(handler: (tabs: BrowserTab[]) => void): Promise<UnlistenFn> {
  return typedListen(EventName.BROWSER_TABS, handler);
}

// --- refusals ---------------------------------------------------------------

/**
 * The `kind` of a rejected browser call, or `null` when the rejection is not a
 * structured `AppError` (a transport failure, a timeout thrown by the invoke
 * wrapper itself). Callers branch on this and resolve the copy through
 * `resolveError`; nobody reads the message text to decide anything.
 */
export function browserErrorKind(err: unknown): TauriErrorKind | null {
  return isTauriError(err) ? err.kind : null;
}
