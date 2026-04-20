/**
 * Shared string-literal unions for IPC payloads that previously accepted
 * arbitrary `string` values and silently took the else-branch on typos.
 *
 * Each union below must stay in sync with its Rust-side counterpart. The
 * frontend now rejects unknowns at compile time; Rust handlers additionally
 * validate the serialised value and return an error for unknowns (rather
 * than silently defaulting). Add a value HERE FIRST, then the Rust handler.
 */

// ---------------------------------------------------------------------------
// Obsidian sync conflict resolution
// ---------------------------------------------------------------------------

/**
 * How to resolve a detected {@link SyncConflict}. Values match the Rust
 * `obsidian_brain_resolve_conflict` handler.
 * - `use_app`   — keep the desktop app's version; overwrite the vault copy.
 * - `use_vault` — keep the Obsidian-vault version; overwrite the app DB.
 * - `skip`      — leave both sides alone for now (conflict remains resolved
 *                 from the UI's perspective but neither side is modified).
 */
export type ObsidianConflictResolution = 'use_app' | 'use_vault' | 'skip';

export const OBSIDIAN_CONFLICT_RESOLUTIONS: readonly ObsidianConflictResolution[] = [
  'use_app',
  'use_vault',
  'skip',
] as const;

// ---------------------------------------------------------------------------
// Twin channels
// ---------------------------------------------------------------------------

/**
 * Valid `channel` identifiers across twin tone / communication /
 * recordInteraction / createChannel endpoints. The Rust side maps these to a
 * `ChannelKind` enum; unknown values are rejected with a typed error.
 */
export type TwinChannelKind =
  | 'email'
  | 'sms'
  | 'slack'
  | 'discord'
  | 'telegram'
  | 'signal'
  | 'teams'
  | 'whatsapp'
  | 'voice'
  | 'training'
  | 'other';

export const TWIN_CHANNEL_KINDS: readonly TwinChannelKind[] = [
  'email',
  'sms',
  'slack',
  'discord',
  'telegram',
  'signal',
  'teams',
  'whatsapp',
  'voice',
  'training',
  'other',
] as const;

/**
 * Direction of a recorded communication interaction. Values match the Rust
 * `twin_record_interaction` handler.
 * - `in`  — the twin/user RECEIVED the message.
 * - `out` — the twin/user SENT the message.
 */
export type TwinInteractionDirection = 'in' | 'out';

export const TWIN_INTERACTION_DIRECTIONS: readonly TwinInteractionDirection[] = [
  'in',
  'out',
] as const;

// ---------------------------------------------------------------------------
// Twin pending-memory status filter
// ---------------------------------------------------------------------------

/** Status filter for `twin_list_pending_memories`. `undefined` means "all". */
export type TwinPendingMemoryStatus = 'pending' | 'approved' | 'rejected';

export const TWIN_PENDING_MEMORY_STATUSES: readonly TwinPendingMemoryStatus[] = [
  'pending',
  'approved',
  'rejected',
] as const;
