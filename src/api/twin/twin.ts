import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TwinProfile } from "@/lib/bindings/TwinProfile";
import type { TwinTone } from "@/lib/bindings/TwinTone";
import type { TwinPendingMemory } from "@/lib/bindings/TwinPendingMemory";
import type { TwinCommunication } from "@/lib/bindings/TwinCommunication";
import type { TwinVoiceProfile } from "@/lib/bindings/TwinVoiceProfile";
import type { TwinChannel } from "@/lib/bindings/TwinChannel";
import type {
  TwinChannelKind,
  TwinInteractionDirection,
  TwinPendingMemoryStatus,
} from "@/api/enums";

export type {
  TwinChannelKind,
  TwinInteractionDirection,
  TwinPendingMemoryStatus,
} from "@/api/enums";

// ============================================================================
// Twin Profiles (P0)
//
// Frontend wrappers around the `twin_*` IPC commands. Mirrors the dev-tools
// API style: thin invoke wrappers, no business logic. Argument names match
// the Rust handler signatures (rusqlite/serde performs camelCase <-> snake
// conversion via Tauri's default deserializer).
// ============================================================================

export type { TwinProfile } from "@/lib/bindings/TwinProfile";
export type { TwinTone } from "@/lib/bindings/TwinTone";
export type { TwinPendingMemory } from "@/lib/bindings/TwinPendingMemory";
export type { TwinCommunication } from "@/lib/bindings/TwinCommunication";
export type { TwinVoiceProfile } from "@/lib/bindings/TwinVoiceProfile";
export type { TwinChannel } from "@/lib/bindings/TwinChannel";

export const listProfiles = () =>
  invoke<TwinProfile[]>("twin_list_profiles");

export const getProfile = (id: string) =>
  invoke<TwinProfile>("twin_get_profile", { id });

/**
 * Resolve the active twin. With `personaId`, returns the persona's
 * pinned twin (from `design_context.twin_id`) if set and still exists;
 * otherwise falls back to the globally-active twin. Without
 * `personaId`, returns the globally-active twin.
 */
export const getActiveProfile = (personaId?: string) =>
  invoke<TwinProfile | null>("twin_get_active_profile", { personaId });

export const createProfile = (
  name: string,
  bio?: string,
  role?: string,
  languages?: string,
  pronouns?: string,
) =>
  invoke<TwinProfile>("twin_create_profile", {
    name,
    bio,
    role,
    languages,
    pronouns,
  });

export const updateProfile = (
  id: string,
  updates: {
    name?: string;
    bio?: string | null;
    role?: string | null;
    languages?: string | null;
    pronouns?: string | null;
    obsidianSubpath?: string;
  },
) =>
  invoke<TwinProfile>("twin_update_profile", {
    id,
    name: updates.name,
    bio: updates.bio,
    role: updates.role,
    languages: updates.languages,
    pronouns: updates.pronouns,
    obsidianSubpath: updates.obsidianSubpath,
  });

export const deleteProfile = (id: string) =>
  invoke<boolean>("twin_delete_profile", { id });

export const setActiveProfile = (id: string) =>
  invoke<TwinProfile>("twin_set_active_profile", { id });

// ============================================================================
// Tone Profiles (P1)
// ============================================================================

export const listTones = (twinId: string) =>
  invoke<TwinTone[]>("twin_list_tones", { twinId });

export const getTone = (twinId: string, channel: TwinChannelKind) =>
  invoke<TwinTone>("twin_get_tone", { twinId, channel });

export const upsertTone = (
  twinId: string,
  channel: TwinChannelKind,
  voiceDirectives: string,
  examplesJson?: string | null,
  constraintsJson?: string | null,
  lengthHint?: string | null,
) =>
  invoke<TwinTone>("twin_upsert_tone", {
    twinId,
    channel,
    voiceDirectives,
    examplesJson,
    constraintsJson,
    lengthHint,
  });

export const deleteTone = (id: string) =>
  invoke<boolean>("twin_delete_tone", { id });

// ============================================================================
// Knowledge Base Binding (P2)
// ============================================================================

export const bindKnowledgeBase = (twinId: string, kbId: string) =>
  invoke<TwinProfile>("twin_bind_knowledge_base", { twinId, kbId });

export const unbindKnowledgeBase = (twinId: string) =>
  invoke<TwinProfile>("twin_unbind_knowledge_base", { twinId });

// ============================================================================
// Pending Memories (P2)
// ============================================================================

export const listPendingMemories = (twinId: string, status?: TwinPendingMemoryStatus) =>
  invoke<TwinPendingMemory[]>("twin_list_pending_memories", { twinId, status });

export const reviewMemory = (id: string, approved: boolean, reviewerNotes?: string) =>
  invoke<TwinPendingMemory>("twin_review_memory", { id, approved, reviewerNotes });

