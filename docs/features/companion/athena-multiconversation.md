# Athena multi-conversation — many threads, one mind

**Status:** design / impact analysis (not built). Author date 2026-07-05.
**Problem owner ask:** the user can start several distinct tasks with Athena, but today
they all pour into one chat window and one transcript, confusing both the user
and Athena. We want **multiple concurrent conversations, each its own thread,
with a single Athena — same memory, same identity — presiding over all of them.**

> Terminology guard: the app already uses **Task** for background jobs
> (`ActivityTray`, `TaskTag`, `companion_background_job`). To avoid collision, the
> new user-facing unit here is a **conversation** (UI shorthand: **thread**). A
> conversation is a dialogue context; a Task is a unit of async work Athena
> delegates *inside* a conversation. They are orthogonal layers (see §3).

---

## 1. The reframe — this is smaller than it looks

The instinct is "Athena can't do parallel work, so this is a huge build." The
source says otherwise. Two facts collapse most of the scope:

1. **The memory substrate is already singular and global.** Every long-term tier
   — `companion_node` (facts/goals/procedurals/backlog/doctrine/reflections),
   `companion_fact` + provenance, the `companion_embedding` vector store,
   `identity.md`, the constitution — carries **no session or conversation
   column**. Recall (`brain/retrieval.rs`) is global by construction. So "one
   Athena, one brain, shared across all conversations" is **free** — it is the
   default, not a feature we add. The *singular-Athena invariant* is inherent.

2. **Conversation is already decoupled from execution.** `docs/plans/athena-async-ux.md`
   (phases 1–4, shipped) split "the conversation (always-available, sub-second)"
   from "execution (turns + minute-long tasks)": the composer is never disabled,
   long work is delegated to background Tasks (`jobsById`), and the orb/tray make
   that parallel work observable. The one-Athena-observes-many-workers pattern is
   built **twice already** — background Tasks and Fleet Operations
   (`operative_memory.rs`), each with a per-worker status model, a **prompt
   digest** so a single Athena reasons over all of them, and a UI surface
   (`ActivityTray` / `LiveOpsStrip`).

What is genuinely missing is only the **conversation/thread dimension**: today
everything is hardwired to a single `DEFAULT_SESSION_ID = "default"`, one
`companion_session` row, one `claude_session_id` `--resume` pointer, and one
global `TURN_LOCK`. The code *anticipates* the change — the Tauri event contract
already carries a (currently ignored) `sessionId`, and `session.rs:358` literally
comments *"one lock suffices; key by session id if that changes."*

So: **the singular-Athena half is free; the async/observability half is ~80%
built; the net-new work is partitioning the thread layer** (transcript + CLI
resume session + recency lane + turn lock + frontend store) by conversation id.

---

## 2. Conceptual model — one mind, many mouths

```
                         ┌──────────────────────────────┐
                         │        ONE  ATHENA            │
                         │  identity.md · constitution   │
                         │  brain: facts · goals ·       │   ← global, shared,
                         │  procedurals · doctrine ·     │     UNCHANGED
                         │  backlog · embeddings         │
                         └──────────────┬───────────────┘
                    thread-roster digest│(every turn's prompt)
        ┌───────────────────┬───────────┴───────────┬───────────────────┐
        ▼                   ▼                       ▼                   ▼
  ┌───────────┐       ┌───────────┐           ┌───────────┐       ┌───────────┐
  │ Thread A  │       │ Thread B  │           │ Thread C  │  …    │ Athena /  │
  │ "auth bug"│       │ "Q3 plan" │           │ "exercise │       │ notices   │  ← proactive lands here
  │           │       │           │           │  tracker" │       │  when no   │
  │ transcript│       │ transcript│           │ transcript│       │  owner     │
  │ CLI resume│       │ CLI resume│           │ CLI resume│       └───────────┘
  │ recency   │       │ recency   │           │ recency   │
  │ turn lock │       │ turn lock │           │ turn lock │
  └─────┬─────┘       └─────┬─────┘           └─────┬─────┘
        │ spawns            │                       │
        ▼                   ▼                       ▼
     Tasks/jobs  ───────────────────────────────────────►  ONE global Task pool
     (connector_use, scan, fleet CLIs, dev-ops)            (orb dots + ActivityTray
                                                             aggregate ALL threads)
```

