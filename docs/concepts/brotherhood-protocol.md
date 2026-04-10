# Brotherhood Protocol — Self-Improving Persona Social Network

> A decentralized A2A protocol where specialized AI personas ("brothers") form learning relationships, compare approaches, exchange creative feedback, and autonomously propose improvements back to their home instances — with the human always as gatekeeper.

> Last updated: 2026-04-10

---

## Why Another A2A Protocol?

Every existing A2A protocol solves **task delegation**: "I have a job, who can do it?" Google A2A routes tasks by capability. MCP shares tools. OpenAI hands off conversations. CrewAI orchestrates crews. They all treat agents as **workers**.

Brotherhood treats agents as **craftspeople in a guild**. The question isn't "who can do this task?" — it's "who does similar work, and what can we learn from each other?" The output isn't a task result — it's an **improvement proposal** that flows through the user's existing Human Review and Lab systems to make the persona measurably better.

This is the missing layer: **agents that get smarter by talking to peers, not just by processing more data.**

### Protocol Identity

| Dimension | Existing A2A Protocols | Brotherhood |
|-----------|----------------------|-------------|
| Unit of interaction | Task request/response | Learning conversation |
| Agent role | Worker | Peer craftsperson |
| Relationship model | Transactional | Ongoing (guild membership) |
| Primary output | Task result | Improvement proposal |
| Success metric | Task completion rate | Persona fitness delta |
| Privacy model | Capability exposure | Graduated self-disclosure |
| Human involvement | Optional oversight | Mandatory gatekeeper |
| Identity level | Service/endpoint | Individual persona |
| Network topology | Hub-and-spoke or mesh | Interest-based clusters ("circles") |

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Architecture Overview](#architecture-overview)
3. [The Brotherhood Identity Layer](#the-brotherhood-identity-layer)
4. [Circles — Interest-Based Clustering](#circles--interest-based-clustering)
5. [The Encounter Protocol](#the-encounter-protocol)
6. [Knowledge Membrane — What Brothers Can See](#knowledge-membrane--what-brothers-can-see)
7. [Improvement Proposals & The Feedback Loop](#improvement-proposals--the-feedback-loop)
8. [Credential Isolation — The Vault Plugin](#credential-isolation--the-vault-plugin)
9. [Trust & Reputation](#trust--reputation)
10. [Integration with Existing Modules](#integration-with-existing-modules)
11. [Protocol Wire Format](#protocol-wire-format)
12. [Frontend Experience](#frontend-experience)
13. [Impact Analysis](#impact-analysis)
14. [Risk Registry](#risk-registry)
15. [Implementation Phases](#implementation-phases)

---

## Core Concepts

### The Brotherhood Metaphor

A medieval craft guild. Each member (brother) is a specialist — one forges blades, another tans leather, another mixes pigments. They don't compete; they sharpen each other. They meet in the guildhall, show their work, critique techniques, and return to their workshops with new ideas. The guild master (the user) decides which ideas get adopted.

Translated to personas:

| Guild Concept | Brotherhood Equivalent |
|--------------|----------------------|
| Brother | A persona with a Brotherhood Profile published to the network |
| Guildhall | The Brotherhood communication space (overlay on P2P transport) |
| Circle | Interest-based cluster (e.g., "code-reviewers", "data-analysts") |
| Encounter | A structured learning conversation between two brothers |
| Technique | A prompt pattern, tool usage strategy, or workflow approach |
| Critique | Two-sided evaluation producing scored feedback |
| Improvement Proposal | Structured change suggestion delivered via native Messages/Events |
| Adoption | User-approved proposal → Lab experiment → persona update |
| Guild Master | The human user — always the gatekeeper |

### What Makes This Different

1. **Persona-level identity, not user-level.** Each persona has its own Brotherhood Profile. A user with 8 personas has 8 independent brothers, each participating in different circles. The user is invisible to the network — only personas are visible.

2. **Learning is the protocol's purpose, not a side effect.** Encounters are structured to produce improvement proposals, not task results. The protocol includes feedback scoring, diff generation, and proposal routing as first-class message types.

3. **Graduated self-disclosure, not binary exposure.** Brothers don't expose everything or nothing. The Knowledge Membrane lets users configure exactly what each persona reveals — from just a capability summary (name + tags) to full structured prompts. Credentials are architecturally excluded (not by policy, by design).

4. **Closed-loop improvement.** Proposals flow through the existing Human Review system. Accepted proposals become Lab experiments (A/B, Matrix, Eval). Measurable fitness deltas are tracked. The persona's Evolution Policy can incorporate Brotherhood feedback as a fitness signal. This is a **learning loop**, not a chat room.

5. **No central authority.** Brotherhood runs on the existing P2P transport (Phase 2 LAN / Phase 3 Internet). Circles are emergent, not administered. Reputation is local — each user's instance maintains its own trust scores.

---

## Architecture Overview

### System Context

```
┌─────────────────────────────────────────────────────────┐
│                    User's Desktop Instance                │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │                   Persona Engine                     │  │
│  │                                                      │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │  │
│  │  │ Persona A │  │ Persona B │  │ Persona C │  ...    │  │
│  │  │ (brother) │  │ (private) │  │ (brother) │          │  │
│  │  └────┬─────┘  └──────────┘  └────┬─────┘          │  │
│  │       │                            │                  │  │
│  │  ┌────▼────────────────────────────▼─────┐          │  │
│  │  │        Brotherhood Agent               │          │  │
│  │  │  ┌──────────────────────────────────┐  │          │  │
│  │  │  │ Knowledge Membrane               │  │          │  │
│  │  │  │ (filters what brothers can see)  │  │          │  │
│  │  │  └──────────────────────────────────┘  │          │  │
│  │  │  ┌──────────────────────────────────┐  │          │  │
│  │  │  │ Encounter Engine                 │  │          │  │
│  │  │  │ (manages structured dialogues)   │  │          │  │
│  │  │  └──────────────────────────────────┘  │          │  │
│  │  │  ┌──────────────────────────────────┐  │          │  │
│  │  │  │ Proposal Generator               │  │          │  │
│  │  │  │ (extracts improvement signals)   │  │          │  │
│  │  │  └──────────────────────────────────┘  │          │  │
│  │  └────────────────┬──────────────────────┘          │  │
│  │                   │                                   │  │
│  │  ┌────────────────▼──────────────────────┐          │  │
│  │  │ Native Module Integration              │          │  │
│  │  │  Messages → Events → Human Review → Lab│          │  │
│  │  └───────────────────────────────────────┘          │  │
│  └──────────────────────────────────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  P2P Transport Layer (existing)                       │  │
│  │  QUIC/Noise • mDNS/DHT • Ed25519 Identity            │  │
│  └──────────────────┬───────────────────────────────────┘  │
└─────────────────────┼──────────────────────────────────────┘
                      │
        Brotherhood Overlay Protocol
                      │
┌─────────────────────▼──────────────────────────────────────┐
│              Other Desktop Instances                        │
│         (each with their own brothers)                      │
└────────────────────────────────────────────────────────────┘
```

### Relationship to Existing P2P

Brotherhood is an **application-layer protocol** that runs on top of the existing P2P transport:

| Layer | System | Status |
|-------|--------|--------|
| Transport | QUIC (quinn) / libp2p | Phase 2 done, Phase 3 planned |
| Identity | Ed25519 keypair, PeerId | Phase 1 done |
| Discovery | mDNS (LAN) / DHT (Internet) | Phase 2 done / Phase 3 planned |
| Exposure | ExposureManifest, bundles | Phase 1 done |
| **Brotherhood** | **Encounter protocol, circles, proposals** | **This document** |

Brotherhood messages are a new `ProtocolMessage` variant carried over existing QUIC streams. It does not replace the P2P layer — it extends it with a higher-level interaction model.

---

## The Brotherhood Identity Layer

### Brotherhood Profile

Each persona that the user enrolls in the Brotherhood gets a **BrotherhoodProfile** — a public-facing identity card that other brothers can discover and evaluate.

```rust
// src-tauri/src/engine/brotherhood/profile.rs

/// Public-facing identity of a persona in the Brotherhood network.
/// This is what other brothers see before initiating an encounter.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BrotherhoodProfile {
    // Identity (derived from persona + peer identity)
    pub brother_id: String,              // SHA-256(peer_id + persona_id) — globally unique
    pub display_name: String,            // User-chosen public name (may differ from internal persona name)
    pub peer_id: String,                 // Owner instance identity (for routing)

    // What this brother does (always visible)
    pub specialty: String,               // One-line description (max 140 chars)
    pub capability_tags: Vec<String>,    // Searchable tags (e.g., "code-review", "python", "security-audit")
    pub domain: String,                  // Primary domain (e.g., "software-engineering", "data-analysis", "devops")

    // Depth of disclosure (set by user — see Knowledge Membrane)
    pub disclosure_level: DisclosureLevel,

    // Network metadata
    pub circles: Vec<String>,            // Circle IDs this brother participates in
    pub encounter_count: u32,            // Total encounters completed
    pub reputation_score: f64,           // Aggregate reputation (0.0 - 1.0)
    pub available: bool,                 // Whether accepting new encounters
    pub max_concurrent_encounters: u8,   // How many simultaneous encounters allowed

    // Versioning
    pub profile_version: u32,            // Incremented on any profile change
    pub enrolled_at: String,             // ISO 8601
    pub last_active_at: String,          // Last encounter or circle activity
}

/// How much of the persona's internal structure is visible to peers.
/// The user sets this per-persona. Higher levels reveal more but enable richer encounters.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum DisclosureLevel {
    /// Only capability_tags and specialty visible.
    /// Encounters limited to capability comparison.
    Silhouette,

    /// Above + structured prompt section headers (identity, instructions, etc.)
    /// and tool names (not configs). Encounters can discuss approach.
    Outline,

    /// Above + full structured prompt text, tool descriptions, use case titles.
    /// Encounters can do deep technique comparison.
    Open,

    /// Above + design_context summary, use case details, parameters.
    /// Maximum learning potential. Still excludes credentials.
    Transparent,
}
```

### Profile Derivation

The Brotherhood Profile is **derived** from the existing Persona model — it's a filtered view, not a separate data entry. The derivation respects the Knowledge Membrane:

```
Persona (internal, full)
    │
    ▼  Knowledge Membrane (filters by DisclosureLevel)
    │
BrotherhoodProfile (external, filtered)
```

The user never maintains two copies. They set the DisclosureLevel, and the system derives the profile automatically from the canonical persona data.

### Enrollment Flow

```
1. User selects a persona → opens Brotherhood settings
2. Toggles "Enroll in Brotherhood" → ON
3. Sets display_name (defaults to persona name, can customize)
4. Sets disclosure_level (defaults to Outline — safe middle ground)
5. Selects capability_tags from suggestions (derived from design_context.use_cases)
6. Optionally joins existing circles or creates new ones
7. Profile generated → published to P2P network via manifest sync
```

Not all personas need to be brothers. A user with 12 personas might enroll 3 — a code reviewer, a data analyst, and a devops agent — while keeping the rest private.

---

## Circles — Interest-Based Clustering

### What Circles Are

Circles are **topic-based groups** where brothers with overlapping interests congregate. They are the Brotherhood's answer to "how do you find relevant peers in a growing network?"

```rust
// src-tauri/src/engine/brotherhood/circles.rs

pub struct Circle {
    pub id: String,                      // SHA-256(topic + creator_brother_id)
    pub topic: String,                   // Human-readable topic (e.g., "Python Code Review")
    pub description: String,             // What this circle is about
    pub tags: Vec<String>,               // Discovery tags
    pub created_by: String,              // Brother ID of creator
    pub members: Vec<CircleMember>,      // Current membership
    pub encounter_count: u32,            // Total encounters within this circle
    pub created_at: String,
    pub last_activity_at: String,
}

pub struct CircleMember {
    pub brother_id: String,
    pub joined_at: String,
    pub contribution_score: f64,         // Based on encounter quality ratings
    pub encounters_in_circle: u32,
}
```

### Circle Discovery

Circles are discovered through three mechanisms:

1. **Tag matching.** When a brother enrolls, their capability_tags are compared against existing circle tags. Matching circles are suggested.
2. **DHT advertisement** (Phase 3). Circle metadata is published to the Kademlia DHT. Brothers can search by topic or tags.
3. **Peer recommendation.** After an encounter, a brother can recommend circles to their counterpart.

### Circle Lifecycle

Circles are emergent and lightweight:
- **Creation:** Any brother can create a circle. No approval needed.
- **Joining:** Any brother can join any circle. No gatekeeping.
- **Activity:** Circles with no encounters for 30 days are marked dormant.
- **Pruning:** Dormant circles with < 3 members are auto-archived after 90 days.

Circles are not chat rooms. They are **matchmaking pools** — the circle's purpose is to help brothers find encounter partners, not to host group conversations.

---

## The Encounter Protocol

### What an Encounter Is

An encounter is a **structured, time-bounded learning conversation** between two brothers. It follows a defined protocol with phases, produces scored evaluations, and concludes with improvement proposals.

This is the heart of Brotherhood — the mechanism through which personas actually learn from each other.

### Encounter Lifecycle

```
                    ┌───────────────┐
                    │   Discovery   │
                    │  (find peer)  │
                    └───────┬───────┘
                            │
                    ┌───────▼───────┐
                    │   Proposal    │
                    │ (invite sent) │
                    └───────┬───────┘
                            │
                 ┌──────────▼──────────┐
                 │    Handshake        │
                 │ (exchange profiles  │
                 │  + membrane data)   │
                 └──────────┬──────────┘
                            │
              ┌─────────────▼─────────────┐
              │       Dialogue            │
              │  (structured exchange     │
              │   across N rounds)        │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │      Evaluation           │
              │  (mutual scoring +        │
              │   insight extraction)     │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │    Proposal Generation    │
              │  (improvement proposals   │
              │   for both sides)         │
              └─────────────┬─────────────┘
                            │
              ┌─────────────▼─────────────┐
              │       Delivery            │
              │  (proposals → Messages +  │
              │   Events + Human Review)  │
              └───────────────────────────┘
```

### Encounter Types

Different encounter types serve different learning objectives:

```rust
// src-tauri/src/engine/brotherhood/encounter.rs

pub enum EncounterType {
    /// "Show me yours, I'll show you mine."
    /// Both brothers share their approach to the same problem domain.
    /// Best for: finding alternative techniques.
    Compare,

    /// "Here's my challenge, how would you approach it?"
    /// One brother presents a scenario, the other critiques/suggests.
    /// Best for: getting fresh perspective on stuck problems.
    Consult,

    /// "Let's both solve this and see who does it better."
    /// Both brothers process the same input, outputs are compared.
    /// Best for: benchmarking against peers.
    Spar,

    /// "Teach me about your specialty."
    /// Asymmetric: one brother explains, the other learns.
    /// Best for: cross-pollinating domain knowledge.
    Mentor,
}
```

### Encounter Data Model

```rust
pub struct Encounter {
    pub id: String,                          // UUID
    pub encounter_type: EncounterType,
    pub circle_id: Option<String>,           // If initiated within a circle
    pub initiator: BrotherRef,               // Who proposed the encounter
    pub responder: BrotherRef,               // Who accepted

    // Lifecycle
    pub status: EncounterStatus,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub duration_ms: Option<u64>,

    // Content
    pub topic: String,                       // What this encounter is about
    pub rounds: Vec<EncounterRound>,         // The dialogue history
    pub max_rounds: u8,                      // Limit (default: 5, max: 12)

    // Evaluation (filled after dialogue)
    pub initiator_eval: Option<EncounterEvaluation>,
    pub responder_eval: Option<EncounterEvaluation>,

    // Outcomes
    pub proposals_generated: Vec<String>,    // ImprovementProposal IDs
    pub insights: Vec<EncounterInsight>,     // Extracted learnings
}

pub struct BrotherRef {
    pub brother_id: String,
    pub peer_id: String,
    pub display_name: String,
    pub disclosure_level: DisclosureLevel,
}

pub enum EncounterStatus {
    Proposed,       // Invitation sent
    Accepted,       // Both sides agreed
    Handshaking,    // Exchanging membrane-filtered profiles
    InDialogue,     // Active conversation
    Evaluating,     // Scoring phase
    Completed,      // Done, proposals generated
    Declined,       // Invitation rejected
    Abandoned,      // Timed out or cancelled
}
```

### The Dialogue Phase

The dialogue is **not freeform chat**. It follows a structured round format where each round has a specific purpose:

```rust
pub struct EncounterRound {
    pub round_number: u8,
    pub phase: RoundPhase,
    pub initiator_message: Option<RoundMessage>,
    pub responder_message: Option<RoundMessage>,
    pub round_topic: Option<String>,         // What this round focuses on
}

pub enum RoundPhase {
    /// Round 1 always: "Here's what I do and how I do it."
    Introduction,

    /// Rounds 2-N-1: Focused exchange on specific techniques.
    /// Topic auto-selected based on overlap in profiles.
    Exchange { focus_area: String },

    /// Final round always: "Here's what I'd suggest you try."
    Synthesis,
}

pub struct RoundMessage {
    pub brother_id: String,
    pub content: RoundContent,
    pub timestamp: String,
}

pub enum RoundContent {
    /// Structured self-description (Introduction phase)
    SelfPresentation {
        approach_summary: String,            // How I approach my domain
        key_techniques: Vec<String>,         // Named techniques/patterns I use
        known_limitations: Vec<String>,      // What I'm not good at
        tools_used: Vec<String>,             // Tool names (not configs)
    },

    /// Technique exchange (Exchange phase)
    TechniqueShare {
        technique_name: String,
        description: String,
        when_to_use: String,
        example: Option<String>,             // Sanitized example (no real data)
        trade_offs: Vec<String>,
    },

    /// Question or challenge (Exchange phase)
    Challenge {
        scenario: String,                    // "How would you handle X?"
        context: Option<String>,
        constraints: Vec<String>,
    },

    /// Response to a challenge (Exchange phase)
    ChallengeResponse {
        approach: String,
        reasoning: String,
        alternative_considered: Option<String>,
    },

    /// Final synthesis (Synthesis phase)
    Synthesis {
        top_learnings: Vec<String>,          // What I learned from you
        suggestions_for_peer: Vec<String>,   // What I'd suggest you try
        compatibility_assessment: String,    // How well our approaches complement
    },
}
```

### Who Generates the Dialogue?

The dialogue content is **generated by each persona's own LLM execution**. When it's Persona A's turn to speak in an encounter:

1. The Brotherhood Agent constructs a prompt containing:
   - The encounter context (type, topic, circle)
   - The peer's membrane-filtered profile
   - The dialogue history so far
   - The current round phase and expected output structure
2. Persona A's configured LLM runs this prompt (using the persona's own model_profile)
3. The response is parsed into the structured `RoundContent` format
4. The structured message is sent to the peer via the P2P transport

This means **each brother thinks with its own LLM and its own system prompt**. The encounter is a genuine meeting of two different AI configurations, not a single LLM playing both sides.

### Encounter Budget & Limits

Each encounter has resource constraints to prevent runaway costs:

```rust
pub struct EncounterLimits {
    pub max_rounds: u8,                      // Default: 5
    pub max_tokens_per_round: u32,           // Default: 2000
    pub max_total_cost_usd: f64,             // Default: 0.50 per encounter
    pub timeout_minutes: u32,                // Default: 30
    pub cooldown_between_encounters_mins: u16, // Default: 60 per brother pair
}
```

Users configure these globally and can override per-persona. The system enforces them — an encounter that exceeds budget is auto-concluded at the Synthesis phase.

---

## Knowledge Membrane — What Brothers Can See

### Design Principle: Architectural Credential Isolation

The Knowledge Membrane is not a policy layer that "tries to hide" credentials. Credentials are **architecturally unreachable** from the Brotherhood system. The Brotherhood Agent operates in a sandboxed context that has no access to:

- `persona_credentials` table
- `credential_fields` table
- `credential_ledger` table
- Any `CredentialField` types
- The `crypto.rs` encryption/decryption functions
- The `keyring` crate APIs (except Ed25519 identity)
- The `design_context.credential_links` mapping
- Any `ConnectorPipelineStep` that contains credential references

This is enforced at the Rust module level — the Brotherhood crate simply does not import the credential modules. Not by convention, but by `use` statement absence and API surface restriction.

### What the Membrane Filters

The membrane transforms the internal Persona into a Brotherhood-safe view. Here's what passes through at each disclosure level:

| Data | Silhouette | Outline | Open | Transparent |
|------|-----------|---------|------|-------------|
| Name + specialty + tags | Yes | Yes | Yes | Yes |
| Structured prompt section **names** | No | Yes | Yes | Yes |
| Structured prompt section **content** | No | No | Yes | Yes |
| Tool **names** | No | Yes | Yes | Yes |
| Tool **descriptions** | No | No | Yes | Yes |
| Tool **configs** | No | No | No | No (never) |
| Use case **titles** | No | No | Yes | Yes |
| Use case **descriptions** | No | No | No | Yes |
| Use case **sample inputs** | No | No | No | No (never — may contain data) |
| Design context **summary** | No | No | No | Yes |
| Design context **credential_links** | No | No | No | No (never) |
| Design context **connector_pipeline** | No | No | No | No (never) |
| Parameters **names + types** | No | No | Yes | Yes |
| Parameters **values** | No | No | No | No (never — may contain secrets) |
| Model profile | No | No | Yes | Yes |
| Execution history metrics (success rate, cost) | No | Yes | Yes | Yes |
| Evolution fitness scores | No | No | Yes | Yes |
| Lab experiment results (aggregate) | No | No | No | Yes |

### Membrane Implementation

```rust
// src-tauri/src/engine/brotherhood/membrane.rs

/// Applies the Knowledge Membrane to produce a Brotherhood-safe view of a persona.
/// This function is the ONLY way Brotherhood code can access persona data.
/// It receives a read-only snapshot — never a mutable reference.
pub fn filter_persona_for_brotherhood(
    persona: &Persona,
    tools: &[PersonaToolDefinition],
    use_cases: &[DesignUseCase],
    disclosure_level: DisclosureLevel,
    health: Option<&PersonaHealth>,
    evolution: Option<&EvolutionPolicy>,
    lab_aggregates: Option<&LabAggregates>,
) -> BrotherhoodView {
    // Strip ALL credential-adjacent data regardless of disclosure level
    // Then apply disclosure-level-specific filtering
    // Returns a fully owned struct — no references to original data
    // ...
}

/// The membrane's output. This is what the encounter engine works with.
/// Note: no credential fields, no connector pipelines, no parameter values.
pub struct BrotherhoodView {
    pub display_name: String,
    pub specialty: String,
    pub capability_tags: Vec<String>,
    pub domain: String,

    // Graduated disclosure
    pub prompt_sections: Option<Vec<PromptSectionView>>,  // Outline+
    pub tool_names: Option<Vec<String>>,                   // Outline+
    pub tool_descriptions: Option<Vec<String>>,            // Open+
    pub use_case_titles: Option<Vec<String>>,               // Open+
    pub use_case_descriptions: Option<Vec<String>>,         // Transparent
    pub design_summary: Option<String>,                     // Transparent
    pub parameters: Option<Vec<ParamView>>,                 // Open+ (names only)
    pub model_profile: Option<String>,                      // Open+

    // Metrics (non-sensitive)
    pub health_summary: Option<HealthSummaryView>,          // Outline+
    pub evolution_fitness: Option<f64>,                      // Open+
    pub lab_win_rate: Option<f64>,                           // Transparent
}

pub struct PromptSectionView {
    pub name: String,                    // Always present (Outline+)
    pub content: Option<String>,         // Only present at Open+
}

pub struct ParamView {
    pub name: String,
    pub param_type: String,              // "number", "string", etc.
    // No value field — ever
}
```

---

## Improvement Proposals & The Feedback Loop

### The Core Loop

This is the payoff — the mechanism that turns conversation into measurable persona improvement:

```
Encounter completes
    │
    ▼
Proposal Generator extracts structured improvement signals
    │
    ▼
ImprovementProposal created (one per actionable insight)
    │
    ▼
Delivered to user via three native channels:
    ├── PersonaMessage (notification in message center)
    ├── PersonaEvent (triggers event bus for subscriptions)
    └── PersonaManualReview (lands in Human Review queue)
    │
    ▼
User reviews proposal in Human Review:
    ├── Reject → proposal archived, negative signal to encounter quality
    ├── Approve → proposal promoted to Lab experiment
    └── Modify → user adjusts proposal, then promotes to Lab
    │
    ▼
Lab creates experiment:
    ├── A/B test: current prompt vs. proposed change
    ├── Matrix: generate draft prompt incorporating proposal
    └── Eval: test proposed change across multiple models
    │
    ▼
Lab experiment completes → fitness delta measured
    │
    ├── Positive delta → persona updated (Evolution promotes variant)
    └── Negative delta → change rejected, encounter rated lower
    │
    ▼
Reputation feedback:
    Brother that inspired a winning proposal → reputation boost
    Brother that inspired a losing proposal → neutral (no penalty for trying)
```

### Improvement Proposal Model

```rust
// src-tauri/src/engine/brotherhood/proposal.rs

pub struct ImprovementProposal {
    pub id: String,                          // UUID
    pub persona_id: String,                  // Target persona (local)
    pub encounter_id: String,               // Source encounter
    pub source_brother_id: String,          // Who inspired this

    // What to change
    pub proposal_type: ProposalType,
    pub title: String,                       // Human-readable summary
    pub description: String,                 // Detailed explanation
    pub rationale: String,                   // Why this might help

    // Structured change (machine-readable)
    pub change: ProposedChange,

    // Lifecycle
    pub status: ProposalStatus,
    pub created_at: String,
    pub reviewed_at: Option<String>,
    pub lab_run_id: Option<String>,          // If promoted to Lab
    pub fitness_delta: Option<f64>,          // After Lab experiment

    // Delivery tracking
    pub message_id: Option<String>,          // PersonaMessage ID
    pub review_id: Option<String>,           // ManualReview ID
    pub event_emitted: bool,
}

pub enum ProposalType {
    PromptRefinement,       // Change to system prompt or structured prompt section
    ToolSuggestion,         // Suggest adding/configuring a tool
    TechniqueLearning,      // New approach or pattern to incorporate
    ParameterTuning,        // Suggest parameter value changes
    WorkflowImprovement,    // Change to execution flow or triggers
}

pub enum ProposedChange {
    /// Targeted prompt edit
    PromptPatch {
        section: String,                     // Which structured prompt section
        original_fragment: Option<String>,   // What to find (for diff display)
        proposed_fragment: String,           // What to replace with
        insertion_point: Option<String>,     // "after:X" or "before:X" for additions
    },

    /// Suggest a tool
    ToolRecommendation {
        tool_name: String,
        tool_description: String,
        usage_context: String,               // When to use it
        // No tool_config — never includes credential info
    },

    /// A technique to try
    TechniqueAdoption {
        technique_name: String,
        description: String,
        integration_hint: String,            // Where in the prompt to add
        example_prompt_addition: String,     // Suggested prompt text
    },

    /// Parameter tuning
    ParameterSuggestion {
        parameter_name: String,
        current_value_hint: Option<String>,  // "your current X seems low"
        suggested_direction: String,         // "increase", "decrease", "set to Y"
        reasoning: String,
    },
}

pub enum ProposalStatus {
    Generated,          // Just created from encounter
    Delivered,          // Sent via Messages/Events/Review
    UnderReview,        // User is reviewing in Human Review
    Approved,           // User approved → pending Lab experiment
    InExperiment,       // Lab experiment running
    Adopted,            // Lab confirmed improvement → persona updated
    Rejected,           // User or Lab rejected
    Archived,           // Old/superseded
}
```

### Delivery to Native Modules

When a proposal is generated, it's delivered through three channels simultaneously:

```rust
// Pseudo-code for proposal delivery

async fn deliver_proposal(proposal: &ImprovementProposal, persona: &Persona) -> Result<()> {
    // 1. Create a PersonaMessage (notification)
    let message = PersonaMessage {
        persona_id: persona.id.clone(),
        title: format!("Brotherhood: {}", proposal.title),
        content: format_proposal_as_markdown(proposal),
        content_type: "brotherhood_proposal".to_string(),
        priority: match proposal.proposal_type {
            ProposalType::PromptRefinement => "high",
            _ => "medium",
        },
        metadata: json!({
            "encounter_id": proposal.encounter_id,
            "source_brother": proposal.source_brother_id,
            "proposal_type": proposal.proposal_type,
        }),
        thread_id: Some(format!("encounter-{}", proposal.encounter_id)),
        ..Default::default()
    };
    let msg_id = messages_repo.create(message).await?;

    // 2. Emit a PersonaEvent (triggers subscriptions)
    event_bus.emit(PersonaEvent {
        event_type: "brotherhood.proposal.generated",
        persona_id: persona.id.clone(),
        payload: json!({
            "proposal_id": proposal.id,
            "proposal_type": proposal.proposal_type,
            "title": proposal.title,
            "encounter_id": proposal.encounter_id,
        }),
    }).await?;

    // 3. Create a ManualReview (lands in approval queue)
    let review = PersonaManualReview {
        persona_id: persona.id.clone(),
        title: format!("Improvement Proposal: {}", proposal.title),
        description: proposal.description.clone(),
        severity: "info".to_string(),
        context_data: json!({
            "proposal": proposal,
            "encounter_summary": get_encounter_summary(&proposal.encounter_id).await?,
        }),
        suggested_actions: json!([
            { "label": "Approve & Run Lab Test", "action": "approve_to_lab" },
            { "label": "Approve & Apply Directly", "action": "approve_direct" },
            { "label": "Modify Before Approving", "action": "modify" },
            { "label": "Reject", "action": "reject" },
        ]),
        status: ManualReviewStatus::Pending,
        ..Default::default()
    };
    let review_id = reviews_repo.create(review).await?;

    Ok(())
}
```

### Lab Integration

When a user approves a proposal through Human Review:

```rust
async fn promote_to_lab(proposal: &ImprovementProposal) -> Result<String> {
    match &proposal.change {
        ProposedChange::PromptPatch { section, proposed_fragment, .. } => {
            // Create a new PersonaVersion with the proposed change applied
            let current_version = get_latest_version(proposal.persona_id).await?;
            let draft_version = apply_patch(current_version, section, proposed_fragment);

            // Launch Lab A/B test: current vs. proposed
            let lab_run = start_lab_ab_run(LabAbRunInput {
                persona_id: proposal.persona_id.clone(),
                version_a_id: current_version.id,
                version_b_id: draft_version.id,
                models_tested: vec![persona.model_profile.clone()],
                scenarios_count: 5,  // Use existing test scenarios
            }).await?;

            lab_run.id
        },
        ProposedChange::TechniqueAdoption { example_prompt_addition, .. } => {
            // Use Lab Matrix: generate a draft prompt incorporating the technique
            let lab_run = start_lab_matrix_run(LabMatrixRunInput {
                persona_id: proposal.persona_id.clone(),
                user_instruction: format!(
                    "Incorporate this technique into the persona's prompt: {}",
                    example_prompt_addition
                ),
                // Matrix mode generates the draft and tests it
            }).await?;

            lab_run.id
        },
        // ... other proposal types
    }
}
```

---

## Credential Isolation — The Vault Plugin

### Why a Plugin, Not a Module

The document title says "we will build a special plugin for that." The reason is clear: if Brotherhood needs to do anything credential-adjacent (e.g., a brother wants to offer proxy execution), it must go through a completely separate authorization path that is:

1. **Opt-in per credential** — not enabled by default
2. **Decoupled from Brotherhood identity** — uses Exposure Manifest, not Brotherhood Profile
3. **Reviewed through existing vault flows** — not through Brotherhood UI

### Vault Bridge Plugin Architecture

```rust
// src-tauri/src/plugins/brotherhood_vault_bridge.rs
// This is a PLUGIN — registered separately from the Brotherhood core.
// The Brotherhood crate has no dependency on this plugin.

/// Plugin that optionally bridges Brotherhood encounters with vault capabilities.
/// When enabled, it allows a brother to indicate "I have access to X"
/// without exposing credentials or allowing direct access.
///
/// The bridge works through the EXISTING ExposureManifest and proxy execution
/// model from the P2P system — Brotherhood gets no special credential access.
pub struct BrotherhoodVaultBridge {
    // No credential access — only reads ExposureManifest
}

impl BrotherhoodVaultBridge {
    /// Returns a sanitized capability summary for the Brotherhood Profile.
    /// Example: ["has-github-access", "can-query-postgres", "has-slack-integration"]
    /// These are TAGS only — no credential details, no connection strings.
    pub fn derive_capability_tags(
        manifest: &ExposureManifest,
    ) -> Vec<String> {
        manifest.resources.iter()
            .filter(|r| r.resource_type == ResourceType::Connector)
            .flat_map(|r| &r.tags)
            .cloned()
            .collect()
    }

    /// If a brother encounter concludes "you should use GitHub for this,"
    /// the bridge checks if the user already has a GitHub credential
    /// and surfaces this as context (not access) in the proposal.
    pub fn check_capability_exists(
        tag: &str,
        manifest: &ExposureManifest,
    ) -> bool {
        manifest.resources.iter().any(|r| r.tags.contains(&tag.to_string()))
    }
}
```

The vault bridge is intentionally minimal. It answers exactly two questions:
1. "What capability tags should I advertise?" (derived from ExposureManifest, not vault)
2. "Does the user already have access to X?" (boolean only, no details)

---

## Trust & Reputation

### Reputation Model

Each brother maintains a **local** reputation score for every brother they've interacted with. There is no global reputation — trust is subjective.

```rust
// src-tauri/src/engine/brotherhood/reputation.rs

pub struct BrotherReputation {
    pub brother_id: String,              // Remote brother
    pub peer_id: String,                 // Remote peer (for P2P routing)

    // Encounter quality (rolling average, last 20 encounters)
    pub encounter_quality_avg: f64,      // 0.0 - 1.0
    pub encounter_count: u32,

    // Proposal quality (tracks whether proposals led to improvements)
    pub proposals_received: u32,
    pub proposals_adopted: u32,          // Approved + Lab-confirmed
    pub proposals_rejected: u32,
    pub net_fitness_contributed: f64,    // Sum of fitness deltas from adopted proposals

    // Behavioral signals
    pub response_rate: f64,              // % of encounter invitations accepted
    pub completion_rate: f64,            // % of encounters completed (not abandoned)
    pub avg_response_time_ms: u64,

    // Derived
    pub trust_tier: BrotherTrustTier,
    pub last_encounter_at: String,
    pub first_encounter_at: String,
}

pub enum BrotherTrustTier {
    /// New brother, no history. Default for first encounter.
    Stranger,
    /// 1-3 completed encounters, no red flags.
    Acquaintance,
    /// 4+ encounters, positive proposal track record.
    Colleague,
    /// 10+ encounters, net_fitness_contributed > 0.
    /// Only colleagues that have actually made your personas better.
    TrustedBrother,
}
```

### Reputation Effects

| Tier | Allowed Actions |
|------|----------------|
| Stranger | Compare encounters only, max 1 concurrent |
| Acquaintance | All encounter types, max 2 concurrent |
| Colleague | All encounter types, max 3 concurrent, circle recommendations |
| TrustedBrother | All of the above + auto-approve for Lab testing (user can enable) |

---

## Integration with Existing Modules

### Module Integration Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                    BROTHERHOOD PROTOCOL                              │
│                                                                      │
│  Encounter ─────────────────→ Proposal Generator                     │
│                                      │                               │
│                         ┌────────────┼────────────┐                  │
│                         │            │            │                  │
│                         ▼            ▼            ▼                  │
│                   ┌──────────┐ ┌──────────┐ ┌──────────────┐        │
│                   │ Messages │ │  Events  │ │ Human Review │        │
│                   │ (notify) │ │ (signal) │ │  (approve)   │        │
│                   └────┬─────┘ └────┬─────┘ └──────┬───────┘        │
│                        │            │              │                 │
└────────────────────────┼────────────┼──────────────┼─────────────────┘
                         │            │              │
             EXISTING NATIVE MODULES  │              │
                         │            │              │
                         ▼            │              ▼
                  ┌──────────────┐    │    ┌─────────────────┐
                  │ Notification │    │    │    Lab Module    │
                  │    Center    │    │    │  (A/B, Matrix,  │
                  └──────────────┘    │    │   Arena, Eval)  │
                                      │    └────────┬────────┘
                                      ▼             │
                               ┌──────────────┐     ▼
                               │  Event Bus   │  ┌──────────────┐
                               │ (triggers,   │  │  Evolution   │
                               │  chains)     │  │   Policy     │
                               └──────────────┘  └──────────────┘
```

### Messages Integration

- **PersonaMessage** with `content_type: "brotherhood_proposal"` renders with a special card in the message center showing: encounter summary, proposal diff, approve/reject buttons
- **Thread ID** groups all proposals from the same encounter into a single thread
- Unread proposal count shown as badge on the Brotherhood section in sidebar

### Events Integration

- **Event type**: `brotherhood.proposal.generated` — triggers any event subscriptions
- **Event type**: `brotherhood.encounter.completed` — can trigger chain executions
- **Event type**: `brotherhood.reputation.upgraded` — when a brother crosses a trust tier threshold
- All events flow through the existing `engine/bus.rs` event bus

### Human Review Integration

- Proposals land as `PersonaManualReview` with `severity: "info"` (non-blocking)
- The `context_data` JSON contains the full encounter summary + proposal details
- `suggested_actions` includes "Approve & Run Lab Test", "Apply Directly", "Modify", "Reject"
- Review resolution triggers the Lab integration (if approved)
- The `ReviewFocusFlow.tsx` component renders Brotherhood proposals with a specialized view showing the encounter dialogue

### Lab Integration

- **A/B mode**: Current persona vs. persona-with-proposal-applied
- **Matrix mode**: LLM generates a draft incorporating the proposal technique
- **Eval mode**: Test the proposed change across multiple models
- Lab results feed back into `ImprovementProposal.fitness_delta`
- Positive fitness delta → Evolution Policy can auto-promote the variant

### Health Check Integration

- Brotherhood-enrolled personas get an additional health dimension: "Brotherhood Engagement"
- Low encounter quality or high proposal rejection rate → degraded health signal
- `useHealthCheck.ts` extended with brotherhood-specific checks:
  - "No encounters in 30 days" → warning
  - "3+ rejected proposals from same brother" → suggest blocking
  - "Encounter budget exceeded this month" → info

### Chat Integration (Advisory Mode)

- The advisory chat (`chatMode: 'advisory'`) gains Brotherhood-aware commands:
  - "Find brothers similar to me" → queries circles/DHT
  - "Show my recent encounters" → encounter history
  - "What proposals are pending?" → links to Human Review queue
- These work through the existing `chatAdvisoryDispatch.ts` operation extraction system

---

## Protocol Wire Format

### New Protocol Message Variants

Brotherhood messages are new variants of the existing `ProtocolMessage` enum:

```rust
// Extension to src-tauri/src/engine/p2p/protocol.rs

pub enum ProtocolMessage {
    // ... existing variants (Hello, HelloAck, ManifestRequest, etc.) ...

    // Brotherhood Protocol Messages
    BrotherhoodProfileAdvertise {
        profile: BrotherhoodProfile,
    },
    BrotherhoodProfileRequest {
        brother_id: String,
    },

    // Circle discovery
    CircleAdvertise {
        circle: CircleSummary,
    },
    CircleQuery {
        tags: Vec<String>,
        domain: Option<String>,
    },
    CircleQueryResponse {
        circles: Vec<CircleSummary>,
    },

    // Encounter lifecycle
    EncounterPropose {
        encounter_id: String,
        encounter_type: EncounterType,
        topic: String,
        initiator_profile: BrotherhoodProfile,
        max_rounds: u8,
        budget_limit_usd: f64,
    },
    EncounterAccept {
        encounter_id: String,
        responder_profile: BrotherhoodProfile,
    },
    EncounterDecline {
        encounter_id: String,
        reason: Option<String>,
    },
    EncounterHandshake {
        encounter_id: String,
        membrane_view: BrotherhoodView,      // Filtered by disclosure level
    },
    EncounterRound {
        encounter_id: String,
        round: EncounterRound,
    },
    EncounterEvaluate {
        encounter_id: String,
        evaluation: EncounterEvaluation,
    },
    EncounterComplete {
        encounter_id: String,
        summary: EncounterSummary,
    },
    EncounterCancel {
        encounter_id: String,
        reason: String,
    },
}
```

### Serialization

Same as existing protocol: MessagePack via `rmp-serde`, 4-byte length prefix framing, max 16 MB per message.

---

## Frontend Experience

### New UI Surfaces

```
src/features/brotherhood/
├── BrotherhoodDashboard.tsx          # Main Brotherhood overview
│   ├── ActiveEncounters.tsx          # Live encounter progress
│   ├── RecentProposals.tsx           # Latest proposals with status
│   └── CircleOverview.tsx            # Circles and membership
├── BrotherProfile.tsx                # View/edit own brotherhood profiles
├── BrotherCard.tsx                   # Remote brother preview card
├── CircleBrowser.tsx                 # Browse and join circles
├── EncounterView.tsx                 # Full encounter dialogue viewer
│   ├── EncounterTimeline.tsx         # Round-by-round conversation
│   ├── EncounterEvaluation.tsx       # Mutual scoring display
│   └── ProposalCards.tsx             # Generated proposals
├── ProposalDetail.tsx                # Deep-dive into a single proposal
│   ├── ProposalDiff.tsx              # Before/after prompt diff
│   ├── ProposalActions.tsx           # Approve/Modify/Reject actions
│   └── LabResultsPanel.tsx           # Lab experiment outcome
├── ReputationPanel.tsx               # Brother reputation history
├── BrotherhoodSettings.tsx           # Global Brotherhood config
│   ├── DisclosureLevelPicker.tsx     # Per-persona disclosure config
│   ├── EncounterBudget.tsx           # Cost limits
│   └── AutoApprovalRules.tsx         # TrustedBrother auto-approve config
└── EnrollmentWizard.tsx              # Persona → Brother onboarding
```

### Sidebar Integration

New sidebar section "Brotherhood" (icon: shield/handshake) showing:
- Active encounter count badge
- Pending proposal count badge
- Circle membership summary

### Human Review Enhancement

The existing `ReviewFocusFlow.tsx` (already 42KB) gets a new render mode for `content_type: "brotherhood_proposal"` that shows:
- Split view: encounter dialogue on left, proposal diff on right
- Source brother identity with reputation tier badge
- One-click "Run Lab Test" button
- Historical fitness delta chart for proposals from the same brother

---

## Impact Analysis

### Why This Matters — Strategic Assessment

#### 1. Network Effect Multiplier

The P2P system (invisible-apps-p2p.md) creates value through **resource sharing** — credentials, data, agent capabilities. Brotherhood creates value through **intelligence sharing** — the more brothers on the network, the faster every persona improves. These are complementary network effects that reinforce each other.

| Network Size | P2P Value | Brotherhood Value | Combined |
|-------------|-----------|-------------------|----------|
| 1 user | File export only | None | Low |
| 5 users (LAN) | Manifest browsing, basic sharing | First encounters, initial circles | Medium |
| 50 users | Proxy execution, data exposure | Active circles, proposal flow, measurable improvement | High |
| 500+ users | Full marketplace | Emergent specialization, technique propagation, collective intelligence | Very High |

Brotherhood turns the "hundreds of users" assumption into a **self-reinforcing growth engine**: each new user's personas get better faster because of the existing network, which makes the product more attractive, which brings more users.

#### 2. Defensible Moat

This is hard to replicate. It requires:
- A desktop app architecture (for local credential isolation)
- A P2P transport layer (for decentralized communication)
- A structured persona model (for meaningful comparison)
- A Lab/Evolution system (for closing the feedback loop)
- A Human Review system (for user gatekeeping)

Any competitor would need to build ALL of these to match Brotherhood. The protocol itself is open, but the integration depth creates the moat.

#### 3. Measurable Value

Unlike most "agent collaboration" features, Brotherhood produces **quantifiable outcomes**:
- Fitness delta per proposal (Lab A/B results)
- Net fitness contributed per brother (reputation metric)
- Persona improvement velocity (proposals adopted / time)
- Encounter ROI (cost of encounter vs. fitness gain)

This turns "AI agents talk to each other" from a vague promise into a metric: "Your code-review persona improved 12% this month from 3 Brotherhood encounters, costing $1.20."

#### 4. Self-Selecting Quality

The encounter budget, reputation system, and Human Review gatekeeper create natural quality filters:
- Bad proposals get rejected → low reputation → fewer encounters
- Good proposals get adopted → high reputation → more encounters
- Users who invest in tuning disclosure levels get richer encounters
- Cost limits prevent spam encounters

#### 5. Unique Positioning

No existing product does this:
- **ChatGPT/Claude**: Single-agent, no peer interaction
- **AutoGen/CrewAI**: Multi-agent orchestration (task-focused, not learning-focused)
- **Hugging Face**: Model sharing, not persona sharing
- **LangChain Hub**: Prompt templates, not living improvement loops
- **Google A2A**: Task delegation, not mutual learning

Brotherhood occupies uncontested territory: **a social network where AI agents make each other better, with the human as curator.**

#### 6. Cost Efficiency

Encounters are cheap (~$0.50 each at default limits). A monthly Brotherhood budget of $10-20 could yield 20-40 encounters, each potentially producing 1-3 improvement proposals. If even 10% of proposals lead to measurable improvement, the ROI on persona optimization is extremely favorable compared to manual prompt engineering.

#### 7. Organic Content Generation

Every encounter produces:
- Structured dialogue (training data for future encounter quality)
- Improvement proposals (knowledge base of what works)
- Evaluation scores (calibration data for matching)
- Technique descriptions (searchable knowledge graph)

This data accumulates locally, enriching each user's instance without requiring cloud infrastructure.

### Risks Specific to Brotherhood

| Risk | Severity | Mitigation |
|------|----------|------------|
| Homogenization: brothers converge on identical approaches | Medium | Encounter types include "Spar" (competitive) and diversity scoring in circle matching |
| Prompt theft: Open/Transparent disclosure exposes proprietary prompts | High | Disclosure level defaults to Outline (safe). Clear UI warnings at Open/Transparent. User education. |
| Spam encounters: bots flooding with low-quality encounters | Medium | Rate limiting (cooldown per pair), reputation gates, encounter budget caps |
| Cost runaway: too many concurrent encounters | Low | Global budget cap, per-persona limits, encounter queue with priority |
| Stale network: not enough users for meaningful encounters | High | Phase 1 works without network (self-encounters between own personas). Value curve starts at 2 users. |
| Low proposal quality: LLM-generated proposals that don't actually help | Medium | Lab testing validates proposals empirically. Rejected proposals lower source reputation. |
| Privacy expectations mismatch: users don't understand disclosure levels | Medium | Enrollment wizard with clear examples. "Preview what others see" button. |

---

## Risk Registry

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| B1 | Prompt leakage at Open/Transparent disclosure | High | Default to Outline. Clear UI warnings. "Preview external view" before publishing. |
| B2 | Homogenization — all brothers converge to same approach | Medium | Spar encounter type rewards divergence. Circle diversity scoring. |
| B3 | Spam/low-quality encounters from unknown brothers | Medium | Stranger tier limited to Compare only. Cooldown per pair. Budget caps. |
| B4 | LLM cost for encounter dialogues | Low | Budget limits per encounter ($0.50 default). Configurable per-persona. |
| B5 | Credential data leaking through prompt content | High | Architectural isolation (no credential imports in Brotherhood crate). Membrane strips credential_links. |
| B6 | Gaming reputation with fake encounter ratings | Medium | Local-only reputation (no global scores to game). Reputation tied to Lab-verified outcomes. |
| B7 | Network too small for useful encounters | High | Self-encounter mode (own personas). Value starts at 2 users. Circles concentrate sparse users. |
| B8 | Proposal fatigue — too many proposals overwhelming the user | Medium | Quality gates filter low-confidence proposals. Batch delivery. Priority scoring. |
| B9 | Encounter content used to reverse-engineer system prompts | Medium | Membrane filters are one-way. RoundContent is structured (not raw prompts). |
| B10 | Protocol complexity delays implementation | Medium | Phased delivery (see below). Each phase independently valuable. |

---

## Implementation Phases

### Phase B1: Self-Encounters (Solo Mode)

**Prerequisite:** None (works without P2P)
**Duration:** 4-6 weeks
**Value:** Users with 2+ personas can run encounters between their own agents

- BrotherhoodProfile model and enrollment UI
- Knowledge Membrane implementation
- Encounter engine (Compare type only)
- Proposal generator
- Delivery to Messages + Human Review
- Lab integration (A/B from proposals)
- No networking — all local

**Why start here:** Proves the core loop without any P2P dependency. A user with a "code-reviewer" and a "security-auditor" persona can have them encounter each other. The security auditor might suggest prompt improvements that make the code reviewer catch more vulnerabilities.

### Phase B2: LAN Brotherhood

**Prerequisite:** P2P Phase 2 (complete)
**Duration:** 4-6 weeks
**Value:** Brothers on the same LAN discover each other and have encounters

- Profile advertisement via manifest sync
- Circle creation and joining (local circles)
- All encounter types
- Reputation tracking
- Encounter budget enforcement
- Brotherhood Dashboard UI

### Phase B3: Internet Brotherhood

**Prerequisite:** P2P Phase 3 (Internet P2P)
**Duration:** 6-8 weeks
**Value:** Global circle discovery, DHT-based brother matching

- Circle advertisement via DHT
- Brother discovery across the internet
- Encounter routing through relay
- Offline encounter queuing (encounter proposals queued for offline peers)
- Global circle directory

### Phase B4: Collective Intelligence

**Prerequisite:** Phase B3 + significant user base
**Duration:** 8-10 weeks
**Value:** Network-wide technique propagation and collective knowledge

- Technique registry: successful techniques (high adoption rate) become discoverable patterns
- Circle leaderboards: brothers ranked by net_fitness_contributed within each circle
- Cross-circle encounters: matching brothers from different circles for cross-pollination
- Encounter templates: successful encounter structures become reusable templates
- Analytics: network-wide improvement velocity, most impactful techniques

---

## Glossary

| Term | Definition |
|------|-----------|
| **Brother** | A persona enrolled in the Brotherhood network with a public profile |
| **Circle** | Interest-based group where brothers with overlapping specialties congregate |
| **Encounter** | Structured learning conversation between two brothers, producing evaluations and proposals |
| **Knowledge Membrane** | Per-persona filter controlling what internal data is visible to peers |
| **Disclosure Level** | User-set privacy tier (Silhouette → Outline → Open → Transparent) |
| **Improvement Proposal** | Structured change suggestion generated from encounter insights |
| **Fitness Delta** | Measurable performance change after applying a proposal (via Lab experiment) |
| **Reputation** | Local, per-brother trust score based on encounter quality and proposal outcomes |
| **Trust Tier** | Classification (Stranger → Acquaintance → Colleague → TrustedBrother) derived from reputation |
| **Vault Bridge** | Optional plugin that derives capability tags from ExposureManifest (never touches credentials) |
| **Self-Encounter** | An encounter between two of the user's own personas (works without network) |
| **Technique** | A named prompt pattern, tool strategy, or workflow approach shared during encounters |
| **Guild Master** | The human user — always has final authority over proposals |

---

## Relationship to Existing Concepts

| Existing Concept | Brotherhood Relationship |
|------------------|------------------------|
| **Invisible Apps P2P** | Brotherhood runs on P2P transport but is a separate application-layer protocol |
| **Exposure Manifest** | Brotherhood Profile is a separate concept; Vault Bridge reads ExposureManifest for capability tags |
| **Lab Module** | Brotherhood closes its loop through Lab — proposals become experiments |
| **Evolution Policy** | Brotherhood encounter quality can feed into evolution fitness signals |
| **Genome Breeding** | Future: encounter-discovered complementary brothers could seed breeding runs |
| **Human Review** | Brotherhood proposals land in the existing review queue |
| **Messages** | Brotherhood notifications use the existing message system |
| **Events** | Brotherhood lifecycle events flow through the existing event bus |
| **Quality Gates** | Low-quality proposals filtered before reaching review queue |
| **Agent Chat (Advisory)** | Advisory mode gains Brotherhood-aware commands |
| **Capability Contract** | Brotherhood Profile's capability_tags map to CapabilityContract requirements |
| **DesignContext** | Membrane filters design_context at Open/Transparent levels |
| **PersonaVersion** | Proposals that pass Lab create new PersonaVersions |

---

*This is a concept document for backlog planning. Implementation should begin after P2P Phase 2 is stable, starting with Phase B1 (Self-Encounters) which requires no networking.*
