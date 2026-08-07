/**
 * Remote-job history + the arrival notice for work a paired device asked this
 * device to run.
 *
 * Two surfaces, one slice, because they are two views of the same exchange:
 * the durable record (Settings → Devices) and the ambient chip that says an
 * errand is running right now. Keeping them together is what lets the chip and
 * the table agree without a second source of truth.
 *
 * Thin on purpose, like `devicesSlice`: every decision — how a pushed row
 * merges, when a notice expires — lives in the pure modules under
 * `@/lib/network`, so both are testable without a store or React.
 *
 * Every action awaits `ensureP2pSupport()` first, reads AND writes.
 */
import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import { reportError } from "../../storeTypes";
import * as remoteJobsApi from "@/api/network/remoteJobs";
import type { RemoteJob } from "@/lib/bindings/RemoteJob";
import type { RemoteJobNote } from "@/lib/bindings/RemoteJobNote";
import {
  replaceRemoteJobs,
  upsertRemoteJob,
  type RemoteJobDirectionFilter,
} from "@/lib/network/remoteJobHistory";
import {
  reduceRemoteJobNotices,
  type RemoteJobNotice,
  type RemoteJobTurnEvent,
} from "@/lib/network/remoteJobNotice";
import { P2pUnavailableError } from "./networkSlice";

export interface RemoteJobsSlice {
  /** The merged remote-job timeline, newest first. */
  remoteJobs: RemoteJob[];
  /** True while the first (or a forced) history fetch is in flight. */
  remoteJobsLoading: boolean;
  /** True once a history fetch has settled at least once. */
  remoteJobsSynced: boolean;
  /**
   * Live arrival notices, newest first. Driven entirely by
   * `companion://remote-job-turn`; the chip renders element 0.
   */
  remoteJobNotices: RemoteJobNotice[];

  fetchRemoteJobs: (direction?: RemoteJobDirectionFilter) => Promise<void>;
  /** Merge one pushed row (from `network:remote-job-updated`). */
  applyRemoteJobUpdate: (job: RemoteJob) => void;
  fetchRemoteJobNotes: (jobId: string) => Promise<RemoteJobNote[]>;
  /**
   * Dispatch an instruction to a paired device. Rejects with the backend's
   * typed error (not paired, offline, …) so the caller can surface it in place.
   */
  sendRemoteInstruction: (peerId: string, instruction: string) => Promise<RemoteJob>;

  /** Fold a `companion://remote-job-turn` payload into the notice list. */
  applyRemoteJobTurn: (event: RemoteJobTurnEvent) => void;
  /** Drop notices whose TTL has elapsed. Driven by a timer in the chip. */
  expireRemoteJobNotices: () => void;
  dismissRemoteJobNotice: (jobId: string) => void;
}

export const createRemoteJobsSlice: StateCreator<SystemStore, [], [], RemoteJobsSlice> = (
  set,
  get,
) => ({
  remoteJobs: [],
  remoteJobsLoading: false,
  remoteJobsSynced: false,
  remoteJobNotices: [],

  fetchRemoteJobs: async (direction) => {
    if (!(await get().ensureP2pSupport())) return;
    set({ remoteJobsLoading: true });
    try {
      const jobs = await remoteJobsApi.listRemoteJobs(direction === "all" ? undefined : direction);
      set({
        remoteJobs: replaceRemoteJobs(jobs),
        remoteJobsLoading: false,
        remoteJobsSynced: true,
      });
    } catch (err) {
      reportError(err, "Failed to load remote job history", set, {
        severity: "state",
        stateUpdates: { remoteJobsLoading: false, remoteJobsSynced: true },
      });
    }
  },

  applyRemoteJobUpdate: (job) => {
    set((s) => {
      const next = upsertRemoteJob(s.remoteJobs, job);
      // `upsertRemoteJob` returns the same reference for a no-op push, so a
      // burst of redundant events costs nothing.
      return next === s.remoteJobs ? {} : { remoteJobs: next };
    });
  },

  fetchRemoteJobNotes: async (jobId) => {
    if (!(await get().ensureP2pSupport())) return [];
    return remoteJobsApi.listRemoteJobNotes(jobId);
  },

  sendRemoteInstruction: async (peerId, instruction) => {
    if (!(await get().ensureP2pSupport())) throw new P2pUnavailableError();
    const job = await remoteJobsApi.sendRemoteInstruction(peerId, instruction);
    // Land the acknowledged row immediately — the operator asked for it, so it
    // must appear without waiting for the transport's own push.
    get().applyRemoteJobUpdate(job);
    return job;
  },

  applyRemoteJobTurn: (event) => {
    set((s) => {
      const next = reduceRemoteJobNotices(s.remoteJobNotices, {
        type: "turn",
        event,
        now: Date.now(),
      });
      return next === s.remoteJobNotices ? {} : { remoteJobNotices: next };
    });
  },

  expireRemoteJobNotices: () => {
    set((s) => {
      const next = reduceRemoteJobNotices(s.remoteJobNotices, { type: "expire", now: Date.now() });
      return next === s.remoteJobNotices ? {} : { remoteJobNotices: next };
    });
  },

  dismissRemoteJobNotice: (jobId) => {
    set((s) => {
      const next = reduceRemoteJobNotices(s.remoteJobNotices, { type: "dismiss", jobId });
      return next === s.remoteJobNotices ? {} : { remoteJobNotices: next };
    });
  },
});
