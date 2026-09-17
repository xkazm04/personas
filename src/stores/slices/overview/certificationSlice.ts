import type { StateCreator } from "zustand";
import type { OverviewStore } from "../../storeTypes";
import type { EvalRunSummary } from "@/lib/bindings/EvalRunSummary";
import type { TeamCertStatus } from "@/lib/bindings/TeamCertStatus";
import type { EvalRunDetail } from "@/lib/bindings/EvalRunDetail";
import { fetchEvalRuns, fetchCertStatus, fetchEvalRun } from "@/api/overview/certification";
import { log } from "@/lib/log";
import { measureStoreAction } from "@/lib/utils/storePerf";
import { createLatestWins } from "../../util/latestWins";

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
// newer run's detail, so the panel shows the wrong run. Same shape as
// `cronAgentsSlice.fetchCronAgents` / `memorySlice.fetchMemories`.
const certDetailLatestWins = createLatestWins();

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
        // Each list paints as it lands — overview does not wait on the
        // archive walk, history does not wait on cert status.
        const errors: string[] = [];
        const note = (err: unknown) => {
          errors.push(err instanceof Error ? err.message : String(err));
        };
        await Promise.all([
          fetchCertStatus()
            .then((certStatus) => set({ certStatus }))
            .catch(note),
          fetchEvalRuns()
            .then((evalRuns) => set({ evalRuns }))
            .catch(note),
        ]);
        set({
          certLoading: false,
          certLastRefreshedAt: Date.now(),
          certError: errors[0] ?? null,
        });
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("certificationSlice", "refreshCertification failed", { error: msg });
      set({ certError: msg, certLoading: false });
    }
  },

  loadEvalRunDetail: async (runId: string) => {
    const token = certDetailLatestWins.next();
    set({ certDetailLoading: true, certError: null });
    try {
      const detail = await fetchEvalRun(runId);
      if (!certDetailLatestWins.isCurrent(token)) return; // a newer run was selected — drop stale result
      set({ evalRunDetail: detail, certDetailLoading: false });
    } catch (err) {
      if (!certDetailLatestWins.isCurrent(token)) return;
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("certificationSlice", "loadEvalRunDetail failed", { runId, error: msg });
      set({ certError: msg, certDetailLoading: false });
    }
  },

  clearEvalRunDetail: () => set({ evalRunDetail: null }),
});
