import { useEffect, useSyncExternalStore } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import * as Sentry from "@sentry/react";
import { silentCatch } from "@/lib/silentCatch";
import { recordVersion } from "@/lib/updateHistory";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

/**
 * Outcome of a manual check — used by Settings UI for toast feedback.
 *
 * `already-checking` is deliberately distinct from `up-to-date`: a press that
 * collides with the in-flight background poll ran NO check, and reporting
 * non-execution as a green "you're up to date" is the same empty-success the
 * `failed` branch exists to avoid.
 */
export type CheckOutcome =
  | "update-available"
  | "up-to-date"
  | "already-checking"
  | "failed";

export interface AutoUpdaterState {
  updateAvailable: boolean;
  updateInfo: UpdateInfo | null;
  isChecking: boolean;
  isInstalling: boolean;
  /**
   * 0–100 while the update payload is downloading, or null when the total size
   * is unknown / not downloading. Drives the banner's progress bar.
   */
  downloadProgress: number | null;
  error: string | null;
  /**
   * Epoch ms of the last completed check (any outcome), or null before the
   * first check resolves. Surfaced in Settings so the user can confirm the
   * background poll is actually running.
   */
  lastChecked: number | null;
}

// ---------------------------------------------------------------------------
// Process-wide updater state.
//
// The updater is a PROCESS singleton — one app, one available update, one
// poller — but this used to be per-component state. `UpdateBanner` is always
// mounted and Settings → Account mounts a second consumer, so there were two
// 6h pollers, two independent in-flight guards (the second could fire a check
// concurrent with the first's), and a manual check that found an update in
// Settings never reached the banner. Hoisting the state to module scope makes
// the singleton real; the poller is refcounted (acquire on first subscriber,
// release on last) per the HMR-safe-singletons golden path, so a stale module
// copy drains to zero and frees its own timers.
// ---------------------------------------------------------------------------

const INITIAL_STATE: AutoUpdaterState = {
  updateAvailable: false,
  updateInfo: null,
  isChecking: false,
  isInstalling: false,
  downloadProgress: null,
  error: null,
  lastChecked: null,
};

let state: AutoUpdaterState = INITIAL_STATE;
const listeners = new Set<() => void>();

function getState(): AutoUpdaterState {
  return state;
}

