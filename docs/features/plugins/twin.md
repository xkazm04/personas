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
| **Detail** (tab id `setup`) | Where the twin stands, drawn as a **blueprint** (see [The Twin Detail page and the blueprint](#the-twin-detail-page-and-the-blueprint)), and the two ways into the table where everything you *tell* the twin — identity, tone per channel, channels, memories — is gathered by a guided conversation with a typed escape hatch behind it. The id stayed `setup` so no route, persisted tab or slot jump changed; the label reads **Detail** (2026-10-01). |
| **Hub** | Everything the twin has *learned or said* — one feed of pending memories, messages, distilled facts, reflections and people, plus the reply loop. |

> **Setup is one surface; so is the Hub.**
> Setup went through two contests over the *same* `SetupSessionApi`. The first
> (four renderers) was won by the Desk; the second (four takes on "create a
> twin, then train it", 2026-09-21/24) was fused into the one card-table
> experience under `experience/`, and everything else — the Desk, its shell and
> switcher — was deleted (see `experience/FUSION.md`). The Hub did the same over
> `HubFeedApi`: the Desk won there, and River, Map and Contacts were deleted with
> their switcher and with the `twin-variant:hub` preference that remembered
> them; nothing those three could reach left with them — each became a **lane**
> on the Desk (see §3).

### 1. Profiles — manage twins

1. Open **Plugins → Twin → Profiles**.
2. Click **New Twin**, give it a name (e.g. *Founder Twin*) and a gender, and optionally **start from a style**: one of the ten presets, **Surprise me** (roll three candidates), or Skip. The dialog only records that choice. The first twin created is auto-activated, and creating one drops you straight into **Setup**; when a style was chosen, Setup opens on **Fields** with the Style studio already running it.
3. The active twin's hero card shows its Obsidian subpath and three actions: **Set active** (checkmark), **Edit** (pencil), **Delete** (trash). On the smaller **satellite** cards, clicking anywhere on the card body activates that twin; Edit and Delete remain as explicit hover buttons. Deleting a profile removes only the row — Obsidian files are untouched.
4. Along the bottom of each card sits the **slot strip**: Identity / Tone / Brain / Memories, one segment each. A segment carries its status as colour *and* as shape (a filled disc, a half disc, an empty ring) so it reads without colour. Pressing one activates that twin and opens the tab that owns the slot — Identity and Tone open **Setup**, Brain and Memories open **Hub**. That routing is declared once, in `shared/twinStatus.ts`.
5. Whenever you close a milestone — the active twin's readiness score climbs — a brief **success toast** celebrates the progress, with a distinct "your twin is fully trained — 100% ready" message when the final milestone lands. (A short window after switching twins suppresses the toast so the initial data-load ramp isn't mistaken for progress.)

### 2. Detail — the blueprint, the table, and the plan behind it

Setup gathers everything you *tell* the twin through one planned interview.
The governing rule: **the generator proposes CONTENT; the flow owns
STRUCTURE.** An LLM writes the questions and drafts values, and it is never the
authority on whether you are finished: **`deriveReadiness` is the only
completion authority.** Goal coverage (below) only steers which question comes
next, and a generator failure leaves a slot open rather than reading as done.

**The Detail tab is the twin's blueprint, and nothing opens by itself.**
However you arrive — the sidebar, a slot jump from Profiles, a retired-tab
redirect, or an app restart that restores the tab — Detail shows the twin
drawn as a blueprint under a header with its sigil, name, role and readiness
percentage, and two buttons, **Carry on setting up** and **Start a training
round**. Only those two buttons, **Edit in setup** in a section's detail drawer
(and creating a twin from Profiles) open the table. The page reads, it never
opens a setup session: a visit cannot start a paid plan. Until 2026-09-24
arriving on the tab opened the overlay on mount, so every visit — including a
restart — dropped you into a fresh generator turn; from then until 2026-10-01
the tab was a single launch card with the readiness percentage and the two
buttons. The page itself is described in
[The Twin Detail page and the blueprint](#the-twin-detail-page-and-the-blueprint).

**The table** is a framed overlay played **on the twin's blueprint**: the
selected blueprint variant fills the play area (it replaced the felt and the
readiness strip, and draws readiness itself), and the hand floats over it — the
question card, a fan of up to three answer cards (digit keys pick, `Enter`
plays, `E` edits into the composer, `S` skips), the offers, a composer for your
own words, and the trail of what was played. While no question is live, no card
is dealt: the blueprint is the waiting surface. Each answer plays a short
**beat** on the blueprint before the next card (see
[The answer beat](#the-answer-beat)). Pressing a section of the blueprint opens
the door that edits it. A *write* question (a reply drill, "paste the last
message you sent") shows the message you are replying to and has no cards: the
answer is kept word for word as a writing sample. The stage control switches
between *Setup* and *Training*; in Training, *What to train on* lists the
topics with their coverage and the number of answers on the plan, and you pick
one. Voice is an overlay on the same flow: dictation fills the composer as a
preview, hands-free reads the question aloud and submits finals.

**The plan is persisted.** Each twin has ONE plan (migration `e47`, five
tables), owned by the Rust engine (`engine::twin_setup`):

- **goals per slot** — the slots are fixed in code: *identity, tone, channels,
  memories* for setup, and one per training topic preset for training. The
  model fills them with goals (a title, an intent, two to four criteria that say
  what "covered" means; at most four per slot), each with a coverage reading;
- **a queue generated ahead** — three questions queued for the current stage,
  behind the live one, each pointing at a goal;
- **the transcript** — every answered or skipped question, the offers each one
  produced and their verdicts, and up to eight observations on how you answer.

Closing the overlay, switching tabs or restarting the app loses nothing:
reopening reads the stored snapshot and makes **no LLM call** — the same live
question, cards, offers and trail come back.

**Answer → next question, instantly.** An answer is one database transaction:
the question is recorded, the next queued question goes live, and both come
back in the same call — nothing waits on a model. Only the live question can be
answered, so a stale or doubled answer (a second click, hands-free voice) is a
no-op. **Skip** records the question as declined and never stores a value. A
training answer is saved as a message plus a pending memory tagged with its
topic; a *write* answer becomes a tone-example offer in your own words.

**Reconcile runs behind you.** After each answer two **Sonnet 5.5 calls at
low effort run in parallel**, and each is applied the moment it returns:
*refill* tops the queue back up to three, so its question can go live before
*assess* lands; *assess* scores each goal's coverage against its criteria,
offers any field value the answer supports, may queue one follow-up at the head
of the queue, may note an observation, and stores its few-word reason per goal
(the step's `coverageGain`, the goal's `lastWhy`, which the blueprint shows
after the answer). The follow-up therefore shows one question later, not
instead of the one already dealt. A goal stops receiving questions at 0.8
coverage or after three answers with no gain; a failed assessment is retried
once and then let go, so a question never loops.

**Deep re-plan.** A **Sonnet 5.5 pass at low effort** writes the first plan
and revises it every ~5 answers, on a stage change, when a stage's queue cannot
be refilled twice in a row, or when you press **Rebuild plan**. Low is for one
effort across the whole engine, not for speed: a 2026-10-01 bench measured no
gain from medium, because output volume dominates. It runs in its own lane, so
answers keep being assessed and refilled beside it, and whenever a stage has
nothing to ask while a deep pass is starting or running, a one-question call
(`setup_first`) puts a question up within seconds. A later plan may retire a
question it finds redundant. It may rewrite goal text and the question path; it
never adds or removes a slot, and never touches a goal you dropped or pinned or
the question in front of you. An idle twin costs nothing: work starts only on an
open without a plan, an answer, a skip, a steer or a rebuild.

**The Plan layer** is the first door off the table (the route icon): the plan's
status (*building*, *ready*, or *failed* with **Try again**), what the last
re-plan changed, the goals grouped by phase with a coverage bar, **pin /
unpin**, **drop / restore** — the engine respects your moves — the next three
questions under *Up next*, each with **Ask this next**, *What I have noticed*
(the observations), and **Rebuild plan** — a fresh deep pass over everything on
file that keeps the transcript and memories. The other doors are *What it
knows*, *What to train on* (Training only), *Voice* (the style studio) and
*Fields* — the typed editor, which works without the generator and is the way
through when it is down.

**Offers "from your last answer".** The values reconcile proposes (a bio, a
role, a tone voice or rule for one channel) arrive live in the current
question's offers under a *From your last answer* caption, each with **Accept /
Edit / Dismiss**. Nothing is written until you keep it, nothing is written on
silence, and the verdict is stored, so a resolved offer keeps its verdict across
a reopen and never comes back.

**Every twin LLM call is on the spend ledger.** The setup engine's three calls
and the older twin generators (bio, simulated answers, drafts, the studio, the
wiki, reflections, styles) all go through one logged, time-limited spawn that
writes a `dev_llm_spend` row with `source = twin` and `trigger_kind` naming the
call site (`setup_plan`, `setup_assess`, `setup_refill`, `generate_bio`, …).
**Every twin LLM call runs lean**: `--tools "" --strict-mcp-config
--disable-slash-commands`, in an empty working directory, because a twin call is
one prompt in and one text reply out. Measured 2026-10-01 on a refill-sized
prompt: 8.6 s to 6.5 s wall, 27k to 5k context tokens, 4-8x cheaper; the CLI
loads 0 tools, 0 MCP servers and 0 skills instead of 37 / 1 / 68. The setup
engine runs on Sonnet 5.5 at low; the older sites keep Sonnet at medium.

**One prompt compiler.** Every drafting lane (reply drafts, browser page drafts,
training answer simulation and the setup guide's suggested answers) embeds the
same core block, built by `compile_twin_core` in
`src-tauri/src/engine/twin_prompt/`: who the person is, the languages they
write, their standing directions, their voice on the resolved channel (the
channel asked for, else `generic`, else the first; up to five of their own
newest messages and up to eight do/don't rules), what they have confirmed about
themselves, and the plain-voice quality rules (with per-person allowances: a
person who uses clause dashes, or opens with "Thanks", is not told not to).
Each lane keeps only its own framing around it: the thread being answered, the
fenced page, or the question. Drafts therefore see exemplars and rules on the
page lane too, follow the quality rules in replies and page comments, and never
treat a fact about a contact as a fact about the person. The same compiler is
the reference renderer of Twin Card 1.0 (`docs/standards/twin-card/1.0/RENDERER.md`).

#### Studio mode (batch authoring, both sides)

> **Not reachable at the moment.** `sub_training/TrainingStudio.tsx` and its `twin_studio_*` commands still exist, but nothing mounts the studio since the 2026-09-24 experience fusion deleted the shell that opened it. What follows describes the component as written.

- **Directions + topic** at the top steer the whole batch ("focus on failure stories", "keep questions short"). The **bookmark** button next to Directions saves them as the twin's **persistent training style guide** (`training_directives`): once saved, those directions are seeded into the box every time you open the Studio for this twin *and* automatically prepended to every question and answer generation, so the studio learns your taste instead of you restating it each session. A per-request note (e.g. a regenerate comment) still layers on top of the saved style.
- **Generate questions** runs a background batch (`twin_studio_generate_questions`) that fills the board with editable question rows (the "user simulation" side). Curate them inline — edit, add your own, or remove.
- **Draft all as twin** runs the long background pass (`twin_studio_generate_answers`) that drafts an answer *as the twin* for every question (the "twin simulation" side); a per-row **Draft** button drafts a single answer on demand. Each draft is editable and flagged **twin**; a word-count pill (thin / ok / rich) is a lightweight quality signal. When the twin has a bound knowledge base, each batch answer is grounded on the KB passages that best match its question — close-match-filtered, token-budgeted, one retrieval per question — so the batch trains on answers the twin's own brain informed rather than ungrounded guesses. Each item records a `kbGrounded` provenance flag; with no KB bound (or `ml` off) the answer grounds exactly as before.
- Both passes run in the **background** so you can gather a large batch and walk away: a progress bar tracks the answer pass, the sidebar shows a progress dot at every level (Plugins → Twin → Setup), and an **OS notification fires when the batch is done**. Cancel any time.
- A per-row **check** marks a pair for saving; **Save N selected** writes only the approved pairs as pending memories (the same review gate the Hub applies). The human always reviews before anything is saved.

#### Styles: ten presets and a randomizer

Most people cannot write their own tone of voice from a blank box, so the
**Style studio** at the top of the Fields page's Tone band offers a starting
point. A style is **eight dimensions on a 1 to 5 scale**: formality (intimate to
ceremonial), warmth, humor, energy, length, directness (blunt to indirect),
expressiveness (emoji, exclamations, slang) and detail. The set is distilled
from the Nielsen Norman Group's tone-of-voice dimensions, Joos's five registers,
the Big Five, high/low-context communication, and the style presets that
Apple Writing Tools, Claude, ChatGPT and the Microsoft and Mailchimp voice
guides ship.

- **Ten curated presets** span the range: Executive brief, Polished
  professional, Consultative expert, Plainspoken and direct, Warm and helpful,
  Friendly casual, Empathic listener, Upbeat cheerleader, Witty and wry, Close
  and informal. Each card shows its dimensions, one line on what it never does,
  and the same fixed message ("could we move Thursday's meeting?") answered in
  that style, so the gallery compares like with like. Two combinations are
  excluded on purpose, because research ties them to lower trust: every axis at
  an extreme, and playful humor on a ceremonial register.
- **Roll 3 styles** is the randomizer. Rust draws three spread, coherent
  starting points (a model asked for randomness collapses to one favourite),
  the model may move each by one step to fit the twin's bio, names them and
  answers the sample message. Pin any dimension ("keep it formal") and a reroll
  holds it while the rest varies; styles already seen this session are avoided.
  Rolled styles carry a **Rolled** badge and never pass for a preset.
- **One base, shifted per channel.** Picking a style resolves each bound channel
  deterministically before the model sees it: email one step more formal and
  less expressive, chat channels one step less formal, SMS shorter, voice with
  no emoji. One LLM call (`twin_style_materialize`) then writes voice
  directives, three example messages and "always/never" constraints for every
  channel in the twin's own language; the length hint follows the length
  dimension.
- **Nothing is written until you accept.** The preview lays the current and the
  proposed tone side by side per channel, with a checkbox each; Accept writes
  the ticked channels in one transaction and leaves the others untouched. Each
  tone card then says what it was based on ("Based on Polished professional",
  or "Rolled: Quiet Precision") with its dimension chips, and keeps saying so
  after you edit the text by hand.

Examples and constraints now reach the model. Until this change
`twin_draft_reply` and the Training Studio's twin simulation read only the voice
directives and the length hint, so the examples and rules stored on a tone were
never used. Both now render up to three examples and eight constraints under
the directives.

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
actions). A fetch never replaces any of it, and a failure is announced as a
failure rather than dressed up as "no data".

**The reactions** on a reviewable entry are **Approve**, **Dig deeper**
(approves *and* queues follow-up questions for the Setup training stage) and
**Reject**. Rejecting asks for one of six reasons (off-brand, inaccurate, too
long, wrong tone, risky claim, too private) and **supersedes** the entry — the
row stays as a record wearing its verdict, because a rejection plus the reason
for it is signal about your taste, not garbage. A message can be saved as a
distilled fact; facts and reflections can be deleted.

**The Desk and its four lanes.** The Hub is one surface: a triage desk with a
compact lane strip above it. Every lane derives from the SAME `HubFeedApi`
snapshot the shell already loaded, so switching lanes costs no query, and the
three lanes that hold feed entries **partition** it — every entry is in exactly
one, never two, never none.

| Lane | What it holds | The badge |
|---|---|---|
| **Queue** (default) | The triage desk itself: pending memories and audit reports, one framed at a time, with the buffer of what is still open at the left. Approve / Dig deeper / Reject are bound to `A` / `D` / `R`, the reject reason to `1`–`6`, the arrows move, and the legend is always on screen. The exit carries the verdict's direction, so it reads as filing rather than deleting. | pending |
| **History** | Everything already filed, newest first: approved and rejected memories wearing their verdict and its reason, plus the message log. A verdict filter (all / approved / rejected) sits above it; a message carries no verdict, so it drops out of the two verdict filters rather than pretending to satisfy one. The list caps at the newest 300 and says so. | approved + rejected + messages |
| **Knowledge** | What the brain *produced*: the distilled facts and the reflections, one newest-first list because each row already wears its kind as a glyph. The one write the lane offers is a reflection seed — type a topic, and the twin's answer is filed at the top. | facts + reflections |
| **Replies** | The reply lane below, plus a chip row of the twin's contacts that scopes it: picking one opens that person's cross-channel thread as reply context. | none — its rows are not feed entries |

Rows in History and Knowledge carry the same inline affordances the rest of the
desk offers, so a message can be saved as a fact from the row it is read on, and
a fact or reflection can be deleted where it sits.

**The reply lane** is the Replies lane's body — the operational draft → review → log
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

The same voice reaches the **Browser** webview: while a page input is focused,
the Browser can ask the twin to draft the comment the user would post there
(`twin_draft_for_page`, channel `browser`). It grounds on the twin's `browser`
tone register, falling back to `generic` when none is configured (the response
says which one applied). Every string picked from the page — the main post,
the comment being replied to, earlier comments, the highlighted text — is
capped and wrapped in nonce-fenced, provenance-labelled blocks the prompt
declares as untrusted DATA, never instructions; a draft that echoes a fence is
discarded as an injection trip. Only the user's own started text sits in the
trusted frame. Inserting the draft is recorded as a `browser` placement, not a
send: the page's own button is the gate and the app never sees it pressed, so
the row carries `{"kind":"placement"}` in `key_facts_json` and the Sent replies
list and per-channel send counts leave it out (`src/api/twin/placement.ts`).
Like every outbox reply, it is never learned from.

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

## The Twin Detail page and the blueprint

> Spark `twin-portable-blueprint`, 2026-10-01 (WP6: the page shell, the model,
> the training overlay and the beat). The four renderers are their own work
> packages; the engine, sample and Twin Card parts of the same spark are
> documented in their own sections.

The **Detail** tab (id `setup`) shows the active twin as a **blueprint**: four
hardcoded sections, **Identity**, **Voice**, **Knowledge** and **Training**,
with readiness folded in, drawn as graphs and quantities rather than text. The
same blueprint is the base layer of the training overlay, so the picture you
read on the page is the one your answers move.

### Three layers

| Layer | What it is | How you get there and back |
|---|---|---|
| **L1** | The blueprint overview, at full type size. A section that has nothing to measure yet draws its hatched *not drawn yet* state; a new twin is never a blank page. | Arriving on the tab. |
| **L2** | One section zoomed inside the variant's own metaphor. | Press a section. **Escape** (or the variant's back control) returns to L1. |
| **L3** | A right-hand drawer with the section's full, read-only detail: Identity (name, role, languages, the bio), Voice (per channel: where the voice came from, directives, length, the writing samples and do/don't rules, the eight style dimensions), Knowledge (memories by review state, the latest approved by title, self-facts, the knowledge base), Training (answers, last trained, the plan's goals with what counts as covered, coverage and the last reason, topics with approved and awaiting answers, question kinds, observations, the last answers). It ends with **Edit in setup**, which opens the table at the door that edits the section: Identity the sheet, Voice the style studio, Knowledge the fields editor, Training the plan. | Asked for by the blueprint (a section's detail control, or an item in it: a channel, a topic, a goal, shown first). **Escape** closes the drawer first; a second Escape leaves L2. |

The header carries the sigil, name, role, readiness percentage, the two CTAs
(**Carry on setting up**, **Start a training round**), a **"N to review"** chip
when learn-from-sample proposals are open (it opens the Hub; hidden while the
count is unknown or zero), the **Export** menu (Twin Card / Character Card V3),
and the **blueprint style** switcher.

### Where the numbers come from

`blueprint/useTwinBlueprint.ts` builds one `TwinBlueprintModel`
(`blueprintContract.ts`) from what the app already holds and a handful of pure
reads:

- the store's profile, tones, bound channels and approved memories (readiness
  is `deriveReadiness`, the same number every Twin surface shows);
- the setup snapshot through **`twin_setup_get`**, a pure read. The page never
  calls `twin_setup_open` and never mounts `useSetupSession`, because an open can
  start a paid deep plan;
- memories by status, distilled facts (self-facts only: a fact about a contact
  is about someone else), the tagged training answers (topic coverage, approved
  versus awaiting review), and the open sample proposals.

A read that fails leaves its count `null`, drawn as *not measured*, never as
`0`; the sample commands answer "not built" until the learn-from-sample backend
is in, which the page treats as absent. A refresh keeps the drawing on screen
while it reads. The page re-reads when the engine reports progress
(`twin-setup-updated`), when a sample is analysed (`twin-sample-updated`, both
attached through the buffered singleton listener), and when the experience
overlay closes over it.

### Four prototype variants

Four renderers compete behind the switcher, each a lazy chunk implementing the
same props: **Drafting sheet**, **Strata**, **Dossier** and **Radial**. The pick
is persisted (`twin-blueprint-variant`) and the training overlay reads the same
pick, so judging a variant judges both surfaces at once. This is a prototype
round (`TODO(prototype, 2026-10-01)`): the owner picks or fuses from the running
app, and the losing variants and the switcher are deleted in that round.

### The training overlay

In both stages, *Setup* and *Training*, the play area is the blueprint in
`stage` mode (`BlueprintStage`) and the hand floats over it (`StageHand`,
`CardTable`): the question card, the fan, the offers and the composer in one
centred column on a soft band of background, so the drawing never runs through
the question and stays readable to either side. Clicks outside the column reach
the blueprint; pressing a section opens its door. While no question is live the
hand is not dealt at all and the blueprint is the waiting surface; there is no
ghost card. The table keeps its one always-mounted status region.

The overlay's blueprint keeps its own copy of the setup snapshot through
`twin_setup_get`, re-read on every signal the session exposes (a new question,
a reconcile starting or finishing, a new plan, a stage switch): the session's
snapshot itself is private to `useSetupSession`. Each is one local read.

A request to open the overlay can name a **door** (`openTwinExperience({ mode:
'train', stage, door })`); the overlay opens with that layer already up. The
*What to train on* layer's header figure is the number of answers on the
plan's goals; it used to count `session_summary` rows that only the retired
interview wrote, so it read 0 for every twin trained on the table.

### The answer beat

On an answer the hand lifts off the table, the blueprint plays what that answer
changed (the topic, the question kind, the goal and the channel, known at once)
for about **two seconds**, and only then is the next card dealt; **any key**
during the beat deals at once (Escape, Tab and lone modifiers excepted, and the
key never plays the card it reveals). When the reconcile pass later scores the
answer (the step's coverage gain and the goal's reason, on the wire once the
engine sends them), the blueprint animates that in place around whatever card
is up, and replays it at the start of the next lift, before the new answer's
own delta. With reduced motion the hand fades instead of travelling, nothing is
replayed, and the beat is 600 ms. A skip is not a beat.

### Seeing it without the app

The page harness mounts the real route on synthetic data:
`node scripts/style/shoot.mjs --module twin/detail --tape synthetic` (the
Detail page) and `--module twin/stage` (the overlay on the training stage, the
live card played by the surface so the hand lifts over the scored answer); add
`--kit <variant>` for a variant other than Drafting sheet. The fixture-only
renderer surfaces are `twin/blueprint/*`. Shots and their README:
`docs/design/twin-blueprint/`.

---

## Learning from your own writing, and carrying a twin as a file

**Learn, review, carry.** In Browser > Webview, the Twin toolbar's **Learn**
icon reads your highlighted text, or the clipboard once if the page cannot be
read or nothing is selected, capped at 8,000 characters. You then choose
**Teach <twin>**, **New twin** (opens the forge with the sample; the new twin
learns from it right after creation, recorded as a `forge` sample), or
**Cancel**. The analysis never writes anything directly. It files proposals (a
writing sample, a voice rule, a do or don't, a length hint, style settings)
that appear in **Hub > Queue** under "Learned from samples", each labelled with
its channel and where the sample came from, with **Keep / Edit / Dismiss**.
Facts about you arrive in the same queue as memories marked "From a writing
sample". **Import twin** (Profiles, beside New twin) inspects a Twin Card before
writing anything: version, validity, signature (signed, unsigned, or not
matching), and each part (sealed, or changed since export). It asks for the
passphrase when a part is sealed and asks what to do when the name already
exists (import as a copy, replace, or skip). **Export** (Detail header) chooses
the parts (voice is always included), an optional passphrase of at least 8
characters that seals self-knowledge and training, and the format (Twin Card or
Character Card V3), and says when the file was saved without a signature. The
format is specified in `docs/standards/twin-card/1.0/`.

**Under the hood: learning from a sample.** `twin_learn_from_sample` stores the
sample (trimmed, at most 8,000 characters, source `selection`, `clipboard` or
`forge`) as `analyzing` and returns at once. A per-twin single-flight lane
(`engine::twin_sample`) analyses it in the background and announces every
change with `twin-sample-updated`, sent to the main window only and never
carrying sample text. Before any model call, a sample that matches text the
twin wrote itself (a browser placement or an approved outbox reply; exact after
whitespace and case are normalized, or one containing the other when the
shorter side has at least 20 characters) is refused: a twin never learns from
its own output. The analysis is one `TwinCall::SAMPLE_LEARN` call (Sonnet 5.5,
low effort, lean CLI, 120 s) through the setup engine's repair door, prompted
with the twin's core block from the prompt compiler, the voice on file, the
channel vocabulary and the eight-dimension scale, with the sample fenced as
data. A sample the model judges is not the person's own writing is refused
with its reason. Otherwise, in one transaction, the sample becomes `ready` and
files open proposals for its channel, skipping what the channel already holds:
the sample word for word as an exemplar (unless it was cut), replacement voice
notes, up to four new rules, a length line, and the eight style dimensions
(dropped if incoherent). Self-facts go to the pending-memory queue (channel
`sample`). Nothing changes until a proposal is resolved: accepting writes
exactly one column of the channel's tone row (creating the row if needed) in
the same transaction as the verdict, and accepted dimensions are stored as a
style whose source is `learned`. `twin_clipboard_text` reads the clipboard once
per press; `browser_webview_capture_selection` reads the highlight through the
operator-only `page_selection` hand, on whitelisted origins only.

**Under the hood: Twin Card export and import.** `twin_card_export`, `twin_card_inspect` and `twin_card_import` (`commands/infrastructure/twin_card/`) implement Twin Card 1.0 as specified in `docs/standards/twin-card/1.0/`. **Export** builds the card from the database: identity (name, role, bio, languages, grammatical gender from the pronouns token; "neutral" travels as `null`), voice (one channel per tone row, with its style, directions, length hint, do-and-don't rules and writing samples newest first; the quality rules with this person's own dash and filler-opener allowances; the standing directions), and on request knowledge (approved memories and self-facts), training (goals with coverage in per-mille, every answered setup question of both stages plus answers the old Training Studio recorded, observations) and evidence (sample counts per channel, coverage per section using the blueprint's formulas, readiness, answer count, last trained). No other person's data ever enters a card: no contacts, no inbound messages, no facts about a contact, and no approved memory that was queued from a conversation with someone else. A field longer than the schema allows stops the export and names what to shorten; an over-long item in a list (one sample, one memory) is left out with a warning. Every part is hashed (SHA-256 over RFC 8785 canonical JSON) before anything else happens. With a passphrase of at least 8 characters, knowledge and training are sealed (AES-256-GCM, PBKDF2-HMAC-SHA256 at 600,000 iterations, a fresh salt and nonce per part); identity, voice and evidence never are. The card is then signed with the device's Ed25519 identity (the key the `.persona` bundle uses) in builds that have one; a build without P2P writes the card unsigned, and the export says so. The file is written next to its destination and renamed into place, so a failed export leaves no partial file. The **Character Card V3** format wraps the same card under `data.extensions["twin-card"]` and adds a name, description, personality (the generic channel's style in the scale's words), example messages and a `system_prompt` rendered by the twin prompt compiler; a sealed knowledge part contributes no facts to that plaintext prompt. **Inspect** reads a card (or the card inside a Character Card V3) without writing anything: version support (major 1; a newer major is reported as unsupported, not invalid), validity against the schema compiled into the app, each part's hash (a sealed part only when the passphrase is given), and the signature (valid, invalid, or unsigned; a build without P2P cannot check a signature and shows it as unsigned with a note). **Import** refuses an unsupported or invalid card, unseals every sealed part first (a wrong or missing passphrase fails before anything is written), refuses the whole card when its identity was changed, and otherwise skips any part whose hash no longer matches, with a warning. It then writes the twin in one transaction under a fresh id and slug: the profile, the channel voices, the approved memories (keeping when they were observed), the self-facts (citing the card they came from), and the training record under a ready plan (answers stored as already-reconciled steps, so nothing is re-analysed). A name already in use (ignoring case) is resolved by the choice made in the dialog: a copy named "Name (2)", a replacement (the old twin and everything under it is deleted; the new one takes over its active flag), or skip. An imported twin becomes active only when it replaces the active twin or is the first twin there is. What Personas cannot store is dropped with a warning rather than approximated: a hand-set style, where each sample came from, a channel's provenance. Exporting an imported twin reproduces the identity, voice, knowledge and training parts of the card it came from byte for byte.

The Settings workspace bundle (below) keeps its own sealed twin format; a twin
imported from a card and later carried in a workspace bundle loses the facts
that cite the card (`twin-card:<id>`), because the bundle remaps fact sources to
communications. Known follow-up.

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
| `twin_style_roll` | Roll 3 candidate communication styles (Rust-sampled anchors, pins held, seen styles avoided); preview only |
| `twin_style_materialize` | Write voice directives, examples and constraints per channel for a chosen style; preview only |
| `twin_style_apply` | Write the accepted per-channel drafts in one transaction, stamping each row's `style_json` |
| `twin_setup_get` | The stored setup session snapshot (plan status, goals, live question, queue, transcript, offers, observations). A pure read |
| `twin_setup_open` | Open or resume the setup session: ensures a plan (starts the deep pass if there is none, it failed, or its lease went stale) and a live question (the queue's head, else the code-written opener). No LLM call on the call path |
| `twin_setup_answer` | Answer (or, with a null answer, decline) the LIVE question: records it, puts the next queued question live, returns at once, and schedules the background reconcile |
| `twin_setup_steer` | Plan-layer and table moves: drop / pin / restore a goal, ask a queued question next, set the stage or training topic, focus a slot, enqueue handed-over questions, redeal |
| `twin_setup_offer_verdict` | Record accepted / edited / dismissed for one stored offer (the field write itself stays on the existing twin commands) |
| `twin_setup_rebuild` | A fresh deep pass over everything on file; transcript, memories and observations are kept |
| `twin_generate_bio` | CLI-backed free-form completion (used for Setup bio generation, training Q generation, follow-ups, session summaries) |
| `twin_draft_for_page` | Draft the comment the user would post into a Browser page input, in the twin's voice; page text is nonce-fenced as untrusted, returns `{ draft, toneChannel, kbGrounded }` |
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
├── blueprint/                          # the Detail tab and the blueprint (spark twin-portable-blueprint)
│   ├── TwinDetailPage.tsx              # the `setup` tab: header, variant switcher, the blueprint at L1/L2, the L3 drawer; never opens the overlay or a session
│   ├── DetailHeader.tsx                # sigil, name, role, readiness, the two CTAs, proposals chip, Twin Card export menu
│   ├── SectionDetailDrawer.tsx · detail/  # L3: one section's full read-only detail + "Edit in setup"
│   ├── blueprintContract.ts            # the model + variant props every renderer builds against (frozen)
│   ├── useTwinBlueprint.ts · blueprintModel.ts · blueprintVoice.ts  # reads (store + setupGet + counts) -> TwinBlueprintModel
│   ├── blueprintDelta.ts · useAnswerBeat.ts · beatMotion.ts  # what an answer changed, and the beat that plays it
│   ├── BlueprintStage.tsx · StageHand.tsx · useStageBlueprint.ts  # the training overlay's base layer and the hand over it
│   ├── variantRegistry.ts · blueprintVariant.ts  # the four renderers (lazy chunks) and the persisted pick
│   └── variants/{drafting,strata,dossier,radial}/  # the four prototype renderers
├── experience/                         # the card-table overlay (see FUSION.md)
│   ├── TwinExperienceHost.tsx · ExperienceBody.tsx · launcher.ts  # the overlay, its layout, the one way to open it (`door` opens a layer on arrival)
│   ├── table/                          # CardTable · DealerCard · DecisionFan · ProposalFan · TableChrome (the doors) · TableComposer · TableTrail · useTurn
│   ├── layers/                         # PlanLayer · PlanGoalRow · SheetLayer · DeckLayer · VoiceLayer · FieldsLayer · LayerFrame
│   └── forge/                          # creating a twin: ForgePhase, the style fan and preset dialog
├── setup/                              # the session engine client and the typed editor
│   ├── setupContract.ts                # the render contract the table and layers consume
│   ├── useSetupSession.ts              # a thin client over the persisted snapshot (`twin_setup_*`, `twin-setup-updated`)
│   ├── useSetupVoice.ts                # dictation + speech overlay
│   ├── SetupReadinessRow.tsx · SetupProposalRow.tsx · SetupVoiceControls.tsx
│   ├── SetupFieldsPage.tsx             # the typed editor behind the Fields door
│   ├── fields/                         # IdentityFields · ToneFields · ToneChannelCard · SetupFieldsSection · SetupTextField · SlotSummary · toneParts.ts
│   ├── style/                          # Style studio: stylePresets.ts (10 presets) · channelShift.ts · useStyleStudio · StylePanel and its gallery, candidates, preview
│   └── desk/trailModel.ts              # maps the transcript onto the trail
├── hub/                                # the feed
│   ├── HubPage.tsx · HubShell.tsx      # counts, sources strip, then the desk
│   ├── HubDesk.tsx                     # the one Hub surface: the lane strip + the active lane
│   ├── hubContract.ts · useHubFeed.ts  # the feed contract and the one hook that loads it
│   ├── HubEntryRow.tsx · HubEntryActions.tsx · HubSourcesStrip.tsx
│   ├── ReplyLane.tsx                   # composes sub_channels/{ReplyOutbox,SentReplies,ContactThread}
│   └── desk/                           # laneModel.ts · QueueLane · QueueFrame · HistoryLane · KnowledgeLane · RepliesLane
├── sub_channels/                       # ReplyOutbox, SentReplies, ContactThread (composed by ReplyLane)
└── sub_training/                      # topicPresets.ts · topicCoverage.ts (read by the table); TrainingStudio.tsx is no longer mounted since the experience fusion
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
