# Athena Live Conversation Layer — plan

**Status:** plan (no code yet) · **Created:** 2026-07-14
**Goal:** the user can hold an active conversation with Athena while she is busy with other work — without interrupting it or losing progress — and the conversational layer is *aware* of every process she maintains (turns in other threads, background tasks, queued work), enabling dynamic dialog, multitasking, and faster responses.
**Prior art:** `docs/plans/athena-async-ux.md` (phases 1–4b, shipped) · `docs/features/companion/athena-multiconversation.md` (backend shipped; frontend partition NOT done).

---

## 1. Where we actually are (verified on master, 2026-07-14)

The assessment that produced this plan verified the code, not the docs:

**Already built and load-bearing:**
- **Per-conversation turn locks** — `TURN_LOCKS: HashMap<ConvId, Arc<Mutex<()>>>` (`src-tauri/src/companion/session.rs:363-375`). Turns serialize *within* a conversation, run **fully concurrently across conversations**. User turns block-acquire; autonomous/proactive turns `try_lock` and self-skip.
- **Per-conversation continuity** — each thread owns its `claude_session_id` `--resume` pointer and its episode recency lane (`brain/episodic.rs:140-150`). A running turn persists to *its* conversation regardless of what the UI shows — backend progress is never lost on switch.
- **Non-blocking composer in-thread** — mid-turn sends classified by `classifyMidTurnIntent` (redirect → interrupt, else FIFO queue drained one-per-turn-completion).
- **Task substrate** — `companion_background_job` + `companion://job` + ActivityTray/TaskTag/orb dots + in-turn tool promotion (>6s).
- **Roster digest** — every turn's prompt lists up to 6 *other* active threads (`companion/conversation.rs:189-217`), but only coarse `awaiting-you / idle` state.

**The gaps (ranked):**
1. **Frontend never partitioned per conversation.** `companionStore` state (`messages`, `streaming`, `streamingText`, `queuedMessages`, phase/beat, steps/narration/recall) is flat; the `companion://stream` handler ignores the `sessionId` the events already carry (`CompanionPanel.tsx:898-1104`). A background thread's stream mutates the focused thread's bubble; interrupt/queue act on "whatever streamed last" (`currentTurnIdRef`, `CompanionPanel.tsx:907`). Concurrent turns are *enabled backend-side but unsafe UI-side today*.
2. **No live awareness in the prompt.** Nothing injects running jobs, other threads' in-flight turns, or queued messages. `delegation_addendum` (`prompt.rs:1266-1292`) is static doctrine. Athena cannot answer "how's that scan going?" from her prompt.
3. **No dialog while the *same* thread is busy.** Mid-turn messages either interrupt or wait behind the turn.
4. **One speed for everything.** Every turn is pinned to `claude-opus-4-8` (`session.rs:1242`), CLI-default reasoning. Status checks, asides, and titling pay the same latency as deep reasoning.

**Adjacent hazards to fix on the way:**
- `AUTONOMOUS_GEN` is a single global atomic (`session.rs:190`) — a user message in thread A cancels pending autonomy in thread B (`chat.rs:84-86`).
- `companion_reset_conversation` wipe is still global (`TODO(multiconv Phase 1)` at `chat.rs:383-387`).
- Jobs carry `parent_turn_id` but no `conversation_id` (`db/mod.rs:878`) — a task can't be attributed to a thread.
- `kill_on_drop(true)` is set only on build turns (`session.rs:1685-1687`) — a dropped chat-turn future can orphan its `claude` child. Must fix before adding more concurrent spawn paths.

---

## 2. Plan shape — two tracks

- **Track A (P1→P4)** — the conversation layer itself. Strictly ordered: P1 is a safety prerequisite for everything after it.
- **Track B (B1→B3)** — the **model/reasoning benchmark**: a live, rich test suite measuring how far we can drop model/effort without damaging decision ability. **Independent of Track A** — it tests today's turn path and can start immediately. Its verdicts feed P4 (and the P3 aside/fast-lane tiers).

Cost note: every Athena spawn is subscription-auth (`force_subscription_auth`), so the benchmark's lever is **latency and quality**, not dollars — token counts are recorded for context only.

---

## 3. Track A — the conversation layer

### P1 — Partition the frontend per conversation (prerequisite) ✅ CORE SHIPPED

Shipped (2026-07-14): per-conversation `liveTurns` slices with active-mirror flat fields + stream routing by `sessionId`; per-thread queue/interrupt; `AUTONOMOUS_GENS` keyed by conversation (explicit cancel stays global); `companion_background_job.conversation_id`; per-thread transcript reset; `kill_on_drop` on chat turns. **Deferred to a later pass:** full slice migration of messages/steps/narration/recall (they remain keyed by unique episode ids or active-only — collision-free but not yet browsable per background thread mid-stream), and per-thread scroll preservation.