function setState(patch: Partial<AutoUpdaterState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The update object handed back by the last successful check, if any. */
let pendingUpdate: Update | null = null;
/**
 * In-flight guard held outside React so every consumer sees the same one — a
 * per-instance ref could not see another instance's in-flight check.
 */
let checking = false;

export async function checkForUpdate(): Promise<CheckOutcome> {
  // A check is already in flight (usually the 6h background poll). Report
  // that honestly rather than claiming a fresh check found nothing.
  if (checking) return "already-checking";
  checking = true;
  setState({ isChecking: true, error: null });
  try {
    const update = await check();
    if (update) {
      pendingUpdate = update;
      setState({
        updateInfo: { version: update.version, body: update.body ?? null },
        updateAvailable: true,
      });
      Sentry.addBreadcrumb({
        category: "update",
        message: `Update available: v${update.version}`,
        level: "info",
      });
      return "update-available";
    }
    Sentry.addBreadcrumb({
      category: "update",
      message: "No update available",
      level: "info",
    });
    return "up-to-date";
  } catch (err) {
    silentCatch("useAutoUpdater:check")(err);
    // Surface the failure in state (Settings shows it next to lastChecked):
    // a dead/moved updater endpoint must not be indistinguishable from
    // "up to date" — background checks previously failed invisibly.
    setState({ error: err instanceof Error ? err.message : String(err) });
    return "failed";
  } finally {
    checking = false;
    setState({ isChecking: false, lastChecked: Date.now() });
  }
}

export async function installUpdate(): Promise<void> {
  const update = pendingUpdate;
  if (!update) return;
  const installVersion = update.version;
  setState({ isInstalling: true, downloadProgress: null, error: null });
  Sentry.addBreadcrumb({
    category: "update",
    message: `Update install started: v${installVersion}`,
    level: "info",
  });
  try {
    let downloaded = 0;
    let contentLength = 0;
    await update.downloadAndInstall((event: DownloadEvent) => {
      switch (event.event) {
        case "Started":
          downloaded = 0;
          contentLength = event.data.contentLength ?? 0;
          // 0 when the server omitted Content-Length — keep null so the
          // banner shows an indeterminate "Installing…" rather than a bar
          // stuck at a bogus percentage.
          setState({ downloadProgress: contentLength > 0 ? 0 : null });
          break;
        case "Progress":
          downloaded += event.data.chunkLength;
          if (contentLength > 0) {
            setState({
              downloadProgress: Math.min(100, Math.round((downloaded / contentLength) * 100)),
            });
          }
          break;
        case "Finished":
          setState({ downloadProgress: 100 });
          break;
      }
    });
    // downloadAndInstall typically relaunches the app; this breadcrumb only
    // fires if install completed without an immediate restart.
    Sentry.addBreadcrumb({
      category: "update",
      message: `Update install completed: v${installVersion}`,
      level: "info",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to install update";
    setState({ error: message, isInstalling: false, downloadProgress: null });
    Sentry.captureException(err, {
      tags: { event: "update.install.failed" },
      extra: { version: installVersion },
    });
  }
}

export function dismissUpdate(): void {
  pendingUpdate = null;
  setState({ updateAvailable: false, updateInfo: null });
}

// --- Refcounted background poller -----------------------------------------

let subscriberCount = 0;
let initialTimeout: ReturnType<typeof setTimeout> | null = null;
let pollInterval: ReturnType<typeof setInterval> | null = null;

function acquirePoller() {
  subscriberCount += 1;
  if (subscriberCount > 1) return;
  // Skip automatic checks in dev: there is no signed release artifact to
  // update to, and the updater capability only matters for packaged builds.
  // Manual checkForUpdate() from Settings still works. This is what stops
  // the recurring "updater.check not allowed" noise during development.
  if (import.meta.env.DEV) return;
  // Check after a 5-second delay on mount, then every 6 hours. Outcome is
  // intentionally ignored — checkForUpdate already routes failures through
  // silentCatch and successes through Sentry breadcrumbs.
  initialTimeout = setTimeout(() => { void checkForUpdate(); }, 5000);
  pollInterval = setInterval(() => { void checkForUpdate(); }, 6 * 60 * 60 * 1000);
}

function releasePoller() {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount > 0) return;
  if (initialTimeout !== null) { clearTimeout(initialTimeout); initialTimeout = null; }
  if (pollInterval !== null) { clearInterval(pollInterval); pollInterval = null; }
}

let versionRecorded = false;
function recordVersionOnce() {
  if (versionRecorded) return;
  versionRecorded = true;
  // Record the running version once per launch so Settings can show an
  // update-history timeline. Idempotent — only appends on version change.
  // Runs even in dev (it's just localStorage) so the timeline stays accurate.
  getVersion()
    .then((v) => { recordVersion(v); })
    .catch(silentCatch("useAutoUpdater:recordVersion"));
}

/** Test seam: drop the shared state, timers and one-shot latches. */
export function resetAutoUpdaterForTests() {
  state = INITIAL_STATE;
  listeners.clear();
  pendingUpdate = null;
  checking = false;
  versionRecorded = false;
  subscriberCount = 0;
  if (initialTimeout !== null) { clearTimeout(initialTimeout); initialTimeout = null; }
  if (pollInterval !== null) { clearInterval(pollInterval); pollInterval = null; }
}

/** Test seam: how many live consumers the poller is currently held by. */
export function autoUpdaterSubscriberCountForTests(): number {
  return subscriberCount;
}

/**
 * Subscribe to the process-wide updater.
 *
 * Every consumer reads the SAME state and drives the SAME check — a manual
 * check from Settings is immediately visible to the banner, and mounting a
 * second consumer does not start a second poller.
 */
export function useAutoUpdater() {
  const snapshot = useSyncExternalStore(subscribe, getState, getState);

  useEffect(() => {
    recordVersionOnce();
    acquirePoller();
    return releasePoller;
  }, []);

  return {
    ...snapshot,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  };
}
