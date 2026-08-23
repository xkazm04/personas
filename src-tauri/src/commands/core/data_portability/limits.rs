//! Size caps and portability constants shared by both directions.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// Additional constants specific to data_portability (not shared with import_export)
pub(crate) const MAX_CANVAS_DATA_LEN: usize = 500_000;
pub(crate) const MAX_SCHEMA_LEN: usize = 100_000;
pub(crate) const MAX_SCENARIOS_LEN: usize = 500_000;

/// Hard ceiling on the size of a `.enc` credential bundle accepted by
/// `import_credentials`. Mirrors the persona-import guard in
/// `import_export::MAX_IMPORT_FILE_BYTES` but tightened: a credential
/// bundle is JSON envelope + base64-encoded ciphertext, and even a
/// vault with hundreds of secrets stays well under 1 MB. Anything
/// larger is either corruption, accidental file selection (logs, DB
/// dump), or a hostile blob aimed at OOMing the read_to_string path
/// before AES decryption runs.
pub(crate) const MAX_CREDENTIAL_IMPORT_BYTES: u64 = 2 * 1024 * 1024;

// Array size caps specific to data_portability
pub(crate) const MAX_PERSONAS: usize = 200;
pub(crate) const MAX_TOOLS: usize = 500;
pub(crate) const MAX_TEAMS: usize = 50;
pub(crate) const MAX_CREDENTIALS: usize = 500;
pub(crate) const MAX_TRIGGERS_PER_PERSONA: usize = MAX_TRIGGERS;
pub(crate) const MAX_SUBSCRIPTIONS_PER_PERSONA: usize = MAX_SUBSCRIPTIONS;
pub(crate) const MAX_MEMORIES_PER_PERSONA: usize = MAX_MEMORIES;
pub(crate) const MAX_TEST_SUITES_PER_PERSONA: usize = 100;
pub(crate) const MAX_TEAM_MEMBERS: usize = 50;
pub(crate) const MAX_TEAM_CONNECTIONS: usize = 200;
pub(crate) const MAX_TEAM_MEMORIES_PER_TEAM: usize = 500;
pub(crate) const MAX_KPIS: usize = 200;
pub(crate) const MAX_KPI_MEASUREMENTS: usize = 100;
pub(crate) const MAX_DEV_PROJECTS: usize = 25;
pub(crate) const MAX_KNOWLEDGE_ENTRIES: usize = 2000;

// Twin plugin caps. A twin's history is the bulkiest thing in a bundle (a
// year of chat traffic is tens of thousands of rows), so every one of these
// truncates with an explicit warning rather than silently — see
// `push_truncation_warning`.
pub(crate) const MAX_TWINS: usize = 10;
pub(crate) const MAX_TWIN_COMMUNICATIONS: usize = 5000;
pub(crate) const MAX_TWIN_MEMORIES: usize = 5000;
pub(crate) const MAX_TWIN_FACTS: usize = 2000;
pub(crate) const MAX_TWIN_CONTACTS: usize = 1000;
pub(crate) const MAX_TWIN_REFLECTIONS: usize = 500;
pub(crate) const MAX_TWIN_TONES: usize = 50;
pub(crate) const MAX_TWIN_CHANNELS: usize = 50;
/// Text-tier knowledge-base caps. Vectors NEVER travel — the target rebuilds
/// them with its own embedding model via `kb_reindex`.
pub(crate) const MAX_KB_DOCUMENTS: usize = 500;
pub(crate) const MAX_KB_CHUNKS: usize = 10_000;

// Athena (companion brain) caps. There is exactly one Athena per install, so
// unlike the twin caps these are absolute ceilings rather than per-entity ones.
// Every one of them truncates through `push_truncation_warning`.
pub(crate) const MAX_ATHENA_FACTS: usize = 2000;
pub(crate) const MAX_ATHENA_PROCEDURALS: usize = 1000;
pub(crate) const MAX_ATHENA_GOALS: usize = 500;
pub(crate) const MAX_ATHENA_BACKLOG: usize = 500;
pub(crate) const MAX_ATHENA_RITUALS: usize = 200;
pub(crate) const MAX_ATHENA_DECISIONS: usize = 2000;
/// Conversation-roster cap. The roster is titles and flags only — no
/// transcripts, no `claude_session_id` — so the rows are tiny, but an
/// unbounded list is still an unbounded list.
pub(crate) const MAX_ATHENA_SESSIONS: usize = 500;
/// Ceiling on ONE memory's markdown body. A fact or ritual note past a quarter
/// of a megabyte is a pasted log, not a memory; it is dropped by name rather
/// than truncated mid-sentence, because half a memory is worse than none.
pub(crate) const MAX_ATHENA_MD_FILE_BYTES: usize = 256 * 1024;
/// Ceiling on `identity.md`. Same reasoning; this one file is the single most
/// load-bearing document in the brain, so an oversize one is reported loudly.
pub(crate) const MAX_IDENTITY_BYTES: usize = 256 * 1024;