The original scope (kept for reference) — the biggest single diff, but mechanical; fixes misattribution bugs that exist today even before new features.

- `companionStore.ts`: introduce `conversations: Record<convId, ConversationState>` slices holding `messages / streaming / streamingText / streamingPhase / streamingBeat / queuedMessages / quickReplies / chatCards / streamingSteps / narration / recall / scroll position / unread`. Registry (`ConversationRow[]`) and `activeConversationId` stay. Migration hook wraps existing flat state into `conversations['default']` — lossless.
- `useActiveConversation()` becomes the resolver for the active slice; migrate the flat-field call sites in `CompanionPanel` / `Bubble` / orb (same consolidation move as the `useTtsVoiceSelection` refactor).
- **Route every event by its conversation id.** `companion://stream` / `turn-summary` / `recall-preview` already carry `session_id` — the handlers must key writes into the right slice instead of the flat fields. `companion://job` and `://approvals` / `://chat-cards` gain the id (see below).
- **Per-thread queue + interrupt.** `queuedMessages` moves into the slice; drain on *that thread's* streaming edge. Replace `currentTurnIdRef` with a per-conversation live-turn map so Stop targets the focused thread's turn.
- Backend companions to this phase:
  - Key `AUTONOMOUS_GEN` / `cancel_pending_autonomy` by conversation id (`session.rs:190`, `chat.rs:84-86`).
  - `companion_background_job` gains `conversation_id` (additive ALTER + backfill NULL→`default`); `enqueue_task()` threads it through; events carry it.
  - `companion_reset_conversation` scopes the wipe to the conversation (resolve the `chat.rs:383-387` TODO).
  - Apply `kill_on_drop(true)` to chat-turn spawns too (`session.rs:1685-1687`).
- **Ship check:** two threads with live turns simultaneously — each bubble streams in its own thread, switching mid-stream preserves both, Stop kills only the focused turn, queue drains per-thread. Deterministic via the `window.__TEST__` bridge (LLM-free), per the async-ux testing lesson.

### P2 — Live-activity prompt digest (the awareness layer)

Small, high leverage. A `live_activity_digest(user_db, session_id)` block built each turn from state that already exists, injected next to `roster_digest_for_prompt` (`prompt.rs:181/316`):

- **Running/queued jobs** — `companion_background_job` rows with `short_title`, structured progress (`8/17`), age, owning conversation.
- **Live turns elsewhere** — which other conversations have a turn streaming *right now* (small in-memory live-turns registry maintained by `send_turn` enter/exit; the `TURN_LOCKS` map alone can't say "locked").
- **This thread's queued messages** (count + first words) so she can acknowledge what's pending.
- **Recent completions** since her last turn in this thread ("the Sentry scan you asked for finished 2m ago").

Format contract mirrors the fleet `digest_for_prompt` style — compact, capped (≤ ~15 lines), stable ordering. Also extend the roster line with live-turn status (`◐ replying now` vs `idle`). Doctrine addendum teaches her to *use* it: reference in-flight work instead of re-spawning it; offer to fold results in.

- **Ship check:** seed 2 running jobs + a live turn in another thread via the test bridge, ask "what are you working on?" — reply must enumerate them from the digest without firing any op.

### P3 — Dialog while the same thread is busy

Two complementary mechanisms, both gated on P1 (routing) and P2 (state):

- **P3a — Status fast-lane (no LLM, instant).** A deterministic classifier over mid-turn sends (extend `midTurnIntent.ts`: `interrupt | queue | status`). A `status` message ("how's it going?", "done yet?", "what's running?") is answered *instantly* from the live-activity state as a system-styled reply — zero latency, zero cost, zero touch on the running turn. Conservative matcher; anything ambiguous still queues.
- **P3b — Aside turns.** Substantive mid-turn questions spawn a parallel *ephemeral* turn: a headless `cli_text`-style call carrying the live-activity digest + a bounded transcript snapshot, which **never advances the thread's `--resume` pointer** (that pointer is exactly what the per-conversation lock protects — asides bypass the lock because they don't touch it). Renders as a visually distinct "aside" bubble; persisted as an episode marked `aside`; anything durable it wants to do becomes a queued follow-up for the main lane, never a direct op (asides get **no OP grammar** — decision authority stays in the serialized lane).
- **Ship check:** while a long turn streams, a status ask answers <100ms from state; an aside answers in seconds without perturbing the main turn's stream or resume id; a redirect still interrupts.

### P4 — Speed tiers (consumes Track B's verdicts) ✅ SHIPPED

