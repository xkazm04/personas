import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ── Types ────────────────────────────────────────────────────────────

export interface DetectedVault {
  name: string;
  path: string;
  exists: boolean;
}

export interface VaultConnectionResult {
  valid: boolean;
  noteCount: number;
  vaultName: string;
  error: string | null;
}

export interface FolderMapping {
  memoriesFolder: string;
  personasFolder: string;
  connectorsFolder: string;
}

export interface ObsidianVaultConfig {
  vaultPath: string;
  vaultName: string;
  syncMemories: boolean;
  syncPersonas: boolean;
  syncConnectors: boolean;
  autoSync: boolean;
  folderMapping: FolderMapping;
}

export interface SyncLogEntry {
  id: string;
  syncType: string;
  entityType: string;
  entityId: string | null;
  vaultFilePath: string | null;
  action: string;
  details: string | null;
  createdAt: string;
}

export interface SyncConflict {
  id: string;
  entityType: string;
  entityId: string;
  filePath: string;
  appContent: string;
  vaultContent: string;
  appHash: string;
  vaultHash: string;
  baseHash: string;
  detectedAt: string;
}

export interface PushSyncResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface PullSyncResult {
  created: number;
  updated: number;
  conflicts: SyncConflict[];
  errors: string[];
}

export interface VaultTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: VaultTreeNode[];
  noteCount: number;
}

// ── Phase 1: Vault Discovery & Config ────────────────────────────────

export const obsidianBrainDetectVaults = () =>
  invoke<DetectedVault[]>("obsidian_brain_detect_vaults");

export const obsidianBrainTestConnection = (vaultPath: string) =>
  invoke<VaultConnectionResult>("obsidian_brain_test_connection", { vaultPath });

export const obsidianBrainSaveConfig = (config: ObsidianVaultConfig) =>
  invoke<void>("obsidian_brain_save_config", { config });

export const obsidianBrainGetConfig = () =>
  invoke<ObsidianVaultConfig | null>("obsidian_brain_get_config");

// ── Phase 2: Push Sync ───────────────────────────────────────────────

export const obsidianBrainPushSync = (personaIds?: string[]) =>
  invoke<PushSyncResult>("obsidian_brain_push_sync", { personaIds: personaIds ?? null });

export const obsidianBrainGetSyncLog = (limit?: number) =>
  invoke<SyncLogEntry[]>("obsidian_brain_get_sync_log", { limit: limit ?? 50 });

// ── Phase 3: Pull Sync ───────────────────────────────────────────────

export const obsidianBrainPullSync = () =>
  invoke<PullSyncResult>("obsidian_brain_pull_sync");

export const obsidianBrainResolveConflict = (conflict: SyncConflict, resolution: string) =>
  invoke<void>("obsidian_brain_resolve_conflict", { conflict, resolution });

// ── Phase 4: Vault Browser ──────────────────────────────────────────

export const obsidianBrainListVaultFiles = (path?: string) =>
  invoke<VaultTreeNode>("obsidian_brain_list_vault_files", { path: path ?? null });

export const obsidianBrainReadVaultNote = (filePath: string) =>
  invoke<string>("obsidian_brain_read_vault_note", { filePath });

// ── Phase 5: Goal Tree Sync ────────────────────────────────────────

export const obsidianBrainPushGoals = (projectId: string) =>
  invoke<PushSyncResult>("obsidian_brain_push_goals", { projectId });

// ── Phase 6: Google Drive Cloud Sync ──────────────────────────────

export interface DriveSyncResult {
  uploaded: number;
  downloaded: number;
  deleted: number;
  skipped: number;
  errors: string[];
}

export interface DriveStatus {
  connected: boolean;
  email: string | null;
  storageUsedBytes: number | null;
  storageLimitBytes: number | null;
  lastSyncAt: string | null;
  manifestFileCount: number;
}

export const obsidianDriveStatus = () =>
  invoke<DriveStatus>("obsidian_drive_status");

export const obsidianDrivePushSync = (folderNames?: string[]) =>
  invoke<DriveSyncResult>("obsidian_drive_push_sync", { folderNames: folderNames ?? null });

export const obsidianDrivePullSync = (folderNames?: string[]) =>
  invoke<DriveSyncResult>("obsidian_drive_pull_sync", { folderNames: folderNames ?? null });

export const loginWithGoogleDrive = () =>
  invoke<void>("login_with_google_drive");

export const getGoogleDriveStatus = () =>
  invoke<boolean>("get_google_drive_status");

// ── Phase 7: Obsidian Memory connector (graph operations) ─────────

export interface VaultSearchHit {
  path: string;
  title: string;
  snippet: string;
  score: number;
}

export interface VaultLinkRef {
  path: string;
  title: string;
}

export interface VaultMocEntry {
  path: string;
  title: string;
  outgoingLinkCount: number;
}

export interface VaultStats {
  totalNotes: number;
  totalLinks: number;
  orphanCount: number;
  mocCount: number;
  dailyNoteCount: number;
}

export interface DailyNoteRef {
  path: string;
  date: string;
  created: boolean;
}

export const obsidianGraphSearch = (query: string, limit?: number) =>
  invoke<VaultSearchHit[]>("obsidian_graph_search", { query, limit: limit ?? null });

export const obsidianGraphOutgoingLinks = (notePath: string) =>
  invoke<VaultLinkRef[]>("obsidian_graph_outgoing_links", { notePath });

export const obsidianGraphBacklinks = (notePath: string) =>
  invoke<VaultLinkRef[]>("obsidian_graph_backlinks", { notePath });

export const obsidianGraphListOrphans = (limit?: number) =>
  invoke<VaultLinkRef[]>("obsidian_graph_list_orphans", { limit: limit ?? null });

export const obsidianGraphListMocs = (minLinks?: number, limit?: number) =>
  invoke<VaultMocEntry[]>("obsidian_graph_list_mocs", {
    minLinks: minLinks ?? null,
    limit: limit ?? null,
  });

export const obsidianGraphStats = () =>
  invoke<VaultStats>("obsidian_graph_stats");

export const obsidianGraphAppendDailyNote = (
  body: string,
  options?: { date?: string; section?: string },
) =>
  invoke<DailyNoteRef>("obsidian_graph_append_daily_note", {
    date: options?.date ?? null,
    section: options?.section ?? null,
    body,
  });

export const obsidianGraphWriteMeetingNote = (
  title: string,
  body: string,
  attendees?: string[],
) =>
  invoke<VaultLinkRef>("obsidian_graph_write_meeting_note", {
    title,
    attendees: attendees ?? null,
    body,
  });

export const obsidianGraphStartWatcher = () =>
  invoke<void>("obsidian_graph_start_watcher");

export const obsidianGraphStopWatcher = () =>
  invoke<void>("obsidian_graph_stop_watcher");

export interface VaultChangedEvent {
  vaultPath: string;
  changedPaths: string[];
}

export const VAULT_CHANGED_EVENT = "obsidian:vault-changed";
