# Twin

> A digital identity that your AI personas adopt — bio, per-channel tone, voice, and a curated memory that grows from real interactions — so every agent speaks as *you*, not as a generic LLM.

The plugin lives at `src/features/plugins/twin/` and is exposed through the **Plugins → Twin** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/infrastructure/twin.rs` and the connector seed at `scripts/connectors/builtin/twin.json`.

---

## What it does

Twin treats the user as a first-class entity that personas can adopt. A **twin profile** bundles six independent layers, each stored in its own SQLite table and each editable on its own tab:

| Domain | Table | What it captures |
|---|---|---|
| **Profile** (name, bio, role, pronouns, Obsidian subpath) | `twin_profiles` | Who the twin is. One row is marked `is_active`; any persona calling a twin tool resolves to that row by default. |
| **Tone** (per-channel voice directives) | `twin_tones` | *How* to speak, keyed by channel (`generic`, `discord`, `slack`, `email`, `sms`, `voice`). `generic` is the fallback. |
| **Brain** (Obsidian vault + vector KB) | `twin_profiles.obsidian_subpath` + `knowledge_base_id` | Two-layer memory: human-readable notes in Obsidian + a vector-indexed knowledge base for semantic recall. |
| **Memory** (pending review → approved) | `twin_pending_memories` | Facts, preferences, decisions. Memories start as `pending`, get human-reviewed, then index into the KB. |
| **Communications** (raw interaction log) | `twin_communications` | Every message sent or received through the Twin connector, with direction + channel + contact handle. |
| **Voice** (ElevenLabs synthesis config) | `twin_voice_profile` | Voice ID, model, stability/similarity/style sliders. |
| **Channels** (deployment bindings) | `twin_channels` | Where the twin speaks — Discord, Slack, Telegram, etc. — each bound to a vault credential and optionally a persona. |

A persona invoking a twin tool (e.g. `get_tone("slack")`, `recall_memory("client X")`) resolves the **active twin** and reads the relevant layer. The connector never stores state itself — the twin layers are the source of truth.

---

## User flow

The plugin is organised as eight tabs — **Profiles**, **Identity**, **Tone**, **Brain**, **Knowledge**, **Voice**, **Channels**, **Training** — with a persistent **TwinSelector** banner at the top. The banner shows the active twin name and, when more than one twin exists, a **searchable picker** opens as a popover with keyboard arrows + Enter + a "Create new twin" footer CTA (routes to Profiles). A clickable **readiness pill** on the right summarises the active twin's setup score (0–100); clicking it opens a popover that lists the highest-impact missing milestones (e.g. *"No bio yet"*, *"Generic tone only"*) and deep-links into the matching sub-tab so the user can fix them one click away. Next to it sits a **wiki freshness pill** — *"not compiled"* / *"Wiki: 12m ago"* / *"Wiki: 3d ago"* (stale) — that clicks through to recompile the per-twin markdown wiki on disk via `twin_compile_wiki`. The pill polls `twin_wiki_status` on twin switch, so the user can spot a stale wiki without opening the Knowledge tab. When a wiki exists on disk, a paired **folder-icon button** opens the wiki directory in the OS file manager via `@tauri-apps/plugin-shell`.

### 1. Profiles — manage twins

1. Open **Plugins → Twin → Profiles**.
2. Click **New Twin** — give it a name (e.g. *Founder Twin*) and an optional role. The first twin created is auto-activated.
3. Each profile card shows its Obsidian subpath and three actions: **Set active** (checkmark), **Edit** (pencil), **Delete** (trash). Deleting a profile removes only the row — Obsidian files are untouched.

### 2. Identity — who the twin is

1. Open **Identity**. The header renders the active twin's name.
2. Fill **Name**, **Role / Title**, **Gender** (male / female / neutral), **Bio**, and **Obsidian Vault Subpath**.
3. Click **Generate with AI** to open the bio generator — enter keywords, the backend composes a polished paragraph that lands in the Bio field (you can still edit it). When a bio is already present, the same button reads **Refine with AI** — the panel sends the existing bio + any optional steering keywords ("more concise", "keep the dry humor") to `twin_generate_bio`'s refine mode, which tightens the prose while preserving voice and facts.
4. The **Prompt preview** card shows the exact text that gets injected into the persona's system prompt when this twin is adopted: `You are speaking as <name>, <role>.\n\n<bio>`.
5. Hit **Save Identity** when dirty.

### 3. Tone — per-channel voice

1. Open **Tone**. You see one collapsible card per well-known channel (generic, discord, slack, email, sms, voice).
2. Expand any channel and fill the four fields:
   - **Voice Directives** — free-text style prompt ("Casual, dry humor, short sentences. Skip formality.")
   - **Length Hint** — "1–3 sentences, short paragraph…"
   - **Constraints** — JSON array of do/don't rules (`["No emoji", "No corporate speak"]`)
   - **Example Messages** — JSON array of reference lines in your real voice
3. Save. Channels without a row fall back to the **generic** tone, which is always the default.

### 4. Brain — the memory layers

1. Open **Brain**. Three sections appear:
   - **Obsidian Vault** (optional) — informational; reads from the `obsidian_subpath` set in Identity.
   - **Knowledge Base** (required for recall) — vector-indexed store that powers `recall_memory`.
   - **Distilled facts** — curated, cited facts about the twin or specific contacts. Each row cites the `twin_communications` it came from (provenance contract — facts can never enter without a source). Manual write surface today; future cycles add a Claude-driven consolidation pass that proposes facts from recent communications + approved pending memories.
   - **Reflections** — operator-audit journals. The user types a seed question; the backend assembles the twin profile + last 40 communications + the seed into a Claude prompt and persists the prose answer as an immutable `twin_reflection` row. The journal is read-only after write — the audit value is precisely that reflections stay frozen at the moment they were generated.
   - **Recall preview** — read-only visualisation of the structured bundle a persona prompt-builder would see at runtime: bio + generic tone + last 5 communications + top 5 distilled facts + top 5 contacts (when twin-wide). Drives by the new `twin_recall(twin_id, contact_handle?)` command. Scope-to-contact buttons let the operator see what recall looks like for a specific relationship. Stage 1 ships the bundle + preview; Stage 2 will wire it into the actual persona prompt path so runtime replies pick up the same shelves.
2. If no KB is bound: press **Create New KB** (auto-creates *`<Twin name> Brain`* and binds it) or **Link Existing** to pick one from the credential vault.
3. Once bound, the panel shows document count, chunk count, and status (ready / pending). **Refresh** re-fetches stats, **Unbind** detaches without deleting the KB.
4. The "How the brain grows" card explains the 5-step lifecycle: personas record interactions → pending memories appear in Knowledge → you approve → indexed into KB → next recall finds them.

### 5. Knowledge — review what the twin remembers

A **Contacts** panel sits at the top of the tab — every external handle this twin has interacted with (auto-populated from `twin_communications` on each list call, no background job). Each row shows the handle (or its operator-supplied alias), last-seen relative time, and message count. Inline edit attaches an alias + free-text notes that persist per `(twin_id, handle)` and become the scope key for the future per-contact memory + nudge work.

Below the Contacts panel the tab is a two-column grid:

- **Memory Inbox (left)** — filters for `pending` / `approved` / `rejected`. Each pending card shows title, content, channel badge, priority if > 3, an optional **provenance chip** ("from `abc12345…`") linking back to the source `twin_communications.id` that produced it (populated for memories created by `record_interaction`; NULL for URL-ingest and wiki-audit memories), and two actions: **Approve** (index into KB) or **Reject** (discard). Approved memories power future recalls. When viewing the **pending** filter, a bulk-action bar appears above the list with a "Select all on this page" checkbox; each row also gets its own checkbox. With one or more selected, "Approve N" and "Reject N" buttons fire sequential reviews and show a single completion toast — turns a 10-card triage into two clicks.
- **Conversation History (right)** — chronological log of every interaction through the Twin connector. Inbound vs outbound is color-coded (cyan vs violet), and each row shows channel, contact handle, timestamp, content, and optional summary. This is the raw trail; the inbox is the curated extract.

### 6. Voice — ElevenLabs configuration

1. Paste a **Voice ID** from the ElevenLabs voice library (the "Find voices" link opens it).
2. Enter a **Credential ID** pointing to the ElevenLabs API key stored in the vault. Required for synthesis, optional for configuration.
3. Pick a **Model** (Multilingual v2, Monolingual v1, Turbo v2 / v2.5).
4. Adjust the three sliders (**Stability**, **Similarity Boost**, **Style**) — labels underneath make the trade-off obvious ("More expressive" ↔ "More consistent").
5. Hit **Preview** (next to Save) to synthesize a short sample line with the current form values via `companion_tts` and play it inline — works against the unsaved form, so you can A/B slider changes without committing.
6. **Configure Voice** saves the profile. From there `synthesize_speech` is callable by any persona adopting this twin.

### 7. Channels — where the twin speaks

1. Open **Channels**. Press **Add Channel**.
2. Pick a **Channel Type** (Discord, Slack, Email/Gmail, Telegram, SMS/Twilio, Teams, WhatsApp). The credential picker immediately filters by matching service type.
3. Give it a **Label** (e.g. *My Discord Server*), pick a **Credential**, and optionally bind a **Persona ID** that operates there.
4. Each channel card has pause/activate, remove, and a **Test** action. The Test button records a synthetic outbound communication (no external bridge fires — it's a local signal) so you can see the channel light up in the activity feed. Below the credential row each card shows a **last-bridged badge** ("Last bridged 12m ago" / "Never used") derived from the active twin's communication log — at-a-glance freshness for spotting dead channels. Paused channels don't accept inbound twin traffic and have Test disabled, but stay listed.
5. The **Persona** binding in the add-channel form is a searchable dropdown of registered personas (with a "— None —" option) rather than a raw ID input — the row chip then shows the persona name instead of a truncated id.

### 8. Training — teach the twin by conversation

1. Open **Training**. Pick a topic preset (Work & Background, Tech Opinions, Communication Style, Values & Principles, Domain Expertise, Personal Interests) or type a custom topic.
2. The model generates 5 interview questions **grounded in what's already approved in the KB** — the topic screen shows "Already known: N memories — questions will avoid duplicates."
3. Answer each question in your own voice. Each answer is recorded as a pending memory. If your answer is terse (< 15 words), a single **Follow-up** question is generated and inserted into the queue; you can **Skip** it instead of answering.
4. On completion, the model summarises the session into a 3–5 sentence "what we learned" paragraph. The summary is saved as a high-signal pending memory tagged `kind: session_summary`, and displayed on the complete screen.
5. Below the summary, a **Where to go next** panel surfaces the two topic presets with the thinnest grounding-fact coverage so far (rough keyword-match on the active twin's approved memories). Clicking a recommendation **auto-starts the matching preset** — `generateQuestions` fires immediately for the picked topic prompt, skipping the topic picker. Completion → next session is one click.
6. Press **Review Memories** to jump straight to the Knowledge tab and triage the new pending entries.

### Twin × Persona binding

In the **Agents → Settings** tab each persona has a **Twin** card. It lets you pick:

- **Inherit active twin** (default) — persona speaks as whichever twin is currently active.
- **A specific twin** — persona always adopts the pinned twin regardless of the active selection.

The choice is stored in `design_context.twinId` on the persona record. Runtime connector resolution currently still returns the globally-active twin — see Direction 3 below for the next step that wires the override.

### Lifecycle, end-to-end

```
  ┌──────────┐                 ┌──────────┐                 ┌─────────────┐
  │ Training │ ──── Q&A ─────► │  Pending │ ─── approve ──► │  Vector KB  │
  │   room   │                 │ memories │                 │ (semantic   │
  └──────────┘                 └──────────┘                 │  recall)    │
                                     ▲                      └──────┬──────┘
  ┌──────────┐                       │                             │
  │ Persona  │ ─ record_interaction ─┘                             │
  │ adopting │                                                     │
  │ the twin │ ─── recall_memory ──────────────────────────────────┘
  └────┬─────┘
       │   ┌─────────────────────────┐
       └──►│ Tone per channel +      │── shaped reply ──► Discord / Slack /
           │ Voice (ElevenLabs)      │                    Email / SMS / Voice
           └─────────────────────────┘
