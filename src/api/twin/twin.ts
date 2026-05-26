import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { TwinProfile } from "@/lib/bindings/TwinProfile";
import type { TwinTone } from "@/lib/bindings/TwinTone";
import type { TwinPendingMemory } from "@/lib/bindings/TwinPendingMemory";
import type { TwinCommunication } from "@/lib/bindings/TwinCommunication";
import type { TwinVoiceProfile } from "@/lib/bindings/TwinVoiceProfile";
import type { TwinChannel } from "@/lib/bindings/TwinChannel";
import type { TwinWikiCompileResult } from "@/lib/bindings/TwinWikiCompileResult";
import type { TwinWikiStatus } from "@/lib/bindings/TwinWikiStatus";
import type { TwinDistilledFact } from "@/lib/bindings/TwinDistilledFact";
import type { TwinContact } from "@/lib/bindings/TwinContact";
import type { TwinReflection } from "@/lib/bindings/TwinReflection";
import type { TwinRecallBundle } from "@/lib/bindings/TwinRecallBundle";
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

/**
 * Generate or refine a twin's bio. When `existingBio` is provided + non-empty
 * the backend switches to refinement mode: keep the original voice and facts,
 * just clean up the prose. Otherwise composes from scratch using `keywords`.
 */
export const generateBio = (
  name: string,
  role: string | null,
  keywords: string,
  existingBio?: string,
) =>
  invoke<string>("twin_generate_bio", { name, role, keywords, existingBio });

/**
 * Training Studio — draft an interview answer *as the twin*, grounded in the
 * twin's bio + generic tone + top distilled self-facts (the same material a
 * persona adopting the twin sees). `directions` carries the user's steering or
 * critique on a regenerate ("too formal, add the 2019 story"). Returns the
 * draft prose for the user to review/edit before it is saved as a memory.
 */
export const simulateAnswer = (
  twinId: string,
  question: string,
  directions?: string,
) =>
  invoke<string>("twin_simulate_answer", { twinId, question, directions });

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

export interface TwinIngestDocsSummary {
  filesIngested: number;
  chunksAdded: number;
  filesSkipped: number;
}

/**
 * Seed a Twin's bound knowledge base with the curated `docs/features/*`
 * pages embedded at compile time. Returns counts for the UI to surface.
 * Errors if the twin has no knowledge base bound or the binary was built
 * without the `ml` feature.
 */
export const ingestDoctrineDocs = (twinId: string) =>
  invoke<TwinIngestDocsSummary>("twin_ingest_doctrine_docs", { twinId });

/**
 * Compile the full twin's approved memories into a navigable markdown wiki.
 * `outputDir` is optional — when omitted, files land in the per-twin slot
 * under the app data dir (so the freshness pill in TwinSelector can find
 * them without any caller bookkeeping).
 */
export const compileWiki = (twinId: string, outputDir?: string) =>
  invoke<TwinWikiCompileResult>("twin_compile_wiki", { twinId, outputDir });

/**
 * AI-audit a compiled wiki for gaps and contradictions. Returns a pending
 * memory row (the audit report is stored as a high-priority memory so it
 * surfaces in the Knowledge inbox).
 */
export const auditWiki = (twinId: string, wikiDir?: string) =>
  invoke<TwinPendingMemory>("twin_audit_wiki", { twinId, wikiDir });

/**
 * Non-mutating freshness query — returns `{ exists, fileCount, lastCompiledAt,
 * dirPath }`. Drives the WikiFreshnessPill in TwinSelector. Cheap (one
 * `read_dir` over a small directory) so the hook can poll on twin change.
 */
export const wikiStatus = (twinId: string) =>
  invoke<TwinWikiStatus>("twin_wiki_status", { twinId });

// ============================================================================
// Distilled Facts (P6+ — manual write surface, Cycle 12 Stage 1)
// ============================================================================

export const listDistilledFacts = (twinId: string, contactHandle?: string) =>
  invoke<TwinDistilledFact[]>("twin_list_distilled_facts", { twinId, contactHandle });

/**
 * Record a curated fact about the twin or one of its contacts. Provenance
 * is mandatory — `sourceCommunicationIds` must reference at least one row
 * in `twin_communications`. The backend rejects empty arrays to keep the
 * provenance contract from breaking down.
 */
export const createDistilledFact = (
  twinId: string,
  sourceCommunicationIds: string[],
  content: string,
  contactHandle?: string,
  importance?: number,
) =>
  invoke<TwinDistilledFact>("twin_create_distilled_fact", {
    twinId,
    contactHandle,
    content,
    importance,
    sourceCommunicationIds,
  });

export const deleteDistilledFact = (id: string) =>
  invoke<boolean>("twin_delete_distilled_fact", { id });

// ============================================================================
// Contacts (Cycle 14 Stage 1)
// ============================================================================

/**
 * List the active twin's contacts with derived `messageCount` + `lastSeenAt`
 * for each. The backend auto-upserts new handles seen in twin_communications
 * before returning, so a freshly bridged contact appears on the very next
 * call without any explicit "sync" step.
 */
export const listTwinContacts = (twinId: string) =>
  invoke<TwinContact[]>("twin_list_contacts", { twinId });

export const updateTwinContact = (id: string, alias?: string, notes?: string) =>
  invoke<TwinContact>("twin_update_contact", { id, alias, notes });

// ============================================================================
// Reflections (Cycle 15 Stage 1)
// ============================================================================

export const listTwinReflections = (twinId: string) =>
  invoke<TwinReflection[]>("twin_list_reflections", { twinId });

/**
 * Generate a new reflection. Backend builds the prompt from the twin's
 * profile + last 40 communications + the operator's seed question, runs
 * it through the Claude CLI dispatcher, and persists the result. The
 * returned row is the canonical record — UI should append it to its
 * cached list rather than refetch.
 */
export const reflectOnTwin = (twinId: string, promptSeed: string) =>
  invoke<TwinReflection>("twin_reflect", { twinId, promptSeed });

export const deleteTwinReflection = (id: string) =>
  invoke<boolean>("twin_delete_reflection", { id });

// ============================================================================
// Recall preview (Cycle 16 Stage 1 — read-only)
// ============================================================================

/**
 * Structured slice of twin state a persona prompt-builder would need at
 * runtime. Returns { profile, tone, recent_communications, top_facts,
 * top_contacts, contact_filter }. Stage 1 is read-only — the Brain preview
 * panel calls this to show operators "here's what a persona adopting this
 * twin would see." Stage 2 will wire this bundle into the connector tool
 * that assembles the runtime prompt.
 */
export const twinRecall = (twinId: string, contactHandle?: string) =>
  invoke<TwinRecallBundle>("twin_recall", { twinId, contactHandle });
