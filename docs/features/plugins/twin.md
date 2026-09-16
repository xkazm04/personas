# Twin

> A digital identity that your AI personas adopt — bio, per-channel tone, voice, and a curated memory that grows from real interactions — so every agent speaks as *you*, not as a generic LLM.

The plugin lives at `src/features/plugins/twin/` and is exposed through the **Plugins → Twin** entry in the sidebar. The Rust surface lives at `src-tauri/src/commands/infrastructure/twin.rs` and the connector seed at `scripts/connectors/builtin/twin.json`.

---

## What it does

Twin treats the user as a first-class entity that personas can adopt. A **twin profile** bundles six independent layers, each stored in its own SQLite table. Since the v2 restructure the layers no longer map one-to-one onto tabs: everything you *tell* the twin is gathered in **Setup**, everything it *learned or said* is reviewed in **Hub**.

| Domain | Table | What it captures |
|---|---|---|
| **Profile** (name, bio, role, pronouns, Obsidian subpath) | `twin_profiles` | Who the twin is. One row is marked `is_active`; any persona calling a twin tool resolves to that row by default. |
| **Tone** (per-channel voice directives) | `twin_tones` | *How* to speak, keyed by channel (`generic`, `discord`, `slack`, `email`, `sms`, `voice`). `generic` is the fallback. |
| **Brain** (Obsidian vault + vector KB) | `twin_profiles.obsidian_subpath` + `knowledge_base_id` | Two-layer memory: human-readable notes in Obsidian + a vector-indexed knowledge base for semantic recall. |
| **Memory** (pending review → approved) | `twin_pending_memories` | Facts, preferences, decisions. Memories start as `pending`, get human-reviewed, then index into the KB. |
| **Communications** (raw interaction log) | `twin_communications` | Every message sent or received through the Twin connector, with direction + channel + contact handle. |
| **Voice** (ElevenLabs synthesis config) | `twin_voice_profile` | Voice ID, model, stability/similarity/style sliders. No dedicated UI tab today (see below) — the table and connector tools are still live. |
| **Channels** (deployment bindings) | `twin_channels` | Where the twin speaks — Discord, Slack, Telegram, etc. — each bound to a vault credential and optionally a persona. |

A persona invoking a twin tool (e.g. `get_tone("slack")`, `recall_memory("client X")`) resolves the **active twin** and reads the relevant layer. The connector never stores state itself — the twin layers are the source of truth.

---

## User flow

The plugin is **three tabs** — **Profiles**, **Setup**, **Hub**. It was seven
(Profiles / Identity / Tone / Brain / Knowledge / Channels / Training) until the
2026-09-16 v2 restructure, which did not rearrange those seven surfaces: it
replaced them. The six retired pages are deleted, and a persisted or deep-linked
old tab id redirects (identity / tone / channels / training → **Setup**, brain /
knowledge → **Hub**) rather than rendering a blank screen. A **Voice** entry
existed in the sidebar until 2026-07-27 but never had a page behind it;
voice-of-writing is configured in **Setup**, and TTS voice selection for the
assistant lives under **Companion → Voice**.

The shape of the new tree is the point:

| Tab | What it is |
|---|---|
| **Profiles** | The roster. Which twins exist, which one is active, and how complete each one is. |
| **Setup** | Everything you *tell* the twin — identity, tone per channel, channels, memories — gathered by a guided conversation with a typed escape hatch behind it. |
| **Hub** | Everything the twin has *learned or said* — one feed of pending memories, messages, distilled facts, reflections and people, plus the reply loop. |

> **Setup and Hub are prototypes behind a switcher.** Each ships **four**
> alternative renderers over the *same* data contract, chosen from a pill strip
> in the tab's own chrome and remembered per surface in `localStorage`
> (`twin-variant:setup`, `twin-variant:hub`). Only the presentation differs —
> the session engine, the readiness maths and the feed are shared, so a variant
> can be dropped without taking a capability with it. This is deliberate
> scaffolding for picking a winner, not a permanent user-facing setting.

### 1. Profiles — manage twins