Shipped (2026-07-14): `companion/model_routing.rs` (MAIN = Opus@low; ASIDE = Sonnet-5@medium, awaiting P3; MICRO = Sonnet-5@low) wired into `session.rs` main turns and `athena_reaction::cli_text*` (upgraded from pinned Sonnet-4.6). Constitution **v44** folds in the bench-proven doctrine (multi-op completeness + one-line ops under Rule Zero; memory-honesty under `write_fact`); the delegation addendum gained the "a slow correct answer is still a failure" rule. The user-facing speed *toggle* is deferred until the routing has soaked.

Original scope (reference):

- Add the model/effort override seam in `run_cli` (also needed by B1): per-turn-class `model` + `effort`, defaulting to today's pinned Opus.
- Apply Track B's promotion verdicts per turn class: asides (P3b), auto-titling, status-adjacent summaries adopt the cheapest cell that passed its gate; **main conversational turns stay on Opus until a cheaper cell reaches full parity** (§5 gates).
- Optional: a Companion → Setup "response speed" toggle (Balanced / Fastest-safe) mapping to the certified tiers, so routing stays user-legible.

---

## 4. Track B — live model/reasoning benchmark ("how fast can we go without getting dumber?")

**Question:** for Athena's real turns — real system prompt, real digests, real OP grammar — how do `claude-opus-4-8` and `claude-sonnet-5` at different reasoning efforts trade **speed vs decision ability**? Opus at today's default is the safety baseline; nothing ships below it without passing the gates.

### B0 — Prerequisite seams (tiny) ✅ DONE

1. **Model/effort override** — `PERSONAS_ATHENA_MODEL` / `PERSONAS_ATHENA_EFFORT` (validated: low|medium|high|xhigh), read per spawn in `run_cli`, scoped to companion-chat turns (build turns keep their pinned model + effort knob). The resolved model also feeds the `companion_turn.model` ledger column, preserving the one-source invariant. CLI support verified: `--effort` accepts low/medium/high/xhigh on both `claude-opus-4-8` and `claude-sonnet-5` (default **high** for both — so O-base ≡ Opus@high); `--model` works headless and overrides a `--resume`d session's model.
2. **Prompt-dump seam** — `PERSONAS_DUMP_PROMPT=1` snapshots each turn's fully-composed system prompt + user message to `~/.personas/debug/prompts/<ts>-<conv>-<turn>.md` (`---USER-MESSAGE---` divider is the harness parse contract). Best-effort, never blocks the turn.

### B1 — Harness + scenario corpus ✅ SHIPPED (v1: 38 scenarios; judge pass deferred)

Shipped shape: `scripts/test/athena-model-bench.mjs` (`--dry-run` / `--cell <id>` / `--cells all` / `--report`; per-run JSONL checkpointing so rate-limited runs resume) + `scripts/test/fixtures/athena-bench/scenarios.json` (38 scenarios, 6 classes) + `scripts/test/fixtures/athena-bench/system-prompt.md` (distilled fallback; `--prompt-file` replays real `PERSONAS_DUMP_PROMPT` snapshots). Deterministic scoring runs the **production dispatcher** via a new `athena-bench-validate` bin (`src-tauri/src/bench/athena_validate.rs` — throwaway fully-migrated user DB per validation, `--pinned` seeds `companion_active_connector` both ways). The LLM-judge prose pass is a follow-up; results.jsonl carries `turnText` so it can run offline.

Original design (kept for reference) — per scenario × cell × repetition it:
1. seeds fixture state (jobs, roster, goals/KPIs snapshot) → dumps the real system prompt (B0.2),
2. spawns the `claude` CLI with the cell's model/effort and the scenario's user message, streaming JSONL captured,
3. records timing: spawn→first token (felt latency), spawn→final, total output tokens,
4. runs the validators (below).

A small **live smoke subset** (~5 scenarios × top cells) additionally runs through the real app via the test-automation harness (:17320) to confirm end-to-end timings including UI — the bulk matrix stays headless for repeatability.

**Scenario corpus** (~40–60 fixtures, versioned in `scripts/test/fixtures/athena-bench/`, seeded from real episode/turn history + hand-authored edge cases). Six classes — each class is a distinct *decision ability*:

| Class | What it tests | Example | Primary metric |
|---|---|---|---|
| **Tool/op selection** | picks the right op with valid params | "check Sentry for new errors" → `use_connector{sentry,…}`; "remember X" → `write_fact` | expected-op match + param validity |
| **Delegate vs inline** | long work → background task + immediate reply, not a held turn | "scan the codebase for TODOs" | delegated? reply latency |
| **Awareness use** | answers from seeded live-activity state; no redundant spawn | "how's that scan going?" with a running job seeded | answered-from-state, zero new ops |
| **Restraint / no-op** | smalltalk & ambiguous asks fire **zero** ops (cheap models over-call tools — the key degradation risk) | "haha nice", "thoughts on naming?" | false-op rate |
| **Gated-op discipline** | proposes approval-gated ops (`update_dev_goal`, `calibrate_kpi`…) instead of acting; valid enums | "mark goal g_123 done" | gate respected + enum validity |
| **Format contract** | OP:/QR:/TTS: grammar, proactive ≤120-word contract, no leaked machine grammar in prose | any | violations per turn |

