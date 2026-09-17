use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Twin Profiles
//
// A "twin" represents a digital identity (the user's voice, tone, brain) that
// any persona can adopt via the `builtin-twin` connector. Multiple twins are
// supported (e.g. founder twin vs personal twin) and exactly one is "active"
// at a time -- channel-aware tone/voice/memory all resolve through the active
// twin's id when a persona calls a twin connector tool.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinProfile {
    pub id: String,
    /// Display name shown in the selector and UI ("Founder Twin").
    pub name: String,
    /// URL/filesystem-safe slug used as the Obsidian subfolder name.
    pub slug: String,
    /// Free-text bio used as identity prompt fragment when a persona adopts
    /// this twin.
    pub bio: Option<String>,
    /// Role/title -- "Founder", "Indie Dev", "Community Manager".
    pub role: Option<String>,
    /// JSON array of language codes the twin speaks (e.g. ["en", "cs"]).
    pub languages: Option<String>,
    pub pronouns: Option<String>,
    /// Path inside the configured Obsidian vault that holds this twin's
    /// brain (identity.md, tone/, memory/, knowledge/). Defaults to
    /// `personas/twins/<slug>` on creation but can be overridden later.
    pub obsidian_subpath: String,
    /// Marks this twin as the one personas resolve when the connector is
    /// invoked without an explicit twin override. Exactly one row should
    /// have this set to 1 at any given time.
    pub is_active: bool,
    /// FK to knowledge_bases.id in personas_data.db — the twin's RAG brain.
    /// Set via twin_bind_knowledge_base. Null until user creates/binds one.
    pub knowledge_base_id: Option<String>,
    /// Persistent "training style guide" (D5). Free-text directions the
    /// Training Studio applies to every question/answer generation for this
    /// twin (e.g. "questions: concrete scenarios; answers: dry, first-person").
    pub training_directives: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Twin Tone Profiles (P1)
//
// Each twin can have one tone profile per channel (discord, slack, email, sms,
// voice, generic). The `generic` channel is the default fallback when a
// persona doesn't specify a channel context. The connector tool
// `get_tone(channel)` resolves the matching row for the active twin.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinTone {
    pub id: String,
    pub twin_id: String,
    /// Channel this tone applies to. Well-known values: "generic", "discord",
    /// "slack", "email", "sms", "voice". The "generic" tone is the fallback.
    pub channel: String,
    /// Free-text system-prompt fragment describing how the twin speaks on this
    /// channel. Injected as-is into the persona's prompt when a twin tool is
    /// called.
    pub voice_directives: String,
    /// JSON array of example messages demonstrating the twin's voice on this
    /// channel (few-shot references).
    pub examples_json: Option<String>,
    /// JSON array of do/don't constraints (e.g. ["No emoji", "No corporate speak"]).
    pub constraints_json: Option<String>,
    /// Guidance on reply length: "1-3 sentences", "short paragraph", etc.
    pub length_hint: Option<String>,
    pub updated_at: String,
}

// ============================================================================
// Twin Pending Memories (P2)
//
// Human-approval inbox. When a persona calls `record_interaction`, a pending
// memory is created here. The user reviews and approves/rejects in the
// Knowledge tab. Approved items get ingested into the twin's knowledge base.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinPendingMemory {
    pub id: String,
    pub twin_id: String,
    /// Channel the interaction originated from (discord, email, etc.).
    pub channel: Option<String>,
    /// The memory content to be stored.
    pub content: String,
    /// Title/summary for the memory.
    pub title: Option<String>,
    /// Importance rating (1-5), set by the agent or user.
    pub importance: i32,
    /// pending | approved | rejected
    pub status: String,
    /// User notes explaining the approval/rejection.
    pub reviewer_notes: Option<String>,
    /// Source `twin_communications.id` when this memory was queued by
    /// `record_interaction`. NULL for memories that didn't originate from
    /// a single communication (URL ingest, wiki audit, etc.).
    pub source_communication_id: Option<String>,
    pub created_at: String,
    pub reviewed_at: Option<String>,
}

// ============================================================================
// Twin Communications (P2)
//
// Interaction log — records what the twin said and received across channels.
// Each entry is one message (in or out). The connector tool
// `record_interaction` writes here, and optionally creates a pending memory.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinCommunication {
    pub id: String,
    pub twin_id: String,
    /// Channel: discord, slack, email, sms, etc.
    pub channel: String,
    /// "in" (received) or "out" (sent by the twin).
    pub direction: String,
    /// Handle/name of the external contact.
    pub contact_handle: Option<String>,
    /// The message content.
    pub content: String,
    /// One-line summary (for knowledge indexing).
    pub summary: Option<String>,
    /// JSON array of key facts extracted from the message.
    pub key_facts_json: Option<String>,
    /// When the actual communication happened (may differ from created_at).
    pub occurred_at: String,
    pub created_at: String,
}