1. Open **Plugins → Twin → Profiles**.
2. Click **New Twin** — give it a name (e.g. *Founder Twin*) and an optional role. The first twin created is auto-activated, and creating one drops you straight into **Setup**.
3. The active twin's hero card shows its Obsidian subpath and three actions: **Set active** (checkmark), **Edit** (pencil), **Delete** (trash). On the smaller **satellite** cards, clicking anywhere on the card body activates that twin; Edit and Delete remain as explicit hover buttons. Deleting a profile removes only the row — Obsidian files are untouched.
4. Along the bottom of each card sits the **slot strip**: Identity / Tone / Brain / Memories, one segment each. A segment carries its status as colour *and* as shape (a filled disc, a half disc, an empty ring) so it reads without colour. Pressing one activates that twin and opens the tab that owns the slot — Identity and Tone open **Setup**, Brain and Memories open **Hub**. That routing is declared once, in `shared/twinStatus.ts`.
5. Whenever you close a milestone — the active twin's readiness score climbs — a brief **success toast** celebrates the progress, with a distinct "your twin is fully trained — 100% ready" message when the final milestone lands. (A short window after switching twins suppresses the toast so the initial data-load ramp isn't mistaken for progress.)

### 2. Setup — the guided build

Setup replaces four of the old tabs with one conversation. The governing rule:
**the generator proposes CONTENT; the flow owns STRUCTURE.** An LLM guide is
free to ask anything and to draft anything, and it is never the authority on
whether you are finished.

**The permanent chrome** paints on the first frame and never disappears while
the flow works — a turn in flight is a ghost row inside the transcript, never a
spinner that replaces the page:

- the **stage control** — *Guided setup* / *Training*;
- the **readiness strip** — four segments (identity / tone / channels / memories), each with its status glyph and one short measured fact ("62 words", "2 of 4 channels"), then the 0–100 score printed once as a number plus a meter. Clicking a segment moves the conversation to that slot. **`deriveReadiness` is the single completion authority**; the model's own `doneHint` is advisory, and a generator failure leaves the slot open rather than reading as finished;
- the **variant switcher** and the **voice controls** (dictate · speak · hands-free);
- **Fields** — a drawer with a real input for every slot the conversation can fill (name, role, bio, Obsidian subpath, and one tone field per channel). It is deliberately independent of the generator: when the guide is broken you can still finish the twin here, and a failed write is reported at the field rather than only in a toast that has already gone.

**A turn** is: the guide asks one question; it offers *suggestions* (positions, never silent defaults — picking one fills the composer and nothing is submitted until you send it); and it may attach **proposals** — typed values for a real field (a bio, a role, a tone for one channel), each on its own card with **Accept / Edit / Dismiss**. Nothing is written on silence: a card has no default action and no timer. A resolved card *stays* in the record wearing its verdict, so the transcript is an account of what was decided rather than a list of what is still pending. **Skip** records a question as declined; it never stores a value.

**Voice is an overlay on that flow, not a mode of its own.** Dictation puts *interim* transcript in the composer as a preview — visible, editable, and never acted on; only a final transcript answers. Hands-free reads the guide's question aloud and submits finals automatically. Where no speech engine exists the controls say so in one line instead of disappearing.

**The four Setup prototypes**, all over the same `SetupSessionApi`:

| Variant | The metaphor |
|---|---|
| **Conversation** | A transcript. Guide and user turns are rows and the proposal cards live *inside* the thread, so accepting one is visibly part of the record. |
| **Desk** | One framed question on a desk; everything still open waits in a buffer at the left. Answers are equal-height cards picked with a digit key, and the verdict leaves the desk in the direction it means. |
| **Orbit** | A place rather than a list: the twin's sigil holds the centre and the four slots orbit it, so the shape of the work is visible before a word is read. This is the variant that shows hands-free as *posture* — the centre wears a ring driven by how much speech is arriving. |
| **Canvas** | The artifact it produces. The twin's passport *is* the surface, every region a real editor, and a proposal is rendered inside the region it would change. |

**The training stage.** Switching the stage control to *Training* turns the same
conversation into an interview and adds **Batch studio** to the chrome — the
board for authoring many Q&A pairs at once. The studio is a real capability with
its own Rust commands and no equivalent in the guided flow, so the restructure
kept it and reaches it from here.

