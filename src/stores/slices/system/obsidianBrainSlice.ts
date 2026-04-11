import type { StateCreator } from "zustand";
import type { SystemStore } from "../../storeTypes";
import type { ObsidianBrainTab } from "@/lib/types/types";

export interface SyncLogEntryUI {
  id: string;
  syncType: string;
  entityType: string;
  action: string;
  details: string | null;
  createdAt: string;
}

export interface ObsidianBrainSlice {
  obsidianBrainTab: ObsidianBrainTab;
  obsidianVaultPath: string | null;
  obsidianVaultName: string | null;
  obsidianConnected: boolean;
  obsidianSyncRunning: boolean;
  obsidianLastSyncAt: string | null;
  obsidianPendingConflicts: number;
  obsidianSyncLog: SyncLogEntryUI[];

  // Google Drive cloud sync state
  obsidianDriveConnected: boolean;
  obsidianDriveEmail: string | null;
  obsidianDriveSyncRunning: boolean;
  obsidianLastDriveSyncAt: string | null;
  obsidianDriveStorageUsed: number | null;
  obsidianDriveStorageLimit: number | null;
  obsidianDriveFileCount: number;

  // Actions
  setObsidianBrainTab: (tab: ObsidianBrainTab) => void;
  setObsidianVaultPath: (path: string | null) => void;
  setObsidianVaultName: (name: string | null) => void;
  setObsidianConnected: (connected: boolean) => void;
  setObsidianSyncRunning: (running: boolean) => void;
  setObsidianLastSyncAt: (at: string | null) => void;
  setObsidianPendingConflicts: (count: number) => void;
  appendObsidianSyncLog: (entry: SyncLogEntryUI) => void;
  setObsidianSyncLog: (log: SyncLogEntryUI[]) => void;
  clearObsidianSyncLog: () => void;

  // Google Drive actions
  setObsidianDriveConnected: (connected: boolean) => void;
  setObsidianDriveEmail: (email: string | null) => void;
  setObsidianDriveSyncRunning: (running: boolean) => void;
  setObsidianLastDriveSyncAt: (at: string | null) => void;
  setObsidianDriveStorage: (used: number | null, limit: number | null) => void;
  setObsidianDriveFileCount: (count: number) => void;
}

const MAX_LOG_ENTRIES = 200;

export const createObsidianBrainSlice: StateCreator<SystemStore, [], [], ObsidianBrainSlice> = (set) => ({
  obsidianBrainTab: "setup" as ObsidianBrainTab,
  obsidianVaultPath: null,
  obsidianVaultName: null,
  obsidianConnected: false,
  obsidianSyncRunning: false,
  obsidianLastSyncAt: null,
  obsidianPendingConflicts: 0,
  obsidianSyncLog: [],

  // Google Drive defaults
  obsidianDriveConnected: false,
  obsidianDriveEmail: null,
  obsidianDriveSyncRunning: false,
  obsidianLastDriveSyncAt: null,
  obsidianDriveStorageUsed: null,
  obsidianDriveStorageLimit: null,
  obsidianDriveFileCount: 0,

  setObsidianBrainTab: (tab) => set({ obsidianBrainTab: tab }),
  setObsidianVaultPath: (path) => set({ obsidianVaultPath: path }),
  setObsidianVaultName: (name) => set({ obsidianVaultName: name }),
  setObsidianConnected: (connected) => set({ obsidianConnected: connected }),
  setObsidianSyncRunning: (running) => set({ obsidianSyncRunning: running }),
  setObsidianLastSyncAt: (at) => set({ obsidianLastSyncAt: at }),
  setObsidianPendingConflicts: (count) => set({ obsidianPendingConflicts: count }),
  appendObsidianSyncLog: (entry) =>
    set((s) => ({
      obsidianSyncLog: [entry, ...s.obsidianSyncLog].slice(0, MAX_LOG_ENTRIES),
    })),
  setObsidianSyncLog: (log) => set({ obsidianSyncLog: log }),
  clearObsidianSyncLog: () => set({ obsidianSyncLog: [] }),

  // Google Drive actions
  setObsidianDriveConnected: (connected) => set({ obsidianDriveConnected: connected }),
  setObsidianDriveEmail: (email) => set({ obsidianDriveEmail: email }),
  setObsidianDriveSyncRunning: (running) => set({ obsidianDriveSyncRunning: running }),
  setObsidianLastDriveSyncAt: (at) => set({ obsidianLastDriveSyncAt: at }),
  setObsidianDriveStorage: (used, limit) => set({ obsidianDriveStorageUsed: used, obsidianDriveStorageLimit: limit }),
  setObsidianDriveFileCount: (count) => set({ obsidianDriveFileCount: count }),
});
