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
  // In-flight guard kept in a ref (not state) so this callback stays stable.
  // Depending on `isChecking` state here would give checkForUpdate a new
  // identity on every toggle, re-running the scheduling effect below and
  // rescheduling its 5s timeout — turning the 6h poll into a ~5s spam loop.
  const checkingRef = useRef(false);

  const checkForUpdate = useCallback(async (): Promise<CheckOutcome> => {
    if (checkingRef.current) return "up-to-date";
    checkingRef.current = true;
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
      checkingRef.current = false;
      setIsChecking(false);
    }
  }, []);

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
    // Skip automatic checks in dev: there is no signed release artifact to
    // update to, and the updater capability only matters for packaged builds.
    // Manual checkForUpdate() from Settings still works. This is what stops
    // the recurring "updater.check not allowed" noise during development.
    if (import.meta.env.DEV) return;
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
    error,
    checkForUpdate,
    installUpdate,
    dismissUpdate,
  };
}
