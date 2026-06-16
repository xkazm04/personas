import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { EvalRunSummary } from "@/lib/bindings/EvalRunSummary";
import type { TeamCertStatus } from "@/lib/bindings/TeamCertStatus";
import type { EvalRunDetail } from "@/lib/bindings/EvalRunDetail";
import { fetchEvalRuns, fetchCertStatus, fetchEvalRun } from "@/api/overview/certification";
import { log } from "@/lib/log";
import { measureStoreAction } from "@/lib/utils/storePerf";

// ---------------------------------------------------------------------------
// Certification slice — read-only state for the dev-only Certification Command
// Center. Backed by the `eval_runs` Tauri commands reading `docs/test/runs/`.
// ---------------------------------------------------------------------------

export interface CertificationSlice {
  // State
  evalRuns: EvalRunSummary[];
  certStatus: TeamCertStatus[];
  evalRunDetail: EvalRunDetail | null;
  certLoading: boolean;
  certDetailLoading: boolean;
  certError: string | null;
  certLastRefreshedAt: number | null;

  // Actions
  refreshCertification: () => Promise<void>;
  loadEvalRunDetail: (runId: string) => Promise<void>;
  clearEvalRunDetail: () => void;
}

// Monotonic guard for loadEvalRunDetail: clicking two runs issues two
// un-deduped fetches; without this the slower one resolving last overwrites the
// newer run's detail, so the panel shows the wrong run.
let certDetailSeq = 0;

export const createCertificationSlice: StateCreator<
  OverviewStore,
  [],
  [],
  CertificationSlice
> = (set) => ({
  evalRuns: [],
  certStatus: [],
  evalRunDetail: null,
  certLoading: false,
  certDetailLoading: false,
  certError: null,
  certLastRefreshedAt: null,

  refreshCertification: async () => {
    set({ certLoading: true, certError: null });
    try {
      await measureStoreAction("refreshCertification", async () => {
        // allSettled so one failing read doesn't blank the other panel.
        const [statusRes, runsRes] = await Promise.allSettled([
          fetchCertStatus(),
          fetchEvalRuns(),
        ]);

        const certStatus = statusRes.status === "fulfilled" ? statusRes.value : [];
        const evalRuns = runsRes.status === "fulfilled" ? runsRes.value : [];

        const firstError =
          statusRes.status === "rejected"
            ? statusRes.reason
            : runsRes.status === "rejected"
              ? runsRes.reason
              : null;

        set({
          certStatus,
          evalRuns,
          certLoading: false,
          certLastRefreshedAt: Date.now(),
          certError: firstError
            ? firstError instanceof Error
              ? firstError.message
              : String(firstError)
            : null,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("certificationSlice", "refreshCertification failed", { error: msg });
      set({ certError: msg, certLoading: false });
    }
  },

  loadEvalRunDetail: async (runId: string) => {
    const seq = ++certDetailSeq;
    set({ certDetailLoading: true, certError: null });
    try {
      const detail = await fetchEvalRun(runId);
      if (seq !== certDetailSeq) return; // a newer run was selected — drop stale result
      set({ evalRunDetail: detail, certDetailLoading: false });
    } catch (err) {
      if (seq !== certDetailSeq) return;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("certificationSlice", "loadEvalRunDetail failed", { runId, error: msg });
      set({ certError: msg, certDetailLoading: false });
    }
  },

  clearEvalRunDetail: () => set({ evalRunDetail: null }),
});