**The invariant that keeps her singular:** everything *above* the threads is one
Athena (brain, identity, the Task pool, the proactive economy, the voice). A
thread owns only what must be linear-per-topic: its transcript, its CLI `--resume`
continuity, its recency-episode lane, and its live turn state.

**How "singular Athena in charge of all" is actually achieved** — not by any
single super-conversation, but by two mechanisms she already has the shape for:

- **Shared brain (recall).** A fact she learns in Thread A is retrievable in
  Thread B on the next turn — because facts are global. No work.
- **A per-turn thread-roster digest.** Inject a compact list of the user's *other*
  open conversations into every turn's system prompt — reusing the exact
  `digest_for_prompt` pattern that already feeds her the Fleet op board and
  project goals: `"You have 3 open conversations: [A 'auth bug' — awaiting your
  reply, 2m], [B 'Q3 plan' — idle], [C 'exercise tracker' — a background task is
  running]."` This is what lets any thread's Athena answer "what else are we
  working on?" and say "I've got that running in your auth thread." Singular
  awareness is a **prompt-context** concern, not a concurrency one.

---

## 3. Conversations vs Tasks — keep them orthogonal

| | **Conversation (thread)** — NEW | **Task / job** — EXISTS |
|---|---|---|
| What | A user-facing dialogue on one topic | A unit of async work Athena delegates |
| Owns | transcript, CLI resume session, recency lane, turn state | status lifecycle (queued→running→done) |
| Lifetime | until archived by user | until the work finishes |
| Cardinality | a few, user-created | many, per-conversation, auto |
| Surface | the chat window body + switcher | `ActivityTray`, `TaskTag`, orb dots, `ConnectorCallCard` |
| Store | `conversations[id]` (new) | `jobsById` (unchanged, gains a `conversationId` tag) |

A conversation *spawns* Tasks; a Task belongs to a conversation (for in-chat
pinning) but the orb/tray aggregate **all** Tasks across all conversations,
because they are all *Athena's* work. This is the design's load-bearing
separation — do not merge them.

---

## 4. Logical layer

### 4.1 Backend — data model

**Generalize `companion_session` into the conversation table.** It already has
`{ id, claude_session_id, constitution_version, last_active_at, created_at }` —
exactly the per-thread continuity fields. Add:

```sql
ALTER TABLE companion_session ADD COLUMN title        TEXT;       -- auto-titled
ALTER TABLE companion_session ADD COLUMN status       TEXT DEFAULT 'active';  -- active|archived
ALTER TABLE companion_session ADD COLUMN last_read_at TEXT;       -- unread computation
ALTER TABLE companion_session ADD COLUMN pinned       INTEGER DEFAULT 0;
ALTER TABLE companion_session ADD COLUMN origin       TEXT DEFAULT 'user';    -- user|forwarded|proactive
```

Stop minting only `'default'` — mint a real id per conversation. The existing
`'default'` row becomes the first conversation, titled "General" on migration.
All the additive `ALTER`s run defensively in `db::init_user_db`, matching the
existing migration style (e.g. `companion_proactive_message.scheduled_for`).

**Scope episodes by conversation** — the one real schema blocker:

```sql
ALTER TABLE companion_node ADD COLUMN session_id TEXT;            -- NULL for non-episode kinds = global
CREATE INDEX idx_node_session_recent ON companion_node(kind, session_id, created_at);
-- backfill: UPDATE companion_node SET session_id='default' WHERE kind='episode';
```

Only `kind='episode'` uses it; facts/goals/doctrine leave it NULL and **stay
global** (that is the singular-brain property — keep it). Then fix
`episodic::list_recent` to actually honor its `session_id` argument with a
`WHERE session_id = ?` clause — this is the code's own TODO at `episodic.rs:172`
("if it gets hot, add a session_id column"). This scopes each thread's
recency-episode recall so Thread B's chatter never pollutes Thread A's
"last 5 turns" window; the *vector/semantic* lanes stay global on purpose.

### 4.2 Backend — turn concurrency (DECIDED: unbounded)