#### Studio mode (batch authoring, both sides)

- **Directions + topic** at the top steer the whole batch ("focus on failure stories", "keep questions short"). The **bookmark** button next to Directions saves them as the twin's **persistent training style guide** (`training_directives`): once saved, those directions are seeded into the box every time you open the Studio for this twin *and* automatically prepended to every question and answer generation, so the studio learns your taste instead of you restating it each session. A per-request note (e.g. a regenerate comment) still layers on top of the saved style.
- **Generate questions** runs a background batch (`twin_studio_generate_questions`) that fills the board with editable question rows (the "user simulation" side). Curate them inline — edit, add your own, or remove.
- **Draft all as twin** runs the long background pass (`twin_studio_generate_answers`) that drafts an answer *as the twin* for every question (the "twin simulation" side); a per-row **Draft** button drafts a single answer on demand. Each draft is editable and flagged **twin**; a word-count pill (thin / ok / rich) is a lightweight quality signal. When the twin has a bound knowledge base, each batch answer is grounded on the KB passages that best match its question — close-match-filtered, token-budgeted, one retrieval per question — so the batch trains on answers the twin's own brain informed rather than ungrounded guesses. Each item records a `kbGrounded` provenance flag; with no KB bound (or `ml` off) the answer grounds exactly as before.
- Both passes run in the **background** so you can gather a large batch and walk away: a progress bar tracks the answer pass, the sidebar shows a progress dot at every level (Plugins → Twin → Setup), and an **OS notification fires when the batch is done**. Cancel any time.
- A per-row **check** marks a pair for saving; **Save N selected** writes only the approved pairs as pending memories (the same review gate the Hub applies). The human always reviews before anything is saved.

When a bound-KB retrieval grounds a generation (Draft-as-twin, reply drafting, or the Studio batch), the injected context **leads with a compact corpus map** — the same `kb_corpus_map` overview the Documents surface renders — before the matched passages, so the twin knows the *shape* of its corpus (what it contains, which parts are unreadable scans) and won't claim something the map lists as missing. The map is clamped to half the retrieval token budget so it never crowds out the actual evidence; it only rides along when there is grounding to begin with.

### 3. Hub — one feed of what the twin knows and said

The Hub is the old Brain and Knowledge tabs merged. Everything the twin has
learned or said is **one feed** of typed entries — `memory`, `message`, `fact`,
`reflection`, `audit` — where the kind is a token that drives glyph and colour,
never a user-typed string.

**The permanent chrome**: the six counts, each read exactly once (pending,
approved, rejected, messages, facts, reflections); the **sources strip** (the
bound knowledge base with its document and chunk counts, the Obsidian subpath,
and the compiled-wiki freshness, with compile / audit / ingest-doctrine
actions); the variant switcher. A fetch never replaces any of it, and a failure
is announced as a failure rather than dressed up as "no data".

**The reactions** on a reviewable entry are **Approve**, **Dig deeper**
(approves *and* queues follow-up questions for the Setup training stage) and
**Reject**. Rejecting asks for one of six reasons (off-brand, inaccurate, too
long, wrong tone, risky claim, too private) and **supersedes** the entry — the
row stays as a record wearing its verdict, because a rejection plus the reason
for it is signal about your taste, not garbage. A message can be saved as a
distilled fact; facts and reflections can be deleted.

**The four Hub prototypes**, all over the same `HubFeedApi`:

| Variant | The metaphor |
|---|---|
| **Desk** | A triage desk: one entry at a time with keyboard verdicts, and a buffer of what is still pending. |
| **River** | The whole feed in time order, newest first, rows rippling in as they arrive. |
| **Map** | The brain as a graph — sources, stages, and what flowed between them. |
| **Contacts** | People first: every handle the twin has exchanged messages with, each opening the lane of what is attributed to them. |

