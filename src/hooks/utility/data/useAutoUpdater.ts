import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { getVersion } from "@tauri-apps/api/app";
import * as Sentry from "@sentry/react";
import { silentCatch } from "@/lib/silentCatch";
import { recordVersion } from "@/lib/updateHistory";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

/** Outcome of a manual check — used by Settings UI for toast feedback. */
export type CheckOutcome = "update-available" | "up-to-date" | "failed";

export function useAutoUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  // 0–100 while the update payload is downloading, or null when the total
  // size is unknown / not downloading. Drives the banner's progress bar.
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Epoch ms of the last completed check (any outcome), or null before the
  // first check resolves. Surfaced in Settings so the user can confirm the
  // background poll is actually running.
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async (): Promise<CheckOutcome> => {
    if (isChecking) return "up-to-date";
    setIsChecking(true);
    setError(null);
    try {
      const update = await check();
      if (update) {
        updateRef.current = update;
        setUpdateInfo({
          version: update.version,
          body: update.body ?? null,
        });
        setUpdateAvailable(true);
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
      return "failed";
    } finally {
      setIsChecking(false);
      setLastChecked(Date.now());
    }
  }, [isChecking]);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    const installVersion = update.version;
    setIsInstalling(true);
    setDownloadProgress(null);
    setError(null);
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
            setDownloadProgress(contentLength > 0 ? 0 : null);
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setDownloadProgress(
                Math.min(100, Math.round((downloaded / contentLength) * 100)),
              );
            }
            break;
          case "Finished":
            setDownloadProgress(100);
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
      setError(message);
      setIsInstalling(false);
      setDownloadProgress(null);
      Sentry.captureException(err, {
        tags: { event: "update.install.failed" },
        extra: { version: installVersion },
      });
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
    setUpdateInfo(null);
    updateRef.current = null;
  }, []);

  useEffect(() => {
    // Record the running version once per launch so Settings can show an
    // update-history timeline. Idempotent — only appends on version change.
    getVersion()
      .then((v) => { recordVersion(v); })
      .catch(silentCatch("useAutoUpdater:recordVersion"));

    // Check after a 5-second delay on mount, then every 6 hours.
    // Outcome is intentionally ignored — checkForUpdate already routes
    // failures through silentCatch and successes through Sentry breadcrumbs.
    const initialTimeout = setTimeout(() => { void checkForUpdate(); }, 5000);
    const interval = setInterval(
      () => { void checkForUpdate(); },
      6 * 60 * 60 * 1000,
    );

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkForUpdate]);

  return {
    updateAvailable,
    updateInfo,
    isChecking,
    isInstalling,
    downloadProgress,
    error,
    lastChecked,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  };
}
