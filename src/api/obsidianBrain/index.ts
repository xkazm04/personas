import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { ObsidianConflictResolution } from "@/api/enums";

export type { ObsidianConflictResolution } from "@/api/enums";

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

/**
 * Push local memories/personas/connectors into the vault.
 *
 * ## `personaIds` contract
 * - `undefined` — sync EVERY persona in the app DB (the "sync all" case).
 * - `[]`        — sync NOTHING; returns a zero-count result. Kept explicit
 *                 so a UI that filters to zero selections cannot nuke the
 *                 vault. Callers MUST NOT fall back to `undefined` when the
 *                 user clears every filter.
 * - `string[]`  — sync exactly those persona ids.
 */
export const obsidianBrainPushSync = (personaIds?: string[]) => {
  // Empty-array short-circuit: preserve the "explicitly sync nothing"
  // semantic without a round-trip. Matches the documented contract above.
  if (personaIds && personaIds.length === 0) {
    return Promise.resolve<PushSyncResult>({ created: 0, updated: 0, skipped: 0, errors: [] });
  }
  return invoke<PushSyncResult>("obsidian_brain_push_sync", { personaIds: personaIds ?? null });
};

export const obsidianBrainGetSyncLog = (limit?: number) =>
  invoke<SyncLogEntry[]>("obsidian_brain_get_sync_log", { limit: limit ?? 50 });

// ── Phase 3: Pull Sync ───────────────────────────────────────────────

export const obsidianBrainPullSync = () =>
  invoke<PullSyncResult>("obsidian_brain_pull_sync");

/**
 * Resolve a detected sync conflict. `resolution` is a typed string-literal
 * union (see {@link ObsidianConflictResolution}) so typos surface at
 * compile time instead of reaching the Rust handler and silently taking
 * the else-branch.
 */
export const obsidianBrainResolveConflict = (
  conflict: SyncConflict,
  resolution: ObsidianConflictResolution,
) =>
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

const EMPTY_DRIVE_SYNC_RESULT: DriveSyncResult = {
  uploaded: 0, downloaded: 0, deleted: 0, skipped: 0, errors: [],
};

/**
 * Push local vault folders to Drive.
 *
 * ## `folderNames` contract
 * - `undefined` — push EVERY synced folder (the "sync all" case).
 * - `[]`        — push NOTHING; returns a zero-count result without
 *                 round-tripping to Rust. Keeps "user deselected every
 *                 filter" safe — previously ambiguous.
 * - `string[]`  — push exactly those top-level folder names.
 */
export const obsidianDrivePushSync = (folderNames?: string[]) => {
  if (folderNames && folderNames.length === 0) {
    return Promise.resolve<DriveSyncResult>({ ...EMPTY_DRIVE_SYNC_RESULT });
  }
  return invoke<DriveSyncResult>("obsidian_drive_push_sync", { folderNames: folderNames ?? null });
};

/**
 * Pull Drive folders down into the local vault. Same {@link obsidianDrivePushSync}
 * `folderNames` semantics apply: `undefined` = all, `[]` = nothing, array = named set.
 */
export const obsidianDrivePullSync = (folderNames?: string[]) => {
  if (folderNames && folderNames.length === 0) {
    return Promise.resolve<DriveSyncResult>({ ...EMPTY_DRIVE_SYNC_RESULT });
  }
  return invoke<DriveSyncResult>("obsidian_drive_pull_sync", { folderNames: folderNames ?? null });
};

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
  /** True iff the daily-note file did not exist and was created by this call. */
  created: boolean;
  /**
   * True iff a `section` was requested AND the section heading did not
   * already exist in the daily note, so the backend appended a new heading.
   * Absent/false when either no section was requested or the section was
   * already present and body was appended under it.
   */
  sectionCreated?: boolean;
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

/**
 * Append `body` to the vault's daily note for `options.date` (defaults to
 * today). When `options.section` is given, the body is appended under a
 * `## <section>` heading.
 *
 * ## Section-append behavior (contract, pinned 2026-04-20)
 *
 * (a) **Section does not exist** → the backend creates the heading at the
 *     end of the note and appends `body` under it. The returned
 *     {@link DailyNoteRef} has `sectionCreated === true`.
 *
 * (b) **Daily note does not exist** → the note is created (stamped with
 *     `created: true`). If `section` was requested, the heading is also
 *     inserted (`sectionCreated: true`).
 *
 * (c) **Section exists multiple times** → body is appended under the FIRST
 *     occurrence only. Multiple `## <section>` headings in the same daily
 *     note are treated as a single logical section for append purposes;
 *     callers who want strict uniqueness should sanitize up front.
 *
 * (d) **Body contains markdown that would close the section** (e.g. a
 *     top-level `## Other` heading inside `body`) → the backend appends the
 *     body verbatim. It does NOT try to sanitize the user's markdown — any
 *     further `##` heading in the body logically ends the requested section
 *     for readers. Callers who need to prevent this must escape or indent
 *     their own headings before calling.
 */
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