**The reply lane** sits under the Hub — the operational draft → review → log
loop, so the brain and the mouth are on one surface. Pick a channel and a
contact, paste the inbound message, optionally add directions, and **Generate
draft** (`twin_draft_reply`); review or edit it, then **Approve & log** to
record it as an outbound communication. Nothing is bridged automatically — the
human stays in control. When the twin has a bound knowledge base the draft is
additionally grounded in the KB passages that best match the inbound message,
with source-document provenance. Picking a contact surfaces a **recent-thread
strip** of your last exchanges with them, and clicking a *received* row sets it
as the message being answered. **Quick-steer chips** (Shorter / Warmer / More
formal / End with a question) fill the steering text in one tap and regenerate
an on-screen draft immediately. A **Recently sent** rail lists the last few
logged outbound replies, each with a copy button and an **Adapt in outbox**
action that prefills the outbox with that reply's channel, contact and text —
making the loop reusable rather than write-only.

### Twin × Persona binding

In the **Agents → Settings** tab each persona has a **Twin** card. It lets you pick:

- **Inherit active twin** (default) — persona speaks as whichever twin is currently active.
- **A specific twin** — persona always adopts the pinned twin regardless of the active selection.

The choice is stored in `design_context.twinId` on the persona record. Runtime connector resolution currently still returns the globally-active twin — see Direction 3 below for the next step that wires the override.

### Lifecycle, end-to-end

