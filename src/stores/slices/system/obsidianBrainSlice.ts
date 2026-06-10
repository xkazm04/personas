import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { ObsidianBrainTab } from "@/lib/types/types";

export interface ObsidianBrainSlice {
  obsidianBrainTab: ObsidianBrainTab;
  obsidianVaultPath: string | null;
  obsidianVaultName: string | null;
  obsidianConnected: boolean;
  obsidianSyncRunning: boolean;
  obsidianLastSyncAt: string | null;
  obsidianPendingConflicts: number;

  // Google Drive cloud sync state
  obsidianDriveConnected: boolean;
  obsidianDriveEmail: string | null;
  obsidianDriveSyncRunning: boolean;
  obsidianLastDriveSyncAt: string | null;
  obsidianDriveStorageUsed: number | null;
  obsidianDriveStorageLimit: number | null;
  obsidianDriveFileCount: number;

  // Revitalize (background vault memory optimization).
  // `obsidianRevitalizeRunning` drives the sidebar status dots (L1 Plugins,
  // L2 Brain, L3 Revitalize) — kept accurate across routes by the global
  // OBSIDIAN_REVITALIZE_STATUS listener in eventBridge.
  obsidianRevitalizeRunning: boolean;
  obsidianRevitalizeJobId: string | null;
  /** One-shot completion flag — shows the emerald dot until dismissed. */
  obsidianRevitalizeJustCompleted: boolean;

  // Actions
  setObsidianBrainTab: (tab: ObsidianBrainTab) => void;
  setObsidianVaultPath: (path: string | null) => void;
  setObsidianVaultName: (name: string | null) => void;
  setObsidianConnected: (connected: boolean) => void;
  setObsidianSyncRunning: (running: boolean) => void;
  setObsidianLastSyncAt: (at: string | null) => void;
  setObsidianPendingConflicts: (count: number) => void;

  // Google Drive actions
  setObsidianDriveConnected: (connected: boolean) => void;
  setObsidianDriveEmail: (email: string | null) => void;
  setObsidianDriveSyncRunning: (running: boolean) => void;
  setObsidianLastDriveSyncAt: (at: string | null) => void;
  setObsidianDriveStorage: (used: number | null, limit: number | null) => void;
  setObsidianDriveFileCount: (count: number) => void;

  // Revitalize actions
  startObsidianRevitalize: (jobId: string) => void;
  clearObsidianRevitalizeCompletion: () => void;
  /** Internal — driven by the global OBSIDIAN_REVITALIZE_STATUS listener. */
  onObsidianRevitalizeStatus: (p: { job_id: string; status: string; error?: string }) => void;
}

export const createObsidianBrainSlice: StateCreator<SystemStore, [], [], ObsidianBrainSlice> = (set, get) => ({
  obsidianBrainTab: "setup" as ObsidianBrainTab,
  obsidianVaultPath: null,
  obsidianVaultName: null,
  obsidianConnected: false,
  obsidianSyncRunning: false,
  obsidianLastSyncAt: null,
  obsidianPendingConflicts: 0,

  // Google Drive defaults
  obsidianDriveConnected: false,
  obsidianDriveEmail: null,
  obsidianDriveSyncRunning: false,
  obsidianLastDriveSyncAt: null,
  obsidianDriveStorageUsed: null,
  obsidianDriveStorageLimit: null,
  obsidianDriveFileCount: 0,

  // Revitalize defaults
  obsidianRevitalizeRunning: false,
  obsidianRevitalizeJobId: null,
  obsidianRevitalizeJustCompleted: false,

  setObsidianBrainTab: (tab) => set({ obsidianBrainTab: tab }),
  setObsidianVaultPath: (path) => set({ obsidianVaultPath: path }),
  setObsidianVaultName: (name) => set({ obsidianVaultName: name }),
  setObsidianConnected: (connected) => set({ obsidianConnected: connected }),
  setObsidianSyncRunning: (running) => set({ obsidianSyncRunning: running }),
  setObsidianLastSyncAt: (at) => set({ obsidianLastSyncAt: at }),
  setObsidianPendingConflicts: (count) => set({ obsidianPendingConflicts: count }),

  // Google Drive actions
  setObsidianDriveConnected: (connected) => set({ obsidianDriveConnected: connected }),
  setObsidianDriveEmail: (email) => set({ obsidianDriveEmail: email }),
  setObsidianDriveSyncRunning: (running) => set({ obsidianDriveSyncRunning: running }),
  setObsidianLastDriveSyncAt: (at) => set({ obsidianLastDriveSyncAt: at }),
  setObsidianDriveStorage: (used, limit) => set({ obsidianDriveStorageUsed: used, obsidianDriveStorageLimit: limit }),
  setObsidianDriveFileCount: (count) => set({ obsidianDriveFileCount: count }),

  // Revitalize actions
  startObsidianRevitalize: (jobId) =>
    set({
      obsidianRevitalizeJobId: jobId,
      obsidianRevitalizeRunning: true,
      obsidianRevitalizeJustCompleted: false,
    }),
  clearObsidianRevitalizeCompletion: () => set({ obsidianRevitalizeJustCompleted: false }),
  onObsidianRevitalizeStatus: (p) => {
    // Ignore status from a stale job the user already moved past.
    const current = get().obsidianRevitalizeJobId;
    if (current && p.job_id !== current) return;
    if (p.status === "running") {
      set({ obsidianRevitalizeJobId: p.job_id, obsidianRevitalizeRunning: true });
    } else if (p.status === "completed") {
      set({ obsidianRevitalizeRunning: false, obsidianRevitalizeJustCompleted: true });
    } else if (p.status === "failed") {
      set({ obsidianRevitalizeRunning: false });
    }
  },
});
