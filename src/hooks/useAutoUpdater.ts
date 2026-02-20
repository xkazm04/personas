import { useState, useEffect, useRef, useCallback } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";

export interface UpdateInfo {
  version: string;
  body: string | null;
}

export function useAutoUpdater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);

  const checkForUpdate = useCallback(async () => {
    if (isChecking) return;
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
      }
    } catch {
      // Silently ignore — endpoint may not be configured yet
    } finally {
      setIsChecking(false);
    }
  }, [isChecking]);

  const installUpdate = useCallback(async () => {
    const update = updateRef.current;
    if (!update) return;
    setIsInstalling(true);
    setError(null);
    try {
      await update.downloadAndInstall();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install update");
      setIsInstalling(false);
    }
  }, []);

  const dismissUpdate = useCallback(() => {
    setUpdateAvailable(false);
    setUpdateInfo(null);
    updateRef.current = null;
  }, []);

  useEffect(() => {
    // Check after a 5-second delay on mount
    const initialTimeout = setTimeout(() => {
      checkForUpdate();
    }, 5000);

    // Then check every 6 hours
    const interval = setInterval(
      () => {
        checkForUpdate();
      },
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