**Product decision: concurrency is unbounded** — every conversation may run a live
turn simultaneously, no app-imposed ceiling. This is affordable *specifically
because of an existing invariant the codebase already enforces:* **every Athena
CLI spawn runs on the Claude subscription, never the metered API**
(`force_subscription_auth` strips `ANTHROPIC_API_KEY` before each spawn; the
project's hard rule "CLI = subscription, never API"). So N concurrent turns are
**not** N× dollars — the marginal $ of a second live turn is zero. That removes
the cost argument that would otherwise force a cap.

The mechanics:

- **Per-conversation turn lock.** Replace the single `TURN_LOCK: Mutex<()>` with a
  keyed map `TURN_LOCKS: HashMap<ConvId, Arc<Mutex<()>>>` (or `DashMap`). A
  conversation still serializes *its own* turns (so a thread's `--resume` writes
  can't clobber each other — the race the old single-lock comment guards); across
  conversations there is no serialization. This directly executes the code's own
  note at `session.rs:358` ("key by session id if that changes").
- **No cost semaphore.** Do **not** add a `companion_turn_semaphore` cap. The `!Send`
  `spawn_blocking`-per-turn model already gives each concurrent turn its own
  blocking thread + current-thread runtime; unbounded simply means we stop
  funnelling them through one lock and don't add a new gate.
- **The real ceilings are resources and subscription rate limits, not money** —
  and both are *soft*, so they inform an optional safety valve, not a hard cap:
  - **Local process/RAM.** Each turn is a `claude` CLI subprocess (Node) holding a
    stream; the app already runs 10+ concurrent CLIs under Fleet, so the plumbing
    scales, but a dozen simultaneous Athena turns is real CPU/RAM. Recommend an
    **optional high-water backpressure** keyed on machine health (only queue when
    process/RAM pressure crosses a threshold), *not* a fixed count — preserves
    "unbounded" in the normal case while protecting a weak machine.
  - **Subscription usage/rate limits.** Subscription plans have rolling usage
    windows and concurrent-request limits; heavy fan-out burns them faster and can
    surface a rate-limit error mid-turn. Handle it where it belongs — surface the
    rate-limit as that thread's turn error (the existing failed-turn retry chip),
    not by pre-throttling. Optionally track window consumption via the
    `companion_turn` ledger and warn before fan-out gets pathological.
- **Key every global static by conversation id:** `INTERRUPTED_TURNS`,
  `AUTONOMOUS_GEN` (+ `cancel_pending_autonomy`), `ACTIVE_BUILD_TURNS`. Cancelling
  Thread A's autonomy or Stop-ing its turn must not touch Thread B.
- **Thread `conversationId` through the ~30 `DEFAULT_SESSION_ID` call sites** —
  `send_turn`, jobs, approvals, reflection, consolidation, dev_session, fleet
  bridge. Tedious but mechanical; the argument already exists, it's just pinned to
  a constant.

**UX consequence of unbounded turns:** several threads can be mid-turn at once, so
the switcher's per-thread status glyph (◐ working) and the orb's aggregate
`thinking` state carry more weight — they're how the user tracks "which of my
conversations are live right now." The one true bottleneck that *cannot* be
parallelised is **voice**: Athena has one mouth. See the voice-collision mitigation
in §7 — background-thread replies never auto-speak; only the focused thread's
audio plays, and it's a single-owner queue.

### 4.3 Backend — events & proactive

- **Propagate `conversationId` on every companion event.** `StreamEvent` /
  `RecallPreviewEvent` / `TurnSummaryEvent` already carry `sessionId`; extend
  `companion://approvals`, `://chat-cards`, `://job`, `://proactive` to carry it
  too. The frontend routes each event to the right thread's slice. This *also*
  fixes the known bug where build/fleet streams interleave into chat for lack of a
  `sessionId` guard (`docs/harness/combined-scan-2026-06-25/companion-runtime-and-chat.md`).
- **Proactive messages target a conversation (DECIDED).** A proactive/autonomous
  message lands in the originating thread when there is one — a `fleet_op_completed`
  nudge lands in the thread that dispatched the op, a `dev_improve_review` in the
  dev thread. When there is **no owning thread** (daily brief, incident/blocker
  nudges, cadence/on-this-day, backlog aging), it lands in **one dedicated
  system-owned "Athena / Notices" conversation** — created once, `origin='proactive'`,
  pinned to the top of the switcher, never user-deletable (archivable). This keeps
  proactive out of task threads (no re-mixing) *and* avoids thread sprawl (chosen
  over spawn-a-thread-per-nudge). Its unread badge is how ownerless nudges surface.
  **Keep the proactive budget / dedupe economy GLOBAL** (per-Athena, not per-thread)
  — otherwise N threads = N× the daily nudge budget. Route to a thread; count
  against one economy.

### 4.4 Frontend — store

The single largest refactor, but mechanical. Introduce a conversation dimension
around the currently-flat fields in `companionStore.ts`:

```ts
type ConversationState = {
  id: string; title: string; status: 'active'|'archived';
  messages: CompanionMessage[];
  streaming: boolean; streamingText: string; streamingPhase; streamingBeat;
  quickReplies; chatCards; approvals; queuedMessages;
  recallByEpisodeId; turnSummaryByEpisodeId; stepsByEpisodeId;
  narrationByEpisodeId; connectorJobIdsByEpisodeId;
  unread: number; lastReadAt: string; scrollAtBottom: boolean;
};
// store gains:
conversations: Record<string, ConversationState>;
conversationOrder: string[];   // tab order
activeConversationId: string;
```

- **Stays global (Athena's, not a thread's):** `jobsById`, `inTurnToolJobs` (each
  job just gains a `conversationId` tag for pinning), `pendingPlayback` (one voice
  — see risks), `pendingDecision` (one at a time, tagged with its thread),
  `footerNotice`.
- **Migration hook:** on first load, wrap the existing flat state into
  `conversations['default']` and set it active — lossless.
- **Resolver hook** `useActiveConversation()` returns the active slice; migrate the
  ~12 flat-field call sites in `CompanionPanel`/`Bubble`/orb to read through it.
  This is the *same consolidation move* as the `useTtsVoiceSelection` resolver that
  replaced 7 duplicated ternaries — a proven, low-risk pattern in this codebase.
- **IPC gains a conversation id:** `companion_send_message(conversationId, …)`,
  `companion_list_recent_messages(conversationId, 50)`,
  `companion_reset_conversation(conversationId)`, plus new
  `companion_list_conversations`, `companion_create_conversation`,
  `companion_archive_conversation`, `companion_rename_conversation`.

---

## 5. UI — the chat window

**Thread switcher — adaptive to the panel's two widths.** The `Header` left
cluster (`CompanionPanel.tsx:547-566`) is layout-safe (the orb→panel morph is
anchored bottom-left, so the header can grow). Recommendation:

- **Compact (350px):** replace the static "Athena" name badge with the *active
  thread title* as a button → a **dropdown** listing all conversations (unread dot,
  status glyph, relative last-active) + "＋ New" + "Archive". Smallest footprint.
- **Expanded (760px):** show an optional **left rail** column inside the panel — a
  vertical conversation list (the "Atlas" left-rail idiom already used in the
  Decisions sub-tab), reading-pane on the right. Collapses back to the dropdown in
  compact. Reuse `layout/PanelTabBar` / `SegmentedTabs` / `forms/Listbox`.

```
COMPACT (350px)                          EXPANDED (760px, left rail)
┌────────────────────────────┐          ┌──────────────┬───────────────────────┐
│ ▼ auth bug ●2   🔍 ∞ ⟳ ✕   │          │ CONVERSATIONS │  auth bug        🔍 ∞ ✕ │
├────────────────────────────┤          │ ● auth bug  2 │ ┌───────────────────┐ │
│  ┌──────────────────────┐  │          │ ◐ Q3 plan     │ │ …transcript…      │ │
│  │ ▼ ● auth bug     2  │  │  ← menu   │ ○ exercise…   │ │                   │ │
│  │   ◐ Q3 plan         │  │          │ ─────────────  │ │                   │ │
│  │   ○ exercise tracker│  │          │ ＋ New         │ └───────────────────┘ │
│  │   ─────────────     │  │          │               │ [composer………] send   │
│  │   ＋ New conversation│  │          └──────────────┴───────────────────────┘
│  └──────────────────────┘  │           status glyphs:  ● awaiting you
│  …transcript (active)…     │                           ◐ working (turn/task live)
│  [composer…………] send       │                           ○ idle
└────────────────────────────┘
```

- **Auto-titling.** A new thread is titled from its first user message — a cheap
  headless `cli_text` summary (reuse the Fleet P1 "LLM session titles" pattern) or
  a 6-word truncation as the instant placeholder. User can rename inline; Athena
  can `rename_conversation` via an op.
- **New-conversation entry points.** The "＋", and — importantly — **forwarding
  from a dashboard ("Ask Athena", `useForwardToAthena`) opens a NEW thread** instead
  of dumping into whatever's current (that dumping *is* the confusion we're
  fixing). Same for the intent flows (build-a-persona, KPI setup): each gets its
  own thread so a design conversation doesn't collide with an ops question.
- **Transcript is the active thread's slice.** Message list, streaming bubble,
  composer, quick replies, approvals, cards, `RecallStrip`/`NarrationTrail`/
  `OperationalThread`/`ConnectorCallCard` all read the active `ConversationState`.
  Switching threads swaps the body with a subtle transition; per-thread scroll
  position is preserved.
- **Background-thread replies don't hijack you.** When a turn finishes in a thread
  you're *not* viewing, surface it quietly: bump that thread's unread dot in the
  switcher + a soft in-panel "Athena replied in 'Q3 plan'" affordance — never yank
  the transcript. When Athena *references* another thread in prose, render a chip
  that switches to it.
- **Reset → per-thread.** `⟳` clears *this* thread; add an **Archive/Close** for
  finished threads (keeps the switcher uncluttered; archived transcripts stay on
  disk).

---

## 6. UI — the orb

**Design rule: exactly one orb, always.** Fragmenting into N orbs would destroy
the singular-Athena illusion — the whole point. The orb stays Athena's single
presence and keeps its **aggregate** state, which the code *already* computes
correctly for this:

- **Aggregate avatar state (unchanged).** `thinking` if *any* thread is
  streaming/working; the perimeter **task dots already sum `jobsById` across all
  threads** (`AthenaOrb.tsx:63-72`). This is exactly right for one Athena — leave
  it. The orb barely changes, which is the tell that the model is sound.
- **NEW: a thread-attention indicator.** Today the orb has *no numeric badge* (only
  in-flight task dots + `aria-label`). Add a small **attention count** — the number
  of threads with unread replies or `awaiting-you` status — in a visual language
  *distinct* from the task dots: task dots = "work in flight"; attention badge =
  "threads want you." e.g. a subtle count pill on the orb's lower-right.
- **NEW: tap behavior with multiple unread threads.** Tap → opens the panel to the
  last-active thread (today's behavior) when ≤1 thread needs attention; when 2+ do,
  optionally open a **thread peek list** (a mini switcher floating by the orb, same
  host as `OrbDecisionBubble`) so the user chooses which to enter. Keep the simple
  path default; the peek is the multi-attention affordance.
- **Decision bubble (`OrbDecisionBubble`) stays single**, one at a time, now tagged
  with its source thread; engaging opens that thread.
- **Voice glow / message-reaction glow stay global** — one voice, one presence.
  (Optionally tint the reaction glow by which thread replied; probably not worth
  the complexity.)

Net orb impact: **additive only** (attention badge + optional peek list). The
aggregate-state model that already exists is the correct singular-Athena behavior.

---

## 7. Impact analysis

**Free — inherent, zero work:**
- Shared memory / singular identity (global brain, no session key).
- The Task/job substrate + non-blocking composer + conversation≠execution split
  (async-ux 1–4 shipped).
- The event contract already carrying `sessionId`.
- The orb's aggregate task-dot model.

**Cheap — additive:**
- `companion_session` → conversation table (additive `ALTER`s) + `session_id` on
  `companion_node` (additive `ALTER` + backfill).
- `episodic::list_recent` `WHERE session_id` (their own TODO).
- Thread-roster prompt digest (reuse `digest_for_prompt`).
- Event `conversationId` propagation + proactive routing.
- Orb attention badge; per-thread reset/archive.

**Hard — real work, but mechanical:**
- Frontend store restructure (flat → `conversations[id]` + `useActiveConversation`
  resolver). Biggest single change; mirrors the `useTtsVoiceSelection` refactor.
- Per-conversation `TURN_LOCK` (keyed map) + unbounded concurrent turns (no cost
  cap — subscription auth); audit every global static → key by conv; optional
  machine-health backpressure valve.
- Remove `DEFAULT_SESSION_ID` across ~30 sites.
- Panel body re-render + per-thread scroll/refs on switch.

**Risks & mitigations:**
| Risk | Mitigation |
|---|---|
| ~~**Cost** — N concurrent turns = N× spend~~ | **Not a risk.** Every Athena spawn is subscription-auth, not metered API — the marginal $ of a concurrent turn is zero. This is why unbounded is affordable (§4.2). |
| **Machine load** — N concurrent CLI subprocesses = CPU/RAM/process pressure | optional high-water backpressure keyed on machine health (not a fixed count); the app already sustains 10+ CLIs under Fleet, so the plumbing scales |
| **Subscription rate/usage limits** — heavy fan-out burns the rolling window / hits concurrent-request caps | surface as that thread's turn error via the existing retry chip; optionally track window consumption on the `companion_turn` ledger and warn before pathological fan-out |
| **Clutter** — many threads re-create the confusion | auto-archive idle threads, good auto-titles, cap visible + overflow, easy Archive; proactive confined to the one Notices thread |
| **Voice collision** — one voice, N threads (the one thing that can't parallelise) | playback stays a global single-owner queue (already built that way); background-thread replies **never auto-speak** — only the focused thread's audio plays; a finished background reply surfaces as an unread badge, not speech |
| **Proactive noise** — N× nudges | keep budget/dedupe economy **global**; only routing is per-thread |
| **Autonomous cross-talk** — cancel one kills all | key `AUTONOMOUS_GEN`/`INTERRUPTED_TURNS`/`ACTIVE_BUILD_TURNS` by conversation |
| **Migration loss** | existing transcript → "General" thread; backfill `session_id='default'`; lossless |
| **Concurrent-turn races** the old comment warns of (two turns `--resume` the same CLI id and clobber the write) | per-conversation CLI session rows make this a non-issue *between* threads; per-conversation lock keeps it serialized *within* a thread |

---

## 8. Phasing

- **Phase 0 — invisible foundation.** Conversation table + `session_id` column +
  per-conv locks + `DEFAULT_SESSION_ID` removal, all still resolving to one
  conversation. Ships with no UI change; de-risks the plumbing.
- **Phase 1 — the thread UI.** Store restructure + switcher (dropdown) + new /
  switch / archive + per-thread transcript. Turns may still serialize globally at
  first (switching is instant; only one *live* turn) — already a huge UX win over
  interleaving.
- **Phase 2 — true (unbounded) concurrency.** Per-conversation turn locks + keyed
  autonomy/interrupt statics; threads run in parallel with no cost cap (subscription
  auth makes that free), only an optional machine-health backpressure valve.
- **Phase 3 — the singular-Athena control plane.** Thread-roster prompt digest +
  cross-thread reference chips + orb attention badge + peek list. This is where she
  visibly becomes "one Athena in charge of all."
- **Phase 4 — polish.** Auto-titling, forward-opens-new-thread, per-conversation
  cost rollup, proactive routing, expanded left-rail.

Each phase is independently shippable and observable; Phase 1 already resolves the
user's stated pain (mixed transcripts), Phase 3 delivers the "singular Athena over
all tasks" ask in full.

---

## 9. Decisions

**Settled (2026-07-05):**
1. **Concurrent-turn ceiling → unbounded.** No app cap; affordable because Athena
   turns are subscription-auth (zero marginal $). Only an optional machine-health
   backpressure valve. (§4.2)
2. **Ownerless proactive → one "Athena / Notices" thread** (system-owned, pinned,
   archivable-not-deletable). Chosen over per-topic threads to avoid sprawl. (§4.3)

**Still open (need a product call):**
3. **Switcher shape** — dropdown-only vs dropdown+expanded-left-rail. Recommend
   adaptive (both).
4. **Does dictation / hold-to-talk go to the active thread or always a new one?**
   Recommend active thread (dictation is quick-turn), with a modifier for "new".
5. **Auto-archive policy** — archive a thread after N days idle? Recommend a gentle
   default (e.g. 14 days) with pin-to-keep.