**Validators — two layers:**
- **Deterministic (primary):** parse OP lines with the *real* dispatcher grammar (expose `dispatcher::parse_ops` behind a `cargo test`-callable or a tiny `--bench-validate` binary so validation can't drift from production parsing); check expected-op match, `ALLOWED_ACTIONS` membership, param/enum validity, gate compliance, format violations. Decision ability is scored mostly by machine, not vibes.
- **LLM judge (secondary):** one strong-model judge (rubric: correctness, helpfulness, awareness-usage, conciseness, 1–5) scoring reply prose, blind to which cell produced it. Judge model ≥ Opus; judge prompts versioned with the corpus.

### B2 — The matrix + report

| Cell | Model | Effort | Role |
|---|---|---|---|
| **O-base** | opus-4.8 | today's default | **baseline — the floor nothing may sink below** |
| O-med | opus-4.8 | medium | cheaper-Opus candidate |
| O-low | opus-4.8 | low | speed probe |
| S-med | sonnet-5 | medium | main Sonnet candidate |
| S-low | sonnet-5 | low | fastest probe |
| S-high | sonnet-5 | high | "is effort or model the lever?" control |

~3 reps per scenario × cell (LLM variance), randomized order, one cell at a time (serial, per the parallel-E2E constraint). Output: `docs/plans/athena-model-bench-report.md` — per-cell × per-class table (accuracy, false-op rate, format violations, judge score, p50/p90 first-token + total latency), plus the promotion verdicts.

### B3 — Promotion gates (what "without damaging decision ability" means, precisely)

A cell is **certified for a turn class** only if, vs O-base on that class:
1. op-selection accuracy drop ≤ 2 pts,
2. **zero** increase in false ops (restraint class) and **zero** gated-op violations — these are hard fails, not averages,
3. format violations ≤ baseline,
4. judge score drop ≤ 0.3,
5. latency win ≥ 30% p50 (otherwise the risk isn't worth it).

Routing policy from the verdicts:
- **Asides / status summaries / titling** → cheapest certified cell (expected: Sonnet-low/med — low decision surface, latency is the whole point).
- **Main conversational turns** → Opus until a cell passes **all six classes**; if S-med passes everything, ship it behind the P4 speed toggle, default off for one release.
- **Proactive/autonomous turns** → most conservative; restraint + gated-op classes weigh double (no user watching).
- Re-run the suite on any model bump or prompt-contract change — the corpus + validators are the regression net, not a one-shot experiment.

---

## 5. Sequencing & effort

| Step | Depends on | Size | Note |
|---|---|---|---|
| B0 seams | — | S | unlocks the bench; the override is P4's knob anyway |
| B1 harness+corpus | B0 | M | corpus authoring is the real work |
| B2 matrix run + report | B1 | S (mostly wall-clock) | serial runs |
| P1 frontend partition | — | **L** | biggest diff; do first on Track A; worktree |
| P2 live-activity digest | P1 (nice-to-have: none hard) | S–M | backend-only + doctrine |
| P3a status fast-lane | P1+P2 | S | deterministic |
| P3b aside turns | P1+P2 (+B2 for tier) | M | new spawn path — carries the kill_on_drop fix |
| P4 speed tiers | B3 verdicts | S | routing + toggle |

Tracks interleave: **B0→B1 can run while P1 is being built**; B2's wall-clock run overlaps P2. Each step is independently shippable and live-verifiable (test bridge for Track A, the report for Track B).

## 6. Risks

- **Store partition regressions (P1)** — the panel has ~12 flat-field call sites plus orb/footer consumers; migrate behind the resolver hook, keep the `__TEST__` bridge green per step, unit-test slice routing with synthetic events.
- **Aside/main divergence (P3b)** — an aside might promise something the main lane doesn't know; mitigated by persisting asides as episodes (next main turn recalls them) and denying asides the OP grammar.
- **Bench overfitting** — a 60-scenario corpus can be gamed by prompt tweaks; keep scenarios seeded from real history, add new failures to the corpus as they're found (it's a living regression suite).
- **Subscription rate limits** — a full matrix run is hundreds of turns; run cells serially, off-hours, and accept per-cell resume (the harness must checkpoint per scenario).
- **Effort-flag uncertainty** — if the CLI exposes no per-spawn effort control for these models, the matrix collapses to model-only cells (still answers the Sonnet question); note it in the report rather than faking effort via prompt hacks.
