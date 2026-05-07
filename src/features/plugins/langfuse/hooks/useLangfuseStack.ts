import { useCallback, useEffect, useRef, useState } from "react";
import {
  langfuseDockerDownloadInstaller,
  langfuseDockerRunInstaller,
  langfuseOpenAuthenticatedUI,
  langfuseSavePreferredPort,
  langfuseStackGetAdminCredentials,
  langfuseStackGetInfo,
  langfuseStackOpenUI,
  langfuseStackRefreshImages,
  langfuseStackReset,
  langfuseStackStart,
  langfuseStackStop,
} from "@/api/langfuse";
import type { LangfuseAdminCredentials } from "@/lib/bindings/LangfuseAdminCredentials";
import type { LangfuseJobKind } from "@/lib/bindings/LangfuseJobKind";
import type { LangfuseStackInfo } from "@/lib/bindings/LangfuseStackInfo";
import { useLangfuseStackStore } from "@/stores/langfuseStackStore";
import { toastCatch } from "@/lib/silentCatch";
import { useShallow } from "zustand/react/shallow";

const POLL_INTERVAL_MS = 4_000;

export interface UseLangfuseStack {
  info: LangfuseStackInfo | null;
  loading: boolean;
  /// Backward-compatibility alias for the global store's `jobKind === Start`.
  starting: boolean;
  stopping: boolean;
  jobInFlight: boolean;
  jobKind: LangfuseJobKind | null;
  fraction: number;
  etaSeconds: number;
  message: string;
  lastOutcome: ReturnType<typeof useLangfuseStackStore.getState>["lastOutcome"];
  adminCredentials: LangfuseAdminCredentials | null;

  refresh: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  openUi: () => Promise<void>;
  loadAdminCredentials: () => Promise<LangfuseAdminCredentials | null>;
  savePreferredPort: (port: number) => Promise<void>;
  downloadDockerInstaller: () => Promise<void>;
  runDockerInstaller: (path: string) => Promise<void>;
  resetVolumes: () => Promise<void>;
  refreshImages: () => Promise<void>;
  clearOutcome: () => void;
}

export function useLangfuseStack(): UseLangfuseStack {
  const [info, setInfo] = useState<LangfuseStackInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminCredentials, setAdminCredentials] =
    useState<LangfuseAdminCredentials | null>(null);

  const { jobKind, fraction, etaSeconds, message, lastOutcome, beginJob, clearOutcome } =
    useLangfuseStackStore(
      useShallow((s) => ({
        jobKind: s.jobKind,
        fraction: s.fraction,
        etaSeconds: s.etaSeconds,
        message: s.message,
        lastOutcome: s.lastOutcome,
        beginJob: s.beginJob,
        clearOutcome: s.clearOutcome,
      })),
    );

  const jobInFlight = jobKind !== null;
  const starting = jobKind === "start";
  const stopping = jobKind === "stop";

  const refresh = useCallback(async () => {
    try {
      const next = await langfuseStackGetInfo();
      setInfo(next);
    } catch (e) {
      toastCatch("Langfuse:stack:refresh", "Failed to read Langfuse stack status")(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while a transition is in flight so info reflects the live state
  // (not just the one we read at mount). Also re-fetch right after a job
  // completes so the lastOutcome banner shows accurate "Running" state.
  // And — Phase 1d — keep polling while Docker isn't ready, so the UI
  // advances automatically once the user finishes installing or starting
  // Docker Desktop without needing to click Refresh.
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dockerWaiting =
    info?.state === "dockerMissing" ||
    info?.state === "dockerNotRunning" ||
    info?.state === "composeMissing";
  useEffect(() => {
    const shouldPoll = jobInFlight || dockerWaiting;
    if (!shouldPoll) {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      return;
    }
    // Slower cadence while waiting for Docker — the user is offscreen
    // running an installer. Fast cadence during a job in flight.
    const interval = jobInFlight ? POLL_INTERVAL_MS : 5_000;
    pollTimer.current = setInterval(() => {
      void refresh();
    }, interval);
    return () => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
  }, [jobInFlight, dockerWaiting, refresh]);

  // After a completed job, re-read info once so the panel reflects the new
  // state (e.g. Running) without waiting for the next poll tick.
  useEffect(() => {
    if (lastOutcome) {
      void refresh();
    }
  }, [lastOutcome, refresh]);

  const start = useCallback(async () => {
    try {
      const handle = await langfuseStackStart();
      beginJob(handle.jobId, handle.kind, "Starting Langfuse…");
    } catch (e) {
      toastCatch("Langfuse:stack:start", "Failed to start Langfuse stack")(e);
    }
  }, [beginJob]);

  const stop = useCallback(async () => {
    try {
      const handle = await langfuseStackStop();
      beginJob(handle.jobId, handle.kind, "Stopping Langfuse…");
    } catch (e) {
      toastCatch("Langfuse:stack:stop", "Failed to stop Langfuse stack")(e);
    }
  }, [beginJob]);

  const openUi = useCallback(async () => {
    try {
      // Authenticated path is preferred — backend silently falls back to
      // the plain open-in-browser flow for manual connections (no admin
      // creds), so this command is safe to call regardless of mode.
      await langfuseOpenAuthenticatedUI();
    } catch (e) {
      // Final fallback: try the plain path so a half-broken auto-login
      // doesn't lock the user out of Langfuse entirely.
      try {
        await langfuseStackOpenUI();
      } catch {
        toastCatch("Langfuse:stack:openUi", "Failed to open Langfuse UI")(e);
      }
    }
  }, []);

  const loadAdminCredentials = useCallback(async () => {
    try {
      const creds = await langfuseStackGetAdminCredentials();
      setAdminCredentials(creds);
      return creds;
    } catch (e) {
      toastCatch("Langfuse:stack:adminCreds", "Failed to load admin credentials")(e);
      return null;
    }
  }, []);

  const savePreferredPort = useCallback(
    async (port: number) => {
      try {
        await langfuseSavePreferredPort(port);
        await refresh();
      } catch (e) {
        toastCatch("Langfuse:stack:port", "Failed to save preferred port")(e);
      }
    },
    [refresh],
  );

  const downloadDockerInstaller = useCallback(async () => {
    try {
      const handle = await langfuseDockerDownloadInstaller();
      beginJob(handle.jobId, handle.kind, "Downloading Docker installer…");
    } catch (e) {
      toastCatch("Langfuse:stack:installerDownload", "Failed to start installer download")(e);
    }
  }, [beginJob]);

  const runDockerInstaller = useCallback(async (path: string) => {
    try {
      await langfuseDockerRunInstaller(path);
    } catch (e) {
      toastCatch("Langfuse:stack:runInstaller", "Failed to run installer")(e);
    }
  }, []);

  const resetVolumes = useCallback(async () => {
    try {
      await langfuseStackReset();
      await refresh();
    } catch (e) {
      toastCatch("Langfuse:stack:reset", "Failed to reset stack data")(e);
    }
  }, [refresh]);

  const refreshImages = useCallback(async () => {
    try {
      await langfuseStackRefreshImages();
    } catch (e) {
      toastCatch("Langfuse:stack:refreshImages", "Failed to refresh images")(e);
    }
  }, []);

  return {
    info,
    loading,
    starting,
    stopping,
    jobInFlight,
    jobKind,
    fraction,
    etaSeconds,
    message,
    lastOutcome,
    adminCredentials,
    refresh,
    start,
    stop,
    openUi,
    loadAdminCredentials,
    savePreferredPort,
    downloadDockerInstaller,
    runDockerInstaller,
    resetVolumes,
    refreshImages,
    clearOutcome,
  };
}