// ============================================================================
// Twin Voice Profiles (P3)
//
// Stores the voice configuration for a twin. One voice per twin. The
// credential_id points to an ElevenLabs credential in the vault; the
// voice_id is the ElevenLabs voice identifier. P3 is picker-only — the
// user pastes the voice_id from the ElevenLabs dashboard. Live voice
// listing + cloning is deferred.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinVoiceProfile {
    pub id: String,
    pub twin_id: String,
    /// Voice provider: "elevenlabs" (only option for now).
    pub provider: String,
    /// FK to the credential vault — the ElevenLabs API key credential.
    pub credential_id: Option<String>,
    /// The provider-specific voice identifier (e.g. ElevenLabs voice ID).
    pub voice_id: String,
    /// ElevenLabs model ID (e.g. "eleven_multilingual_v2").
    pub model_id: Option<String>,
    /// Stability slider 0.0–1.0 (higher = more consistent, lower = more expressive).
    pub stability: f64,
    /// Similarity boost 0.0–1.0 (higher = closer to original voice).
    pub similarity_boost: f64,
    /// Style exaggeration 0.0–1.0.
    pub style: f64,
    pub updated_at: String,
}

// ============================================================================
// Twin Reflections (P6+ — Cycle 15 Stage 1)
//
// Operator-audit journals. Each row is a Claude-generated prose summary of
// the twin's recent communications, seeded by an operator prompt
// ("What's been moving in this twin's voice lately?"). Stored append-only;
// the user can delete individual rows but never edit them — the audit value
// is precisely that they're frozen at write time.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinReflection {
    pub id: String,
    pub twin_id: String,
    /// Operator-supplied prompt that drove the reflection. Kept verbatim so
    /// future reads understand what question this answer was responding to.
    pub prompt_seed: String,
    /// The Claude output — markdown-friendly prose.
    pub content: String,
    pub created_at: String,
}

// ============================================================================
// Twin Contacts (P6+ — Cycle 14 Stage 1)
//
// Durable per-twin record of every external handle the twin has interacted
// with. Auto-populated from twin_communications during list calls + manually
// editable alias/notes. The list-with-activity query LEFT JOINs against
// twin_communications to produce the view rows the UI consumes.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinContact {
    pub id: String,
    pub twin_id: String,
    /// External handle as it appeared in `twin_communications.contact_handle`.
    pub handle: String,
    /// User-supplied display name. UI prefers this over `handle` when set.
    pub alias: Option<String>,
    /// Free-text operator notes about this relationship.
    pub notes: Option<String>,
    /// Number of communications scoped to (twin_id, handle). Populated by
    /// the list-with-activity query; 0 for manually-added contacts that
    /// haven't been bridged yet.
    pub message_count: i64,
    /// Latest `occurred_at` from `twin_communications` for this contact;
    /// `None` when message_count == 0.
    pub last_seen_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Twin Distilled Facts (P6+)
//
// Curated, deduplicated facts about the twin or its contacts. Distillation
// turns raw `twin_communications` + approved `twin_pending_memories` into
// a smaller set of high-signal facts with provenance — each fact cites the
// source `communication` ids that produced it. Future stages will add an
// AI consolidation pass + vector dedup; cycle 12 ships the schema + manual
// write surface so the rest of the stack has a table to target.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinDistilledFact {
    pub id: String,
    pub twin_id: String,
    /// Optional scope — typically a contact handle when the fact is about a
    /// specific relationship ("alice@discord"), or NULL for self-facts.
    pub contact_handle: Option<String>,
    /// The distilled fact in natural language ("Alice prefers DMs after 9pm").
    pub content: String,
    /// Importance rating (1–5). Drives retrieval ordering once recall lands.
    pub importance: i32,
    /// JSON array of source `twin_communications.id` values — the provenance
    /// trail. Empty arrays are rejected at the repo write boundary so a fact
    /// can never enter the table without a citation.
    pub sources_json: String,
    pub created_at: String,
    /// Touched whenever this fact participates in a recall pass — drives the
    /// future importance-decay job.
    pub last_seen_at: String,
}

// ============================================================================
// Twin Channels (P4)
//
// Maps a twin to its deployment channels — which channel (discord, slack,
// email, etc.), which credential is used, and optionally which persona is
// the operator. This is the "where the twin speaks" cockpit. A twin can
// have multiple channels; each channel has at most one persona assigned.
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinChannel {
    pub id: String,
    pub twin_id: String,
    /// Channel type: discord, slack, email, sms, telegram, etc.
    pub channel_type: String,
    /// FK to the credential vault — e.g. the Discord bot token credential.
    pub credential_id: String,
    /// Optional FK to the persona that operates on this channel.
    pub persona_id: Option<String>,
    /// Human-readable label (e.g. "My Discord Server", "Work Slack").
    pub label: Option<String>,
    pub is_active: bool,
    pub created_at: String,
    pub updated_at: String,
}

