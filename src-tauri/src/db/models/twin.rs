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