// ============================================================================
// Communications (P2)
// ============================================================================

export const listCommunications = (twinId: string, channel?: TwinChannelKind, limit?: number) =>
  invoke<TwinCommunication[]>("twin_list_communications", { twinId, channel, limit });

/** Frontend trust-boundary cap for keyFactsJson. The Rust handler stores this
 *  blob alongside the communication row; without a cap, an LLM-generated key-
 *  facts payload could overflow the IPC frame, OOM the SQLite write, or get
 *  silently truncated by the engine. 64 KB is generous for structured fact
 *  lists and small enough that misuse fails fast at the wrapper. */
const TWIN_KEY_FACTS_JSON_MAX_BYTES = 64 * 1024;

function validateKeyFactsJson(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new Error("twin: keyFactsJson must be a JSON string");
  }
  // UTF-8 byte-length cap. JS .length undercounts non-BMP characters; the
  // backend cares about bytes (SQLite TEXT column / IPC frame), so use the
  // encoder's true byte count.
  const byteLen = new TextEncoder().encode(value).length;
  if (byteLen > TWIN_KEY_FACTS_JSON_MAX_BYTES) {
    throw new Error(
      `twin: keyFactsJson exceeds ${TWIN_KEY_FACTS_JSON_MAX_BYTES} bytes (got ${byteLen})`,
    );
  }
  // JSON parse roundtrip. We don't validate the shape — that's the backend's
  // job — but rejecting unparseable JSON here prevents a silent truncate /
  // store-and-fail-later when the persona tool emits a malformed payload.
  try {
    JSON.parse(value);
  } catch (e) {
    throw new Error(
      `twin: keyFactsJson is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
      { cause: e },
    );
  }
  return value;
}

export const recordInteraction = (
  twinId: string,
  channel: TwinChannelKind,
  direction: TwinInteractionDirection,
  content: string,
  contactHandle?: string,
  summary?: string,
  keyFactsJson?: string,
  createMemory?: boolean,
) =>
  invoke<TwinCommunication>("twin_record_interaction", {
    twinId,
    channel,
    direction,
    contactHandle,
    content,
    summary,
    keyFactsJson: validateKeyFactsJson(keyFactsJson),
    createMemory,
  });

// ============================================================================
// Voice Profiles (P3)
// ============================================================================

export const getVoiceProfile = (twinId: string) =>
  invoke<TwinVoiceProfile | null>("twin_get_voice_profile", { twinId });

export const upsertVoiceProfile = (
  twinId: string,
  voiceId: string,
  credentialId?: string | null,
  modelId?: string | null,
  stability?: number,
  similarityBoost?: number,
  style?: number,
) =>
  invoke<TwinVoiceProfile>("twin_upsert_voice_profile", {
    twinId,
    credentialId,
    voiceId,
    modelId,
    stability,
    similarityBoost,
    style,
  });

export const deleteVoiceProfile = (twinId: string) =>
  invoke<boolean>("twin_delete_voice_profile", { twinId });

// ============================================================================
// Channels (P4)
// ============================================================================

export const listChannels = (twinId: string) =>
  invoke<TwinChannel[]>("twin_list_channels", { twinId });

export const createChannel = (
  twinId: string,
  channelType: TwinChannelKind,
  credentialId: string,
  personaId?: string,
  label?: string,
) =>
  invoke<TwinChannel>("twin_create_channel", {
    twinId,
    channelType,
    credentialId,
    personaId,
    label,
  });

export const updateChannel = (
  id: string,
  updates: {
    personaId?: string | null;
    label?: string | null;
    isActive?: boolean;
  },
) =>
  invoke<TwinChannel>("twin_update_channel", {
    id,
    personaId: updates.personaId,
    label: updates.label,
    isActive: updates.isActive,
  });

export const deleteChannel = (id: string) =>
  invoke<boolean>("twin_delete_channel", { id });

export const generateBio = (name: string, role: string | null, keywords: string) =>
  invoke<string>("twin_generate_bio", { name, role, keywords });

// ============================================================================
// Wiki commands (Direction 4 — currently surfaced via the Knowledge tab)
// ============================================================================

/**
 * Scrape a URL and queue extracted facts as pending memories. Returns a
 * short summary string the caller can show to the user before the memory
 * indexing pass runs.
 */
export const ingestUrl = (url: string, twinId?: string) =>
  invoke<string>("twin_ingest_url", { url, twinId });

/**
 * Compile the full twin (identity, tone, memories, voice, channels) as a
 * cross-linked markdown wiki.
 */
export const compileWiki = (twinId: string) =>
  invoke<string>("twin_compile_wiki", { twinId });

/**
 * AI-audit a compiled wiki for gaps and contradictions. Returns the audit
 * report as markdown.
 */
export const auditWiki = (twinId: string) =>
  invoke<string>("twin_audit_wiki", { twinId });
