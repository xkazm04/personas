import { create } from "zustand";
import type { LangfuseJobKind } from "@/lib/bindings/LangfuseJobKind";
import type { LangfuseStackDone } from "@/lib/bindings/LangfuseStackDone";
import type { LangfuseStackProgress } from "@/lib/bindings/LangfuseStackProgress";

/// Live progress for a Langfuse stack background job (start/stop/installer
/// download). Lives in its own zustand store so navigating away from the
/// plugin page doesn't drop the in-flight progress — the global listener in
/// `App.tsx` keeps writing here regardless of which page is mounted.
export interface LangfuseStackStoreState {
  /// Active job id, or null when nothing is in flight.
  jobId: string | null;
  jobKind: LangfuseJobKind | null;
  /// Aggregate fraction in [0, 1].
  fraction: number;
  /// Estimated seconds remaining. 0 when unknown.
  etaSeconds: number;
  /// Human-readable phase message — what's happening right now.
  message: string;
  /// Outcome of the last completed job (kept until the next start). Lets
  /// the UI show "succeeded just now" or "failed: X" after the user
  /// navigated back.
  lastOutcome: {
    kind: LangfuseJobKind;
    success: boolean;
    error: string | null;
    installerPath: string | null;
    completedAt: number;
  } | null;

  /** Receive a `langfuse://stack/progress` payload from Tauri. */
  onProgress: (p: LangfuseStackProgress) => void;
  /** Receive a `langfuse://stack/done` payload from Tauri. */
  onDone: (d: LangfuseStackDone) => void;
  /** Mark a new job as starting (called immediately after kicking off the
   *  command, before the first event arrives, so the UI flips into
   *  "in progress" without a frame of staleness). */
  beginJob: (jobId: string, kind: LangfuseJobKind, message?: string) => void;
  /** Drop the lastOutcome banner. */
  clearOutcome: () => void;
}

export const useLangfuseStackStore = create<LangfuseStackStoreState>((set) => ({
  jobId: null,
  jobKind: null,
  fraction: 0,
  etaSeconds: 0,
  message: "",
  lastOutcome: null,

  onProgress: (p) => {
    set({
      jobId: p.jobId,
      jobKind: p.kind,
      fraction: p.fraction,
      etaSeconds: Number(p.etaSeconds),
      message: p.message,
    });
  },

  onDone: (d) => {
    set({
      jobId: null,
      jobKind: null,
      fraction: d.success ? 1 : 0,
      etaSeconds: 0,
      message: "",
      lastOutcome: {
        kind: d.kind,
        success: d.success,
        error: d.error,
        installerPath: d.installerPath,
        completedAt: Date.now(),
      },
    });
  },

  beginJob: (jobId, kind, message = "") => {
    set({
      jobId,
      jobKind: kind,
      fraction: 0,
      etaSeconds: 0,
      message,
      lastOutcome: null,
    });
  },

  clearOutcome: () => set({ lastOutcome: null }),
}));