```

Every layer is independent: you can run a twin with just a bio and no KB; you can train without voice; you can deploy channels without training. The twin sharpens as you use it.

---

## Strongest use case (speculation)

> **A single, portable "how I talk" config that every one of your agents respects — so you scale yourself instead of a fleet of generic LLMs.**

Most multi-agent tools make each persona configure its own voice, tone, and memory from scratch. The result is a workspace full of agents that all sound like *ChatGPT wearing different hats*. Twin inverts that: one profile captures **you** — your bio, your channel-specific tone, your voice, your curated memory — and any persona can adopt it with one setting.

The killer flow:

1. You spend 20 minutes in the **Training Room** answering questions across three topics. The session summaries go straight into the KB.
2. You write a generic **Sales Coach** persona. No tone config, no memory wiring.
3. The Sales Coach has the `Twin` connector enabled. It calls `get_tone("slack")` → gets your Slack voice directives. It drafts a message → sends through the `synthesize_speech` path if voice is configured → you approve → `record_interaction` logs the outgoing message.
4. The next time someone asks the Sales Coach to follow up, it calls `recall_memory("client X")` and finds the approved memory from the earlier interaction. It doesn't just sound like you — it *remembers* the same things you do.

This closes a loop most agent products miss: **the human's voice + the human's memory are first-class, shared resources across every agent the human runs.** Agents don't have to relearn who you are every conversation; they adopt the twin and inherit everything at once.

The compound moat is quiet but strong: you need a desktop app to persist the memory locally (browser agents can't), you need a credential vault to bind ElevenLabs / Slack / Discord on the user's own accounts (vendor SaaS doesn't), and you need an Obsidian bridge so memories are human-editable in a tool people already use (chat-only competitors don't). Personas has all three — Twin is where they combine into a personal identity layer no one else can assemble.

---

## Five development directions

### 1. ElevenLabs voice picker & preview-on-save

Voice today is a config form: paste a voice ID, adjust sliders, hope it sounds right. Turn it into a discovery experience:

- List voices via the ElevenLabs API using the stored vault credential, rendered as a grid with name, accent, gender, and a **Play sample** button.
- A **Test voice** button synthesizes a line from the twin's bio so you can hear how *your* voice + *your* bio combine before committing.
- Save the picked voice *and* the sample audio for regression comparison when sliders change.

This is the difference between "you need to know ElevenLabs" and "you open Twin and pick your voice in 30 seconds."

### 2. Live channel inbox & error surfacing

Channels today is pure CRUD. No signal that messages are flowing, no feedback when a credential expires. Wire:

- Per-channel **last-message timestamp** + an inbound indicator dot (pulse when unseen traffic arrived).
- Per-channel **last-error** badge (auth failed, rate-limited, webhook down) with a retry affordance.
- A slide-out drawer on each channel card that shows the last N messages filtered by that channel, linking back to the Knowledge → Conversation History tab for deeper inspection.

KnowledgePage already has a full conversation log; Channels needs to become the operational view of the same stream.

### 3. Wire per-persona twin resolution in the connector runtime

**Wired in commit 871a82c87→…** `twin_get_active_profile(persona_id)` now accepts an optional `persona_id`. When set, it parses the persona's `design_context.twin_id`; if present and the twin exists, it returns the pinned twin. Else it falls back to the globally-active twin. A deleted twin id silently falls back rather than erroring, so a stale `design_context` entry never crashes a persona.

Remaining work for the next pass: thread `persona_id` through the connector tool invocation path so every `get_tone` / `recall_memory` / `synthesize_speech` call on behalf of that persona automatically picks up the override. The frontend `getActiveProfile(personaId?)` wrapper is in place; engine-side wiring of the persona id into the connector context is the follow-up.

### 4. Surface the hidden Twin wiki flows

The backend already exposes three commands the UI never calls: **`twin_ingest_url`** (scrape a URL into the twin brain), **`twin_compile_wiki`** (compile the full twin as a cross-linked markdown wiki), **`twin_audit_wiki`** (AI-audit the compiled wiki for gaps and contradictions). Build a new **Wiki** tab:

- **Ingest URL** input — paste a LinkedIn profile, personal blog, or public bio; the backend scrapes it, strips HTML, and queues facts as pending memories.
- **Compile** button that renders the current twin as a multi-section wiki page (identity, tone samples, voice config, memory highlights, channel inventory) and lets the user download or push to Obsidian.
- **Audit report** that flags missing fields, contradictions between memories, and stale communications — a standing-health view of "how well-formed is my twin?"

These flows already exist in Rust — surfacing them is mostly a UI lift and unlocks serious capability.

### 5. Per-channel memory scoping

Every `twin_communications` row carries a `channel` field; every `twin_pending_memories` row optionally does too. But `recall_memory` doesn't filter by channel, so a memory captured in a private Discord DM can leak into a public email draft. Add scoping:

- When approving a memory, tag it with **default scope** (channel-specific, all-channels, or sensitive/do-not-use).
- Extend `recall_memory` with a `channel` filter: a persona drafting a Slack message recalls only all-channels + slack-scoped memories; a persona on email never sees slack memories unless explicitly requested.
- Surface the scope in the Knowledge tab inbox so users can re-scope memories after the fact.

This is the difference between "a shared brain" and "a brain that understands audience." Given that the `channel` column already exists in both `twin_pending_memories` and `twin_communications`, the migration is trivial and the win is large.

---

## Twin connector — agent-side execution layer

The plugin exposes itself as the builtin connector **`builtin-twin`** (category `personalization`, `min_tier: builder`, `always_active: true`). Unlike most connectors it has **no fields and no auth** — the active twin row *is* the credential. The connector seed lives at `scripts/connectors/builtin/twin.json`.

### Tools the agent can call

| Tool | Purpose |
|---|---|
| `get_identity` | Resolve the active twin's name, role, bio, pronouns |
| `get_tone` | Per-channel voice directives, examples, constraints, length hint |
| `get_system_prompt` | Pre-assembled prompt fragment (identity + current-channel tone) |
| `recall_memory` | Semantic search against the bound knowledge base |
| `recall_recent_messages` | Recent `twin_communications` rows, filterable by channel |
| `record_interaction` | Log an outgoing or inbound message; optionally create a pending memory |
| `lookup_relationship` | Pull facts about a specific person / contact handle |
| `ingest_observation` | Add a new pending memory straight from the agent |
| `synthesize_speech` | Render text to audio via the configured ElevenLabs voice |
| `get_voice_profile` | Return the current voice ID + synthesis sliders |

### Events the connector emits

`tone_updated`, `identity_updated`, `memory_saved`, `interaction_recorded`, `voice_configured`. Any trigger or automation can subscribe — e.g. "when a memory is saved, push a Slack notification."

### How resolution works

The connector keeps no state. Every tool call queries the DB fresh: which twin is active? what tone is set for this channel? what's in the KB? This means the twin can be edited in the plugin UI while an agent is mid-conversation and the next tool call picks up the new value without a restart.

Per-persona overrides (Direction 3 above) are the next evolution: `design_context.twinId` lets a persona pin to a specific twin, but the runtime still resolves the global active twin today. Wiring the override is a ~20-line Rust change and turns Twin into a true multi-identity system.

---

## Reference: backend commands

| Command | Purpose |
|---|---|
| `twin_list_profiles` / `twin_get_profile` / `twin_get_active_profile` | Read twin rows |
| `twin_create_profile` / `twin_update_profile` / `twin_delete_profile` | CRUD on profiles |
| `twin_set_active_profile` | Switch which twin `builtin-twin` resolves to |
| `twin_list_tones` / `twin_get_tone` / `twin_upsert_tone` / `twin_delete_tone` | Per-channel tone rows |
| `twin_bind_knowledge_base` / `twin_unbind_knowledge_base` | Attach / detach a vector KB |
| `twin_list_pending_memories` / `twin_review_memory` | Memory inbox + approve/reject |
| `twin_list_communications` / `twin_record_interaction` | Conversation log + write path used by the connector |
| `twin_get_voice_profile` / `twin_upsert_voice_profile` / `twin_delete_voice_profile` | ElevenLabs voice config |
| `twin_list_channels` / `twin_create_channel` / `twin_update_channel` / `twin_delete_channel` | Channel deployment bindings |
| `twin_generate_bio` | CLI-backed free-form completion (used for Identity bio generation, training Q generation, follow-ups, session summaries) |
| `twin_ingest_url` | Scrape a URL and queue extracted facts as pending memories (used in the Create Twin wizard's "Bio from URL" step) |
| `twin_compile_wiki` | Compile the full twin as a cross-linked markdown wiki (surfaced in the Knowledge tab's collapsible "Twin wiki" panel) |
| `twin_audit_wiki` | AI-audit the compiled wiki for gaps / contradictions (paired with compile in the Knowledge tab's wiki panel) |

## Reference: frontend modules

```
src/features/plugins/twin/
├── TwinPage.tsx                        # tab host; renders TwinSelector + active sub-tab
├── TwinSelector.tsx                    # persistent "speaking as" banner (empty / chip / dropdown)
├── TwinEmptyState.tsx                  # shared empty state for subtabs with no active twin
├── sub_profiles/ProfilesPage.tsx       # twin CRUD
├── sub_identity/IdentityPage.tsx       # bio / role / gender / pronouns / AI bio generator
├── sub_tone/TonePage.tsx               # per-channel voice directives
├── sub_brain/BrainPage.tsx             # Obsidian subpath + KB bind/unbind
├── sub_knowledge/KnowledgePage.tsx     # pending-memory inbox + conversation history
├── sub_voice/VoicePage.tsx             # ElevenLabs voice ID + model + sliders
├── sub_channels/ChannelsPage.tsx       # channel deployment cockpit
└── sub_training/TrainingPage.tsx       # KB-grounded interview with adaptive follow-ups + session summary
```

```
src/features/agents/sub_settings/
└── TwinBindingCard.tsx                 # persona editor: pin a twin to a persona via design_context.twinId

src/stores/slices/system/
└── twinSlice.ts                        # Zustand slice: profiles, tones, memories, comms, voice, channels

src/api/twin/
└── twin.ts                             # thin invokeWithTimeout wrappers around twin_* Tauri commands

scripts/connectors/builtin/
└── twin.json                           # builtin-twin connector seed (no fields, always_active, min_tier: builder)
```

All copy lives under `t.twin.*` in the canonical locale bundle at `src/i18n/locales/en.json` (feature-scoped i18n directories were retired in the 2026-05-08 i18n consolidation pass). The `TwinBindingCard` in the persona editor reads/writes `design_context.twinId`, which is typed as `twin_id: Option<String>` in the Rust `DesignContextData` struct (`src-tauri/src/db/models/persona.rs`). Sidebar navigation for the 8 sub-tabs is defined as `twinItems` in `src/features/shared/components/layout/sidebar/sidebarData.ts`.
