import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import * as Sentry from "@sentry/react";
import { silentCatch } from "@/lib/silentCatch";

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
  const [error, setError] = useState<string | null>(null);
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
    }
  }, [isChecking]);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    const installVersion = update.version;
    setIsInstalling(true);
    setError(null);
    Sentry.addBreadcrumb({
      category: "update",
      message: `Update install started: v${installVersion}`,
      level: "info",
    });
    try {
      await update.downloadAndInstall();
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
  }, []);

  return {
    updateAvailable,
    updateInfo,
    isChecking,
    isInstalling,
    error,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  };
}