/// The node kinds that make up the `learned` tier. Deliberately does NOT
/// include `doctrine` (regenerated from `include_str!` on every boot),
/// `episode` (raw transcript), `reflection`, `cockpit` or `dashboard`.
pub(crate) const ATHENA_LEARNED_KINDS: [&str; 5] =
    ["fact", "procedural", "goal", "backlog", "ritual"];

/// The three `app_settings` keys that describe how the operator wants Athena to
/// behave, as opposed to what this machine happens to be doing. This list is a
/// SECURITY BOUNDARY, not a convenience: the import writes settings straight
/// into `app_settings`, so anything not named here must never be accepted from
/// a bundle. Enforced twice — in `validate_athena` and again at write time.
pub(crate) const ATHENA_PORTABLE_PREF_KEYS: [&str; 3] = [
    "companion_autonomous_mode",
    "companion_fleet_boldness",
    "companion_profile_synthesis",
];

// ----------------------------------------------------------------------------
// What Athena's section deliberately does NOT carry.
//
// Named here so the exclusion is a declared contract rather than an emergent
// property of which SELECTs happen to exist, and asserted by
// `athena_bundle_excludes_every_forbidden_name`. Four reasons, in order of how
// much they matter:
//
//  1. REGENERATED ON THE TARGET. Doctrine (~349 of 362 nodes) is rebuilt from
//     `include_str!` at boot, and `prune_orphans` deletes any doctrine node
//     outside the current allowlist — so imported doctrine would be deleted
//     anyway. `constitution.md` is a shipped template.
//  2. MACHINE-LOCAL. `claude_session_id` is a `--resume` pointer into a CLI
//     process that does not exist on the target; `companion_known_project`
//     holds absolute paths; `companion_embedding` holds vectors from this
//     machine's embedding model.
//  3. NOT MEMORY. Telemetry, budgets, live scratch queues, wake logs — state
//     about a running installation, meaningless once moved.
//  4. RAW TRANSCRIPT. Episodes and `companion_turn_sidecar` are the
//     conversation itself. What Athena LEARNED from a conversation travels;
//     the conversation does not.
// ----------------------------------------------------------------------------

/// Table and column names that must never appear as a field name anywhere in
/// the Athena section.
#[cfg(test)]
pub(crate) const ATHENA_FORBIDDEN_NAMES: [&str; 23] = [
    // 2 — machine-local
    "claude_session_id",
    "companion_known_project",
    "companion_embedding",
    "companion_edge",
    "athena_audit",
    // 3 — telemetry + live scratch
    "companion_turn",
    "companion_turn_sidecar",
    "companion_ux_signal",
    "companion_persona_baseline",
    "companion_proactive_budget",
    "companion_attention_budget",
    "athena_wake_log",
    "companion_approval",
    "companion_proactive_message",
    "companion_dev_op",
    "companion_dev_feedback",
    "companion_background_job",
    "companion_night_plan",
    "companion_night_event",
    "companion_daily_goal",
    "companion_active_connector",
    "companion_plugin_toggle",
    "companion_fts",
];

/// Node kinds and on-disk files that must never appear as a `kind` or
/// `file_path` value anywhere in the Athena section.
#[cfg(test)]
pub(crate) const ATHENA_FORBIDDEN_CONTENT: [&str; 8] = [
    "doctrine",
    "episode",
    "reflection",
    "cockpit",
    "dashboard",
    "constitution",
    "episodes-archive-",
    "identity.bak-",
];

/// Hard ceiling on a single exported skill file. Skills are markdown +
/// small reference files; anything bigger is a binary asset or generated
/// artifact that has no business travelling in a portability bundle.
pub(crate) const MAX_SKILL_FILE_BYTES: u64 = 256 * 1024;

/// Provenance sidecar written by skill installs — local sync bookkeeping,
/// never exported. Mirrors `PROVENANCE_FILE` in
/// `commands::infrastructure::skill_files` (private there).
pub(crate) const SKILL_PROVENANCE_FILE: &str = ".personas-skill-meta.json";