// ============================================================================
// Guided Setup (twin-atelier-v2 WP1)
//
// The Setup module's wire contract. Its hand-written TypeScript mirror is
// `src/features/plugins/twin/setup/setupContract.ts`, and THAT file is the
// authority these structs match field for field — the four Setup variant
// renderers compile against it while this engine is built in parallel.
//
// The governing rule the shapes encode: the generator proposes CONTENT, the
// flow owns STRUCTURE. `done_hint` is advisory and is never the completion
// authority (readiness is, client-side), and a proposal is a typed OFFER that
// nothing writes until a human accepts it.
// ============================================================================

/// One transcript line handed back to the generator so the next question
/// continues a conversation rather than restarting one.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupTurnMessage {
    /// `"guide"` (the question) or `"user"` (the answer).
    #[ts(type = "\"guide\" | \"user\"")]
    pub role: String,
    pub text: String,
}

/// One offered answer. A suggestion is a position the user can adopt, edit or
/// ignore — never a silent default, which is why it carries its reason.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupSuggestion {
    pub text: String,
    /// One line saying why this answer is being offered.
    pub reason: String,
}

/// A typed value the guide proposes for a real field. Nothing here is written
/// until the user accepts it, and an accepted value stays editable.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupProposal {
    /// Stable per-turn id, assigned by the backend when the turn is parsed —
    /// never by the model. Two tone proposals for the same channel are two
    /// different offers, so the channel cannot serve as the key.
    #[serde(default)]
    pub id: String,
    #[ts(type = "\"bio\" | \"role\" | \"tone\"")]
    pub kind: String,
    /// Tone channel id for `kind == "tone"`; `None` otherwise.
    pub channel: Option<String>,
    pub value: String,
    /// Reply-length guidance, only meaningful for a tone proposal.
    pub length_hint: Option<String>,
    pub reason: String,
}

/// One turn of the guided setup conversation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct SetupTurnResult {
    pub question: String,
    /// Which slot this question is working on.
    #[ts(type = "\"identity\" | \"tone\" | \"channels\" | \"memories\"")]
    pub focus: String,
    /// Tone channel the question is about when `focus == "tone"`.
    pub tone_channel: Option<String>,
    pub suggestions: Vec<SetupSuggestion>,
    pub proposals: Vec<SetupProposal>,
    /// ADVISORY ONLY. The model's guess that this slot now has enough. The
    /// client derives completion from readiness and must not promote this to
    /// a completion signal — a generator that cannot count words cannot be
    /// the authority on whether a bio is written.
    pub done_hint: bool,
}

// ---------------------------------------------------------------------------
// Browser page drafting (spark twin-browser-reply, WP0 wire contract)
// ---------------------------------------------------------------------------

/// What the page reported about the input the user clicked in the Browser
/// webview, gathered by `hands.js`'s `page_pick` AT CLICK TIME so the ref is
/// fresh by construction. Every text field is capped inside the page and the
/// capped ones are named in `truncated` — a cut is visible, never silent.
///
/// The `ref` is the page-minted `ref_<generation>_<hex>`; it dies with the
/// page's ref generation (any navigation) like every other ref.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PickedTarget {
    #[serde(rename = "ref")]
    #[ts(rename = "ref")]
    pub r#ref: String,
    /// aria-label / `<label for>` / placeholder / name — first non-empty.
    pub label: String,
    /// The field's current value (or textContent for contenteditable).
    pub existing_text: String,
    /// Visible text of the closest form's submit control, if any.
    pub form_hint: Option<String>,
    /// Nearest preceding block-level text — the comment the box sits under.
    pub preceding_text: String,
    /// The primary landmark's text (article / main / role=main), else the
    /// bounded body text.
    pub main_text: String,
    /// `window.getSelection()` at click time.
    pub selection_text: String,
    /// Up to a few preceding comment-like sibling blocks, oldest first.
    pub thread: Vec<String>,
    pub title: String,
    pub url: String,
    /// Names of the fields a cap was applied to.
    pub truncated: Vec<String>,
}

/// The page context the twin drafts against: [`PickedTarget`] minus the ref.
/// The twin never sees a ref — it writes prose, the frontend acts on the page.
/// Every string here is UNTRUSTED page text and is fenced before it reaches a
/// prompt (prompt-safety / untrusted-span-fencing).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinPageContext {
    pub label: String,
    pub existing_text: String,
    pub form_hint: Option<String>,
    pub preceding_text: String,
    pub main_text: String,
    pub selection_text: String,
    pub thread: Vec<String>,
    pub title: String,
    pub url: String,
    pub truncated: Vec<String>,
}

/// One-tap steer, the four Reply Outbox chips.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
pub enum TwinSteer {
    Shorter,
    Warmer,
    Formal,
    Question,
}

/// A drafted page comment, with the provenance the Reply Outbox never had.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinPageDraft {
    /// The comment text, trimmed, ready to be put into the field.
    pub draft: String,
    /// Which tone register grounded it: `browser`, or `generic` on fallback.
    pub tone_channel: String,
    /// Whether a bound knowledge base contributed (always false in lite builds).
    pub kb_grounded: bool,
}