```
  ┌──────────┐                 ┌──────────┐                 ┌─────────────┐
  │ Training │ ──── Q&A ─────► │  Pending │ ─── approve ──► │  Vector KB  │
  │ training │                 │ memories │                 │ (semantic   │
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

## Carrying a twin to another device

A twin is portable. **Settings → Data → Export Workspace** has a **Twins** scope: tick the twins you want and they ride along in the workspace bundle, one selectable row each. Importing the bundle on the target machine recreates them. The full portability surface (bundle format, import result, conflict panel) is documented in [`settings/README.md`](../settings/README.md#data-portability).

**A twin is always encrypted in transit.** The scope refuses to export without a passphrase of at least 8 characters, and it is not preselected when the export modal opens. Ticking a twin without a passphrase is refused outright rather than quietly thinned; a full-workspace export run without one omits twins and reports that in its warnings rather than failing.

### What travels

| Layer | Notes |
|---|---|
| **Profile** | Name, bio, role, languages, pronouns, training directives. |
| **Tone** | Every per-channel tone row. |
| **Training corpus** | The whole communications log, including the **question** side of each training Q&A. The interview question is stored on the communication row alongside the extracted facts, so both halves of every training pair travel. |
| **Memory inbox** | Every pending memory in **all three statuses** (pending, approved, rejected) together with its reviewer notes. A rejected memory plus the reason it was rejected is signal about your taste, not garbage, so it is kept. |
| **Distilled facts** | Each fact plus its source citations, remapped onto the communications that travelled with it. |
| **Reflections** and **Contacts** | In full. Contacts join by handle, so no id remapping is needed. |
| **Channels** | The binding rows, including which credential and which persona they pointed at. See the caveat below. |
| **Knowledge base** | The bound KB travels **as text**: its documents and its chunk contents. Vectors never travel. |

### What does not travel

- **Voice profiles.** The `twin_voice_profiles` row is not exported at all. The voice layer lost its UI tab in July 2026 and the export treats it as retired, so an ElevenLabs voice config has to be set up again on the target if you use the connector's `get_voice_profile` / `synthesize_speech` tools.
- **The slug.** It is machine-derived from the name and is re-derived on the target.
- **The active flag.** An import never seizes the "which twin am I speaking as" selection on the machine receiving it. An imported twin arrives inactive.
- **The Obsidian subpath.** It points into a vault directory that will not exist on the other machine.
- **The compiled wiki.** `twin_compile_wiki` output is a derived artifact and is regenerated on demand from the layers that did travel.
- **The raw knowledge-base id.** It addresses a row in a different database file that does not exist on the target, and a dangling id is worse than none.

### Two things need attention after an import

**Channels arrive disabled and need a re-link.** A channel's credential and persona ids travel verbatim, but auto-matching them onto whatever happens to sit at those ids on the target machine could post as you to a stranger's Discord. So every imported channel lands with its active flag off and produces a warning naming what to fix, then you re-link and re-enable it in the **Channels** tab. The warning distinguishes the two cases: the credential or persona is genuinely missing here, or it exists and only needs confirming.

**The knowledge base is re-indexed, not shipped.** On import the KB is recreated under fresh ids, rebound to the imported twin, and a background reindex regenerates the vectors on the target machine. That means semantic recall is briefly unavailable right after an import while the reindex runs, and on a build without an embedder the text arrives but stays unindexed. Any KB the twin previously pointed at is reported, never deleted.

A distilled fact whose source communications all failed to travel is **dropped with a warning** rather than written without provenance, since a fact with no evidence behind it is not storable. If only some citations were lost, the fact is kept and the warning says how many of how many survived.

### If the twin already exists on the target

Twins take part in the same two-pass conflict flow as dev projects. A bundled twin that matches an existing one **by name, case-insensitively** (never by slug, which is machine-derived and collides only by accident) is held back on pass 1 and offered to you as **Skip**, **Duplicate**, or **Replace**. **Replace** keeps the existing twin's id, so its slug, active flag, and Obsidian subpath survive; the profile fields are updated and every child layer is cleared and rewritten from the bundle. **Duplicate** lands a wholly new, inactive twin named `<name> (imported)`.

---

## Strongest use case (speculation)

> **A single, portable "how I talk" config that every one of your agents respects — so you scale yourself instead of a fleet of generic LLMs.**

Most multi-agent tools make each persona configure its own voice, tone, and memory from scratch. The result is a workspace full of agents that all sound like *ChatGPT wearing different hats*. Twin inverts that: one profile captures **you** — your bio, your channel-specific tone, your voice, your curated memory — and any persona can adopt it with one setting.

The killer flow:

1. You spend 20 minutes in **Setup**'s training stage answering questions across three topics. The session summaries go straight into the KB.
2. You write a generic **Sales Coach** persona. No tone config, no memory wiring.
3. The Sales Coach has the `Twin` connector enabled. It calls `get_tone("slack")` → gets your Slack voice directives. It drafts a message → sends through the `synthesize_speech` path if voice is configured → you approve → `record_interaction` logs the outgoing message.
4. The next time someone asks the Sales Coach to follow up, it calls `recall_memory("client X")` and finds the approved memory from the earlier interaction. It doesn't just sound like you — it *remembers* the same things you do.

This closes a loop most agent products miss: **the human's voice + the human's memory are first-class, shared resources across every agent the human runs.** Agents don't have to relearn who you are every conversation; they adopt the twin and inherit everything at once.

The compound moat is quiet but strong: you need a desktop app to persist the memory locally (browser agents can't), you need a credential vault to bind ElevenLabs / Slack / Discord on the user's own accounts (vendor SaaS doesn't), and you need an Obsidian bridge so memories are human-editable in a tool people already use (chat-only competitors don't). Personas has all three — Twin is where they combine into a personal identity layer no one else can assemble.

---

## Five development directions

### 1. ElevenLabs voice picker & preview-on-save

There is currently no UI page for Twin voice at all — the `twin_voice_profile` table and its commands (`twin_get_voice_profile` / `twin_upsert_voice_profile` / `twin_delete_voice_profile`) and the connector's `synthesize_speech` / `get_voice_profile` tools are still live in the backend, but the sidebar entry that once pointed at a config form was removed 2026-07-27 (it had drifted out of the `TwinTab` union and rendered a blank page). Rebuilding this as a real tab is a clean-slate opportunity — skip the old paste-an-ID form and go straight to a discovery experience:

- List voices via the ElevenLabs API using the stored vault credential, rendered as a grid with name, accent, gender, and a **Play sample** button.
- A **Test voice** button synthesizes a line from the twin's bio so you can hear how *your* voice + *your* bio combine before committing.
- Save the picked voice *and* the sample audio for regression comparison when sliders change.

This is the difference between "you need to know ElevenLabs" and "you open Twin and pick your voice in 30 seconds."

### 2. Live channel inbox & error surfacing

Channels today is pure CRUD. No signal that messages are flowing, no feedback when a credential expires. Wire:

- Per-channel **last-message timestamp** + an inbound indicator dot (pulse when unseen traffic arrived).
- Per-channel **last-error** badge (auth failed, rate-limited, webhook down) with a retry affordance.
- A slide-out drawer on each channel card that shows the last N messages filtered by that channel, linking back to the Hub feed for deeper inspection.

The Hub already carries the full conversation log; the channel bindings in Setup need to become the operational view of the same stream.

### 3. Wire per-persona twin resolution in the connector runtime

**Wired in commit 871a82c87→…** `twin_get_active_profile(persona_id)` now accepts an optional `persona_id`. When set, it parses the persona's `design_context.twin_id`; if present and the twin exists, it returns the pinned twin. Else it falls back to the globally-active twin. A deleted twin id silently falls back rather than erroring, so a stale `design_context` entry never crashes a persona.

Remaining work for the next pass: thread `persona_id` through the connector tool invocation path so every `get_tone` / `recall_memory` / `synthesize_speech` call on behalf of that persona automatically picks up the override. The frontend `getActiveProfile(personaId?)` wrapper is in place; engine-side wiring of the persona id into the connector context is the follow-up.

### 4. Surface the hidden Twin wiki flows

The backend already exposes three commands the UI never calls: **`twin_ingest_url`** (scrape a URL into the twin brain), **`twin_compile_wiki`** (compile the full twin as a cross-linked markdown wiki), **`twin_audit_wiki`** (AI-audit the compiled wiki for gaps and contradictions). The Hub's sources strip already drives compile and audit; the remaining lift is the ingest and report surface:

- **Ingest URL** input — paste a LinkedIn profile, personal blog, or public bio; the backend scrapes it, strips HTML, and queues facts as pending memories.
- **Compile** button that renders the current twin as a multi-section wiki page (identity, tone samples, voice config, memory highlights, channel inventory) and lets the user download or push to Obsidian.
- **Audit report** that flags missing fields, contradictions between memories, and stale communications — a standing-health view of "how well-formed is my twin?"

These flows already exist in Rust — surfacing them is mostly a UI lift and unlocks serious capability.

### 5. Per-channel memory scoping

Every `twin_communications` row carries a `channel` field; every `twin_pending_memories` row optionally does too. But `recall_memory` doesn't filter by channel, so a memory captured in a private Discord DM can leak into a public email draft. Add scoping:

- When approving a memory, tag it with **default scope** (channel-specific, all-channels, or sensitive/do-not-use).
- Extend `recall_memory` with a `channel` filter: a persona drafting a Slack message recalls only all-channels + slack-scoped memories; a persona on email never sees slack memories unless explicitly requested.
- Surface the scope on the Hub's memory entries so users can re-scope them after the fact.

This is the difference between "a shared brain" and "a brain that understands audience." Given that the `channel` column already exists in both `twin_pending_memories` and `twin_communications`, the migration is trivial and the win is large.

---

## Twin connector — agent-side execution layer

The plugin exposes itself as the builtin connector **`builtin-twin`** (category `personalization`, `min_tier: builder`). The catalog form is built around a **`twin_profile_id` picker** — at modal-open time `ConnectorCredentialModal` notices `metadata.requires_picker === "twin"`, fetches every row in `twin_profiles` via `listProfiles()`, and renders them as `{ value, label }` select options. The user picks one twin and names the binding ("Founder Twin", "Sales Twin", ...). The connector seed lives at `scripts/connectors/builtin/twin.json`.

Multiple bindings per twin are allowed — they're distinct `persona_credentials` rows pointing at the same `twin_profile_id`, and a persona attaches one via `design_context.credential_links["twin"]`. Resolution chain in `twin_get_active_profile`: catalog binding (credential_links → field `twin_profile_id`) → legacy `design_context.twin_id` pin → globally-active twin. A binding whose target profile was deleted silently falls through to the next rule, so a stale binding never crashes a persona mid-execution.

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

Per-persona overrides are wired: the resolution chain in `twin_get_active_profile` honours catalog bindings (`credential_links["twin"]` → credential's `twin_profile_id` field) first, then the legacy `design_context.twinId` pin, then the globally-active twin. The Twin connector now supports true multi-identity — a persona attached to a "Sales Twin" binding sees sales-channel tone and memory; a persona attached to a "Personal Twin" binding sees the personal layer.

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
| `twin_setup_turn` | One turn of the guided Setup conversation: the next question, its suggestions, and any typed proposals for real fields, plus an advisory `doneHint` the flow never treats as authority |
| `twin_generate_bio` | CLI-backed free-form completion (used for Setup bio generation, training Q generation, follow-ups, session summaries) |
| `twin_ingest_url` | Scrape a URL and queue extracted facts as pending memories |
| `twin_compile_wiki` | Compile the full twin as a cross-linked markdown wiki (surfaced in the Hub's sources strip) |
| `twin_audit_wiki` | AI-audit the compiled wiki for gaps / contradictions (paired with compile in the Hub's sources strip) |

## Reference: frontend modules

```
src/features/plugins/twin/
├── TwinPage.tsx                        # tab host for the three routed tabs; redirects a persisted retired id
├── TwinEmptyState.tsx                  # shared empty state for a tab with no active twin
├── useTwinReadiness.ts                 # the readiness milestones every surface reports against
├── shared/twinStatus.ts                # ONE status + slot vocabulary, and the focus-to-slot join
├── shared/channels.ts · gender.ts      # channel metadata, pronoun/gender table
├── sub_profiles/                       # the roster: ProfilesPage, ProfilesAtelier, TwinCard, TwinSlotStrip
├── setup/                              # the guided build
│   ├── SetupPage.tsx                   # wiring only: session hook + voice hook + shell
│   ├── SetupShell.tsx                  # permanent chrome: stage, readiness strip, switcher, voice, fields, studio
│   ├── setupContract.ts                # the wire contract every variant renders against
│   ├── useSetupSession.ts              # the flow engine behind `twin_setup_turn`
│   ├── useSetupVoice.ts                # dictation + speech overlay
│   ├── SetupReadinessRow.tsx · SetupProposalRow.tsx · SetupFieldsDrawer.tsx
│   └── variants/                       # Conversation · Desk · Orbit · Canvas + registry.ts
├── hub/                                # the feed
│   ├── HubPage.tsx · HubShell.tsx      # counts, sources strip, switcher, variant body
│   ├── hubContract.ts · useHubFeed.ts  # the feed contract and the one hook that loads it
│   ├── HubEntryRow.tsx · HubEntryActions.tsx · HubSourcesStrip.tsx
│   ├── ReplyLane.tsx                   # composes sub_channels/{ReplyOutbox,SentReplies,ContactThread}
│   └── variants/                       # TriageDesk · River · BrainMap · Contacts + registry.ts
├── sub_channels/                       # ReplyOutbox, SentReplies, ContactThread (composed by ReplyLane)
└── sub_training/TrainingStudio.tsx     # the batch authoring board, opened from SetupShell
```

```
src/features/agents/sub_settings/
└── TwinBindingCard.tsx                 # persona editor: pin a twin to a persona via design_context.twinId

src/stores/slices/system/
└── twinSlice.ts                        # Zustand slice: profiles, tones, memories, comms, voice, channels

src/api/twin/
└── twin.ts                             # thin invokeWithTimeout wrappers around twin_* Tauri commands

scripts/connectors/builtin/
└── twin.json                           # builtin-twin connector seed (twin_profile_id picker, requires_picker:"twin", min_tier: builder)
```

All copy lives under `t.twin.*` in the canonical locale bundle at `src/i18n/locales/en.json` (feature-scoped i18n directories were retired in the 2026-05-08 i18n consolidation pass). The `TwinBindingCard` in the persona editor reads/writes `design_context.twinId`, which is typed as `twin_id: Option<String>` in the Rust `DesignContextData` struct (`src-tauri/src/db/models/persona.rs`). Sidebar navigation for the three tabs is defined as `twinItems` in `src/features/shared/chrome/sidebar/sidebarData.ts`; the `TwinTab` union itself lives in `src/lib/types/types.ts`.
