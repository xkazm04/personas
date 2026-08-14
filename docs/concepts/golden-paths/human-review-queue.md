# Golden path — The human review gate: queue, verdict, resume

> Situation node: `ai-agents/human-review/human-review-queue` ·
> [situation spine](../situation-spine.md) · recurrence ~72 · dimensions:
> ui · function · resilience
> **Two-sided leaf.** It fused seven discovery entries on the client (verdict
> rows, proposal queues, keyboard nav, prev/next modal, unread state) with a
> backend `human-in-the-loop pause`. Both halves are below, plus the contract
> between them — which is where the worst defect lives.
> Composed 2026-08-14 against `master` @ `2a874e692`, over ~140 files across
> three passes (client verdict surfaces + shared primitives; Rust pause/resume
> surfaces and every CAS implementation; a convergence read of
> `../brainiac` and `../personas-web`). Repo-wide counts come from
> [`shared-facts.json`](../shared-facts.json) where it has them (4,829
> `src/**/*.{ts,tsx}` files, 1,666 Tauri commands) and state their own query
> otherwise. `.claude/worktrees/**` excluded throughout.
> Cross-reference, not overlap: the **destructive-confirm idiom** (eight
> primitives, the risk ladder, blast radius, typed confirmation) belongs to
> [`delete-semantics.md`](./delete-semantics.md) §"The eight-idiom confirm
> layer". This path owns the *verdict* — an act that is not a deletion, has its
> own blast radius, and adds a ninth idiom that document has not counted.
> The **Deviations** section is a fix backlog; it migrates to `violating` cells
> when this path is ingested.

## Trigger

- "Add an approve/reject button to this row." / "Let the user accept or dismiss this proposal."
- "Build a queue of things waiting on a human." / "Where do I put the pending-review list?"
- "The agent should pause here and ask the user."
- "Two people decided the same row and one overwrote the other."
- "I approved it and nothing happened — the run is still stuck."
- "Nobody ever reviews these. What should happen after a week?"
- "Add keyboard shortcuts / prev-next / a 'new since last visit' badge to the review list."

If you are about to type `status: 'approved'`, `onAccept`/`onReject` as a prop pair, `<Check/>` beside `<X/>` in a row's action cell, `UPDATE … SET status = ?` on a row a human was shown, `input_rx.recv().await`, a `pending` enum variant, or a `#[tauri::command] fn *_approve` — you are in this situation.

## The one way

**A verdict is a compare-and-swap against the status the reviewer's card actually rendered, written through one door per row type, and resolving the row must be the same act as resuming whatever it holds.** Client side: build the row from `DecisionRecord` and render it with `DecisionRow` + `DecisionActions` — never a hand-rolled `Check`/`X` pair — and route every write through a door in **`src/lib/decisions/rowWrites.ts`**, passing `seenStatus` from the row you rendered, never from a store you could have refetched. The door must **reject** on failure; the surface removes the card optimistically and restores it on rejection, *except* when `isDecisionConflict(error)` says the row is decided by someone else, in which case the card stays gone, the reviewer is told, and the sources are re-read — because putting it back would re-offer a decision that can never land. Server side: every verdict is `UPDATE … WHERE id = ? AND status = ?` with the *caller's* expectation as the second predicate, inside `conn.transaction()`, rolling back rather than fanning out side effects when `rows == 0`, and returning `AppError::Validation` whose message matches the wording `isDecisionConflict` pins. Then the part almost everything gets wrong: **a queue row that holds work must name the work it holds, and every path that clears the row — the user's verdict, an agent's verdict, and the aging sweep — must go through the same resume function.** Finally, **declare the failure direction in the code, once, next to the queue**: what happens when nobody ever answers is a product decision (hang / expire-as-reject / age-out-as-resolved / supersede), and this repo currently makes it fourteen times, differently, mostly by omission.

Two things you must not re-derive. `ManualReviewStatus::validate_transition` (`core/src/models/review.rs:39-54`) is the only verdict state machine in the app and it is deliberately one-way — `Pending → {Approved, Rejected, Resolved}`, `Approved|Rejected → Resolved`, `Resolved → nothing`, no self-transitions — so **reviews cannot be reopened and must not be offered an undo**; `reversibleStatus` (`triageDispatch.ts:324-343`) already encodes which of the seven row kinds can. And `isDecisionConflict`'s `CONFLICT_PATTERNS` (`rowWrites.ts:81-87`) are copied verbatim from Rust `format!` strings and pinned by `__tests__/rowWrites.test.ts`; a new backend conflict message that does not match them degrades to the generic "could not record that decision" and the reviewer is told to retry a write that can never succeed.

## Mandated primitives

**Client**

- **`src/lib/decisions/rowWrites.ts`** — the ONE write door, 8 exports + 1 predicate: `resolveReviewRow`, `dispatchReviewRowAction`, `decideIdeaRow`, `decidePracticeRow`, `decidePolicyProposalRow`, `decideEvolutionProposalRow`, `reopenIdeaRow`, `reopenPracticeRow`, `isDecisionConflict`. Store-free and React-free by construction (`:29-31`) so a hook, a slice or a component can all use it without an import cycle. It exists because fifteen call sites each had their own error handling and four swallowed the failure outright (`:6-12`).
- **`shared/components/decisions/decisionTypes.ts`** — `DecisionRecord` (title / summary / category / source / `facts[]` / timestamp) and `DecisionAction` (`{ id, label, tone: 'accept'|'reject'|'neutral', onClick, icon?, disabled?, loading?, title? }`). Domain-free: no store, no api, no bindings; each feature writes a small adapter.
- **`shared/components/decisions/DecisionRow.tsx`** — the row: accent rail, `typo-heading` title over `typo-caption` summary over a subordinate meta line, and a `stopPropagation` wrapper so "open" and "decide" never fight (`:76-82`).
- **`shared/components/decisions/DecisionActions.tsx`** — the verdict control. `TONE_PROPS` (`:17-21`) is the whole point: a caller cannot invent a fourth colour.
- **`@/lib/keyboard/AppKeyboardProvider`** — `useAppKeyboard(handler, { priority, exclusive })` and the documented priority ladder (`:27-42`). A route-level decision surface registers at **`ROUTE_DECISION_PRIORITY`** (10); a full-app decision surface registers **`exclusive: true`** so a key it ignores cannot reach a queue behind an opaque overlay (`:69-79` records the bug where one press decided two rows).
- **`agents/quick-answer/triage/*`** — the reference implementation of the whole client half, and the thing to read before designing a new queue:
  - `useUnifiedTriage.ts:1017-1105` `decide` — optimistic removal, restore-on-failure, **keep-resolved-on-conflict**, cursor advance before the card leaves.
  - `triageDispatch.ts` — `TriagePorts` (every write injected), `routeDecision`, `isDeferral`, `reversibleStatus`, `undoDecision`. React-free and store-free so every branch is a plain function call in a test; its stated contract is *"Every decision either DEFERS, or WRITES, or THROWS. Never nothing."* (`:12`).
  - `triageQueue.ts` `projectQueue` / `withSkip` — skip sorts last, bounded by `MAX_SKIP_PASSES`, never hides.
  - `triageSession.ts` — per-reviewer working state (skips, drafts, kind filter, resolved ids) in `localStorage` behind a 12h TTL and per-collection caps, with the "why not SQLite, why not Zustand" reasoning written down (`:12-34`).
  - `triageAdapters.ts:505-583` — the reject-preset shape: `{ id, value, copy }`, where `value` is the **persisted English** (read back by scanners and models) and `copy` is the translated label. Copy this shape for any new reason picker.
- **`overview/sub_patterns/libraryModel.ts` `nextQueueIndex`** — prev/next stepping that skips rows which have left the list, shared by three detail modals via the `{ index, total, onStep }` contract (`practiceViewTypes.ts:9-14`).
- **`overview/sub_manual-review/hooks/useManualReviewQueue.ts`** — the queue's data layer: `useLayeredList` with server-side status/persona filters, L0 counts + L1 page + L2 keyset scroll, so the queue stays O(viewport) at any volume. A pending queue is a working set, not an archive (see also `usePendingInteractions.ts:72-86`, `DECK_REVIEW_LIMIT = 100` with `reviewsHasMore` reported so a capped read is never presented as a finished queue).

**Server**

- **`ManualReviewStatus`** (`core/src/models/review.rs:11-54`) — the only verdict state machine. `from_db` falls back to `Pending` for an unknown string (`:20-27`): an unrecognised value reads as *un-decided*, never as decided.
- **`dev_workspaces::decide_knowledge_cas`** (`db/src/repos/dev_workspaces.rs:797-870`) — **the reference CAS. Copy this one.** Same-status is a no-op success, not a conflict (`:828-830`); the expectation fails fast *before* the transaction opens (`:833-840`); the swap is `WHERE id = ?4 AND status = ?5` inside `conn.transaction()`; `rows == 0` → `tx.rollback()` then re-read to name the status that won (`:861-867`).
- **`dev_tools::decide_idea_cas`** (`db/src/repos/dev_tools.rs:4456-4498`) — the required-`expected` variant; existence is checked first so a missing row reads `NotFound`, never conflict.
- **`commands/design/reviews.rs:1223-1307` `react_to_review_decision`** — **the reference resume.** Gate on verdict (`Approved | Resolved` only), gate on `review.assignment_id` being present, gate on the assignment being `IN ('awaiting_review','paused')`, then `auto_resume_retryable_steps` (failed steps) or `resume_assignment` (soft hold). Returns `bool` so the caller can avoid double-running the work (`dispatch_review_action` uses it at `:1352-1353`).
- **`db/src/repos/dev_tools.rs:1338-1387` `PendingCounts` / `pending_counts`** — the one place the backend enumerates its human-decision queues. Six table-backed queues; build questions deliberately absent because they live in memory (`:1326-1328`). **Any new queue must be added here or it is invisible to the title-bar badge.**
- **`engine/build_session/mod.rs` `SessionHandle { input_tx }`** — the in-memory waiter for a genuinely blocking pause. `runner.rs:1512-1528` is the mandatory carve-out: in autonomous (`one_shot`) mode there is no human, so the runner **must not block** — clear the pending question, inject a decide-it-yourself directive, continue. A blocking wait with no human on the other end is a permanent stall, and this repo has already shipped one.
- **`#[requires(privileged)]`** on any verdict command that resumes work, spends money, rewrites a live persona, publishes an automation or trusts a device. Per [`ipc-command-authorization.md`](./ipc-command-authorization.md) and `delete-semantics.md`, an in-body `require_auth*` call is documentation, not a guard: both functions are unconditional `Ok(())`.

## Steps

**Server — the pause**

1. **Decide the failure direction first and write it down.** "What happens if nobody ever answers" has exactly four honest answers — hang (a human is guaranteed), expire-as-reject (fail closed), age-out-as-resolved (fail neutral), supersede (the next cycle decides). Put the constant next to the queue with the reasoning, the way `APPROVAL_FRESHNESS_WINDOW = "-24 hours"` (`commands/companion/approvals/mod.rs:38-43`) and `PAIRING_TTL = 300s` (`engine/src/p2p/device_pairing.rs:86`) do. **Never leave it implicit** — seven of this repo's fourteen pause surfaces hang forever and not one of them says so.
2. **Record the pending state in a table with a `pending`-ish status, and register the queue in `pending_counts`.** An in-memory-only waiter (build sessions) cannot survive a restart: the row on disk says `awaiting_input`, the `input_tx` is gone, and `send_answer` returns `NotFound` forever.
3. **Name what the pause holds.** If clearing the row must restart work, store the link on the row — `persona_manual_reviews.assignment_id` / `step_id` (`db/src/repos/communication/manual_reviews.rs:84-98`) is the only instance in the app and it is the right shape. Without it, no surface can say "what stops if I never answer this", and no sweep can resume what it resolves.

**Server — the verdict**

4. **Guard it.** `#[requires(privileged)]` **and** the `PRIVILEGED_COMMANDS` listing, on any verdict that fans out. Then validate the transition against the state machine before touching the row.
5. **Take `expected_status` as a parameter.** `Option<&str>` at minimum (`decide_knowledge_cas`), required `&str` where every caller can supply it (`decide_idea_cas`). A hardcoded `WHERE status = 'pending'` is *a* CAS but it cannot express "I saw `observed`", so it cannot support a reopen or any queue with more than one pending status.
6. **One transaction, swap, roll back, re-read.** `let tx = conn.transaction()?;` → `UPDATE … WHERE id = ?1 AND status = ?2` → `if rows == 0 { tx.rollback()?; }` → re-read and return `AppError::Validation(format!("… was already decided as '{actual}' by a concurrent action"))`. **The wording is a contract** with `rowWrites.ts:81-87`; if you invent new prose, add the pattern there in the same commit or the frontend cannot tell a conflict from a failure.
7. **Fan out AFTER the commit, never inside it.** Adoption cells, constraint memories, follow-up runs and policy writes all go after `tx.commit()` — `commands/infrastructure/dev_workspaces.rs:223-244` explains why (pool deadlock, and announcing work a rollback could still erase). The corollary is the reason step 6 rolls back: a lost swap must not fan out.
8. **Route every clear-the-row path through the same resume function.** The user's verdict, the agent's verdict and the aging sweep must all call it. A sweep that writes the terminal status with raw SQL bypasses the resume and parks the job forever — see Deviations P0.

**Client — the queue**

9. **Adapt the row to `DecisionRecord`, render `DecisionRow` + `DecisionActions`.** Put the status the row was rendered with into the record's payload at the same moment — that value is the CAS token and it must be captured with the render, not read later.
10. **Write through a `rowWrites` door with `seenStatus`.** If your row type has no door, **add one** — a door is ~15 lines and it is where the conflict contract, the rejection guarantee and the reopen limits live. Do not write a verdict through a generic field-patch command.
11. **Resolve optimistically; restore on failure; stay resolved on conflict.** `useUnifiedTriage.decide` (`:1038-1093`) is the shape. The three branches are not interchangeable: a failed write must put the card *and the read head* back (`:1085-1090`); a lost swap must not, because the row IS decided.
12. **Give the queue a keyboard walk and a cursor that is an id, not an index.** `j`/`k`/`↑`/`↓` to move, `Enter` to open, one key per verdict, guarded on `e.target instanceof HTMLInputElement`. Register at `ROUTE_DECISION_PRIORITY`, or `exclusive: true` if the surface is full-app. **An index cursor silently re-points at the neighbouring row when the list refreshes** — both sibling repos independently wrote that comment (see Convergence).
13. **Bound the read and say when it is bounded.** Page or cap the query, and surface the cap (`reviewsHasMore` → `backlog.capped`). A truncated read presented as a finished queue is the queue lying about being empty.
14. **Offer undo only where a reverse door exists.** `reversibleStatus` returns `null` for reviews, questions, policy, evolution and goals, and the reasons are recorded (`rowWrites.ts:247-278`). An undo button that cannot deliver is worse than none.
15. **Stop.** No local `confirm<X>Id` state, no `Promise.allSettled` that discards rejections, no third row layout, no fifth reject-preset array, no verdict written from a `useEffect`.

**The contract between the halves**

16. **The token the card carries is the predicate the SQL runs.** `seenStatus` → `expected_status` → `WHERE status = ?`. Any layer that substitutes its own value for the reviewer's — reading the current row, defaulting to `'pending'` — has removed the guarantee while keeping the ceremony.
17. **The set of rows a queue counts must be the set the badge counts.** Register in `pending_counts`; otherwise the queue is real and invisible.
18. **Resolving the row and resuming the job are one act.** If they are two functions, every caller of the first must call the second — and a test must assert it, because the caller that forgets is a sweep nobody is reading.

## Anti-patterns

- **A verdict written as a generic field patch.** `updateKpi(id, { status: 'active' })` at four call sites. `dev_tools_update_kpi` builds a dynamic `SET` list and ends `WHERE id = ?` (`db/src/repos/dev_tools.rs:6807-6867`) — no expectation, no conflict error, no transaction. Two surfaces accepting the same proposed KPI both report success and the last writer wins silently. "Accept a proposal" being expressible as a field patch is the whole defect.
- **`seenStatus` optional, so nobody passes it.** `decideIdeaRow(id, verdict, options = {})` with `seenStatus?: string`. Two callers omit it (`useBacklogQueue.ts:114-117`, `useDevToolsActions.ts:57-58`) and `devToolsTriageSlice.ts:204,225` compensates by reading `get().triageItems.find(…)?.status ?? "pending"` — **substituting its own possibly-stale store for the reviewer's eyes.** That is a CAS that passes precisely when it should fail.
- **A bulk door with no expectation by construction.** `decideWorkspaceKnowledgeBulk(ids, decision)` (`src/api/devTools/workspaces.ts:184`) — the singular sibling one screen up takes `expectedStatus` and documents why; the batch version cannot carry one because its parameter is `string[]`. It is called from `KnowledgeLibrary.tsx:124` over a few hundred `observed` items, and `adopt` fans adoption cells into every member repo.
- **Resolving a queue row without resuming what it held.** `gc_stale_pending` (`manual_reviews.rs:542-600`) flips every stale `pending` to `'resolved'` in one transaction — correct as SQL, and it never calls `react_to_review_decision`. `'resolved'` is one of that function's two resume triggers, so the assignment the review was holding stays parked at `awaiting_review` **forever**, with an audit row saying the review was handled.
- **A blocking wait with no timeout and no human guaranteed.** `input_rx.recv().await` (`engine/build_session/runner.rs:1568`, `:1826`, `fanout.rs:778`). The `one_shot` lane already carries the fix and the incident that produced it (`runner.rs:1512-1528`, *"observed 2026-05-26: companion-driven build_oneshot stuck at AwaitingInput turn=1"*). Any new autonomous caller of a blocking pause re-introduces it.
- **A fallback that resolves rather than escalates.** `auto_triage`'s evaluator has a 120s timeout and `apply_fallback` writes `ManualReviewStatus::Resolved` on *any* failure — spawn, timeout, parse (`engine/src/auto_triage.rs:40`, `:487-503`). A broken evaluator is indistinguishable from a considered verdict.
- **Fourteen independent answers to "what if nobody answers".** Seven hang forever (build questions, trigger fires, ideas, practices, policy proposals, goal acceptance, and — because the sweep skips the resume — held assignments), four expire as reject (companion approvals 24h, remote commands 1h, two pairing ceremonies 300s), one ages out as `resolved` (manual reviews, 7d), one supersedes (evolution promotions). Not one of the seven hangers states that hanging is the intent.
- **A conflict message that does not match the contract.** `evolution_proposals::resolve` emits *"Proposal {id} is not pending (missing or already decided)"* (`db/src/repos/lab/evolution_proposals.rs:150-153`) — outside `/already (decided|resolved) … by a concurrent action/`. It is caught only because `rowWrites.ts:84-85` had to add two more patterns by hand. Every new phrasing is a new pattern somebody must remember to add.
- **A CAS whose side effect is not rolled back.** `policy_tuning_apply` writes the routing rule / budget ceiling **first** (`commands/execution/policy_tuning.rs:189-200`), then swaps (`:209-213`). A lost swap leaves the policy applied and the proposal owned by the other reviewer's verdict. Same shape at `commands/execution/evolution.rs:310-322`: `apply_promotion` runs before `resolve`, so a lost swap leaves the genome installed on a live persona.
- **`Promise.allSettled` on a batch of verdicts with the rejections discarded.** Fixed once at `ManualReviewList.tsx:250-263` (it now counts and reports failures) and still live at `KnowledgeLibrary.tsx:122-137`, which reports the server's `failed[]` but has no per-row expectation to lose in the first place.
- **A busy state per surface instead of per action.** `DecisionAction.loading` exists; 16 of 21 verdict surfaces hand-roll `isProcessing` / `busy` / `busyId` / `resolvingId` / `actingId` / `busyIds: Set<string>` / a `phase` state machine instead. Seven surfaces have **no in-flight guard at all**.
- **Two `REJECT_PRESETS` arrays with the same four members and two `presetLabel` switches with the same four cases.** `plugins/twin/sub_knowledge/KnowledgeAtelier.tsx:22,171-174` and `plugins/twin/sub_brain/RejectionPatternsPanel.tsx:18,41-44`. Worse: the preset is smuggled through the free-text `reviewer_notes` column as `<preset>: <note>` and re-parsed with `notes.indexOf(':')` (`RejectionPatternsPanel.tsx:60-66`), so a reviewer whose prose contains a colon is mis-bucketed.
- **Six reject-preset systems in two incompatible shapes.** Four typed `{ id, value, copy }` sets in `triageAdapters.ts` (English persisted, label translated) plus the two bare `string[]` sets in twin. The twin ones persist the raw token and translate at read time via a switch — which is *also* defensible, and that is the problem: nothing says which is the house shape.
- **An unread badge that is an animation offset.** `RevealItem`'s `reveal.newSince` is an entrance-stagger cursor, not seen-state. **No verdict queue in the app has unread/new-since tracking**; the only real implementation is `IncidentsInbox.tsx:95-101,267-282` (a `localStorage` `LAST_SEEN_KEY` + an "N new since your last visit" marker), and it sits on a queue that is not a verdict queue.
- **A roving-tabindex hook with zero consumers.** `src/hooks/utility/interaction/useRovingTabIndex.ts` is referenced nowhere in `src/**` — the primitive exists, eight verdict queues have no keyboard navigation, and nobody found it.
- **English composed in a verdict surface.** `KpiProposalsPanel.tsx` uses no `useTranslation` at all (≈12 hardcoded strings); `FactoryOverviewTab.tsx:450` builds `` `"${k.name}" ${status === 'active' ? 'accepted' : 'rejected'}` `` in a template literal; `ReviewFocusFlow.tsx:360,398,426,508-510,611-621` hardcodes "Review N of M", "Decision N of M", "Clear", "N accepted", "Retry", "Reject", "Approve" — two of them behind `DebtText k="auto_…"` markers, which is the debt being *tracked* rather than paid.
- **A ninth confirm idiom for the bulk verdict.** `BulkActionBar.tsx:29-58` arms an inline confirm inside the selection bar — not one of the eight in `delete-semantics.md`, and the only bulk verdict in the app with any confirmation. `KnowledgeLibrary`'s bulk adopt has none.
- **A verdict surface with no blast radius.** A reject writes a permanent `constraint` memory that suppresses the finding in every future scan (`rowWrites.ts:190-193`); an adopt fans cells into every member repo; an approve installs a genome on a live persona. **Zero of the 21 surfaces show what the verdict will do.** `delete-semantics.md` mandates `BlastRadiusPanelLazy` for deletes; nothing mandates the equivalent here, and the acts are comparable.

## Evidence

**Adoption, client.** **21 accept/reject verdict surfaces** across 8 features (query: files under `src/features/**` rendering a paired accept-ish and reject-ish control on a pending row). Of those: **5 files** import from `shared/components/decisions/` (4 in `overview/`, plus `shared/components/surface/SurfaceRenderer.tsx`); **13 files** import `@/lib/decisions/rowWrites`; **5 surfaces pass a `seenStatus`**; **6 files / 8 sites write a verdict outside the door** (5 KPI, 1 cloud-review); **1 surface has undo**; **4 queues have keyboard navigation** and 8 do not; **5 detail modals** step prev/next (3 sharing `nextQueueIndex`); **0 queues** track unread state. `rowWrites` is exercised most heavily by exactly one consumer: `useUnifiedTriage` uses 6 of the 8 doors and threads `seenStatus` on every one that takes it.

**Adoption, server.** **14 human-in-the-loop pause surfaces**; **6** are registered in `pending_counts`. **8 CAS implementations in 5 different shapes**: two take an `expected_status` parameter (`decide_idea_cas` required, `decide_knowledge_cas` optional), five hardcode `'pending'`, one re-reads the current status internally (`manual_reviews::update_status`). **One of the eight is transactional.** Two return `Err` on a lost swap that the frontend recognises; one returns `Err` with non-matching prose; one returns `(row, won_cas: bool)` deliberately (`triggers::resolve_pending_fire`, where a double-publish is worse than a silent no-op — `db/src/repos/resources/triggers.rs:290-327`). **Three verdict paths have no CAS at all**: `dev_tools_update_kpi` (dynamic `SET … WHERE id = ?`), `resolve_goal_acceptance` (pre-check then blind `update_goal`), `resolve_team_assignment_review`. Of ~24 verdict/resume commands, **5 carry a `#[requires(…)]` attribute** and 19 do not — including `policy_tuning_apply` (writes the monthly cost ceiling), `evolution_resolve_promotion_proposal` (rewrites a live persona's system prompt), `resolve_pending_trigger_fire` (publishes a held automation) and `pair_confirm` (writes an `owned_devices` row — while its cloud mirror `approve_pairing` *is* `#[requires(privileged)]`).

- **`db/src/repos/dev_workspaces.rs:797-870` `decide_knowledge_cas` — the reference server verdict. Copy this one.** Idempotent same-status success (`:828-830`), fail-fast expectation before the transaction (`:833-840`), swap inside `conn.transaction()` (`:846-855`), `tx.rollback()` on a lost swap so the adoption fan-out cannot fire for a decision that never committed (`:861`), re-read to name the winner (`:863-867`).
- **`src/features/agents/quick-answer/triage/triageDispatch.ts` + `useUnifiedTriage.ts:1017-1105` — the reference client verdict. Copy this one.** The three-branch write (`:1041-1093`) is the part to internalise: success journals and arms undo; `isDecisionConflict` keeps the card resolved, says so, and re-reads; anything else restores the card *and* the cursor.
- `commands/design/reviews.rs:1223-1307` `react_to_review_decision` — the reference resume, with all three gates and a `bool` return so the caller does not double-run the work. Its own comment (`:1239-1242`) records that `review.step_id` is provenance, not the resume target: the blocking step is a *different*, failed step.
- `db/src/repos/dev_tools.rs:4456-4498` `decide_idea_cas` — required `expected`; existence checked first so a missing row is `NotFound`, never conflict; two statements rather than a `COALESCE` so a reason-less reject can genuinely write `NULL` (`:4470-4473`).
- `src/commands/infrastructure/dev_tools.rs:584-587` — *"Swap against what we just read even when the caller named nothing"*: the command wrapper substitutes its own read only as a floor, and the frontend door still carries the reviewer's value on top.
- `db/src/repos/resources/triggers.rs:290-327` — the one place a lost swap is correctly a `bool` rather than an `Err`, with the reasoning (`won_cas` is the sole authority to publish; a second click must be a benign no-op, not an error the user retries).
- `rowWrites.ts:54-87` — the conflict-pattern block, and why the gap in pattern 1 is load-bearing: reviews say *"already RESOLVED by a concurrent action"* while ideas and practices interpose the winning status, so a pattern requiring the two halves to be adjacent silently misses two of five row types.
- `rowWrites.ts:247-278` `ReopenOptions` — what a reopen does **not** retract, named per row type. A reopened rejected idea is back in the queue and still suppressed in every future scan. Documented limits, not silent ones.
- `rowWrites.ts:296-310` `reopenIdeaRow` — the one place the module is honest about being weaker than its siblings: `dev_tools_update_idea` has no `expected_status`, so this swap is a read-then-write with a millisecond window, the message is byte-identical so no caller can tell, and the fix (`dev_tools_reopen_idea` wrapping `decide_idea_cas(.., "pending", ..)`) is written down.
- `triageSession.ts:12-44` — the "why localStorage" argument and the two bounds (12h TTL, per-collection caps). The right shape for per-reviewer working state that must never contradict SQLite.
- `AppKeyboardProvider.tsx:63-85` — the exclusive-surface break, and the incident comment: priority alone decides who sees a key *first*, not who may act on it, which is how one press decided two rows with one of them behind an opaque overlay.
- `overview/sub_incidents/components/IncidentsInbox.tsx:95-101,267-282,320-352` — the only complete "seen" implementation and the only true `j`/`k` index walk with `aria` position announcements. Not a verdict queue; it should be the template for one.
- `engine/build_session/oneshot.rs:410-516` `evaluate_promote_gate` — the correct failure direction for an automated gate: a report that cannot be read as a verdict returns `Held`, not `Promote`. The comment at `:391-398` records that the previous one-liner `unwrap_or(0) == 0` failed **open**.

## Deviations found

> **Second pass — what is upstream of all of this.** Both halves fail for one
> reason: **nothing in the app knows what a pending decision HOLDS.**
> `pending_counts` (`db/src/repos/dev_tools.rs:1338-1387`) counts six queues and
> is the closest thing to a registry — but it stores a number, not a link.
> Exactly one row type in the app records what its pause blocks
> (`persona_manual_reviews.assignment_id`), and it is the only one that can
> resume anything. Downstream of that single omission: the failure direction
> was chosen fourteen times independently and seven of those choices were
> "nothing" (§Anti-patterns); no verdict surface can show a blast radius,
> because there is nothing to query; the aging sweep resolves rows without
> resuming them, because the sweep operates on `status` and the link is
> invisible from there; and a KPI proposal — a queue that holds nothing — got
> no door at all, which is defensible right up until you notice it is the only
> queue in the app with no compare-and-swap. Give a pending row a
> `holds: (kind, id)` and a declared `on_timeout`, and most of the list below
> stops being reachable.

### P0 — the seam: a resolved review that never resumes its assignment

| Path | What's wrong |
|---|---|
| `db/src/repos/communication/manual_reviews.rs:542-600` + `src/engine/background.rs:816-836` | **`gc_stale_pending` flips every `pending` review older than 7 days to `'resolved'` with raw SQL and never calls `react_to_review_decision`.** It runs on *every launch*. `'resolved'` is one of the two statuses that trigger a resume (`reviews.rs:1229-1232`), so the sweep produces exactly the state the resume exists for and skips it. A team assignment parked at `awaiting_review` stays parked forever, the review leaves the queue, and a `policy_events` row records `review.stale_gc.resolved` — an audit trail asserting the item was handled. This is the leaf's defining defect: **clearing the row and resuming the job are two functions, and the caller nobody reads calls only one.** |
| `src/commands/design/reviews.rs:1081-1089` | The same sweep is exposed as `gc_stale_manual_reviews(threshold_days)` with **no `#[requires(…)]`**, no lower bound beyond `.max(1)`, and no confirm on the client (`ManualReviewList` calls it from a button). `threshold_days = 1` mass-resolves a day-old queue. |
| `src/engine/background.rs:815` | The 7-day threshold is a hardcoded `const` in the background module, duplicated as `.unwrap_or(7)` in the command (`reviews.rs:1086`) and mirrored again in a client comment. Three copies of a product decision, and the comment admits *"exposing it via app_settings is tracked as a follow-up"*. |
| `src/commands/design/reviews.rs:1229-1233` | **A rejection resumes nothing.** `react_to_review_decision` matches `Approved | Resolved` only; the doc (`:1218-1219`) calls this *"conservative by design … that mapping is a later increment"*. So the assignment a reviewer explicitly rejected stays `awaiting_review` with no signal, indistinguishable from one nobody looked at. |

### P0 — the KPI proposal queue is a governed queue with no door and no CAS

| Path | What's wrong |
|---|---|
| `db/src/repos/dev_tools.rs:6807-6867` | `update_kpi` builds a dynamic `SET` list and ends `WHERE id = ?`. `status` is just another optional column. **No `expected_status` parameter, no status predicate, no conflict error, no transaction** — the only human-decision queue in the app whose verdict is a fully blind UPDATE. |
| `src/features/teams/sub_kpis/KPIProposalsQueue.tsx:70-73` · `KPIProposalModal.tsx:43-63` · `sub_factory/KpiProposalsPanel.tsx:80-88` · `sub_factory/l2/FactoryOverviewTab.tsx:442-454` | **Four surfaces decide the same `status='proposed'` rows** through `updateKpi`. None passes an expectation; none shares a component; two have no in-flight guard at all (`KPIProposalsQueue` fires `void quickAccept(kpi)` and lets the `.catch` toast); `KPIProposalsQueue`'s reject and `KPIProposalModal`'s reject write different things than `KpiProposalsPanel`'s (`archived` vs the same, but reached through three code paths). |
| `src/commands/infrastructure/kpi_scan.rs:488-498` | The only backpressure is a **producer-side throttle** — a new scan is refused when too many `proposed` rows await review. The queue's failure direction is therefore "the scanner stops", not "the proposals age out". |
| `db/src/repos/dev_tools.rs:1357-1371` | KPI proposals are **not in `PendingCounts`**, so they never reach the title-bar decision badge. A queue that is real and invisible. |
| `src/features/teams/sub_factory/KpiProposalsPanel.tsx` | **No `useTranslation` import at all.** ≈12 hardcoded English strings on a verdict surface: "KPI proposals", "to review", "Scan for KPIs", "Scanning…", "No proposals waiting. Scan to have Claude propose measurable KPIs…", "Reading the context map — proposals appear here as they land.", "Adjust target / cadence", "Reject", "Accept", "target", "cadence", "applied on accept". |

### P0 — the CAS token is optional, so the layer beneath substitutes its own

| Path | What's wrong |
|---|---|
| `src/lib/decisions/rowWrites.ts:184-241` | `seenStatus?: string` inside `options: … = {}` on all five doors that take one. Omitting it is free, typechecks, and silently downgrades the write to "whatever the backend's hardcoded predicate says". |
| `src/stores/slices/system/devToolsTriageSlice.ts:204,225` | `const from = seenStatus ?? get().triageItems.find((i) => i.id === id)?.status ?? "pending"` — when a caller omits the token, the slice **satisfies the compare-and-swap from its own store**, which is exactly the state that goes stale. The swap then passes in precisely the case it exists to fail. |
| `src/features/overview/sub_manual-review/components/backlog/useBacklogQueue.ts:114-117` · `src/features/plugins/dev-tools/hooks/useDevToolsActions.ts:57-58` | The two callers that omit it. `useBacklogQueue.act` (`:104-112`) additionally `silentCatch`es the rejection — a failed verdict produces no toast, no restore, and no visible change at all. |
| `src/api/devTools/workspaces.ts:184-190` | `decideWorkspaceKnowledgeBulk(ids: string[], decision)` — **the bulk door cannot carry an expectation because its parameter shape has nowhere to put one.** Its singular sibling twenty lines up documents at length why the token matters, specifically for `adopt`'s cross-repo fan-out. |
| `src/features/overview/sub_patterns/KnowledgeLibrary.tsx:122-137` | The only caller: bulk adopt/reject over a few hundred `observed` practices, **no confirmation of any kind**, no expectation, and `adopt` seeds adoption cells into every applicable member repo. |
| `src/lib/decisions/rowWrites.ts:148-178` | **`resolveReviewRow` has no `seenStatus` parameter at all** — 8 call sites, the app's highest-volume verdict, and the one with a resume attached. `manual_reviews::update_status` does swap, but against a status it re-reads *inside itself* (`manual_reviews.rs:278`, `:307-315`), which closes the read→write interleave and does nothing about a card the reviewer has been looking at for ten minutes. |
| `src/features/agents/quick-answer/triage/triageDispatch.ts:89-102` | Goals carry no expectation either — honestly documented (*"a token threaded here would be a token nothing reads"*), because `resolve_goal_acceptance` (`db/src/repos/dev_tools.rs:1394-1424`) is a pre-check plus a blind `update_goal`. Two of seven row kinds in the unified queue therefore have no single-winner guarantee. |

### Server — CAS shape, transactions, and side-effect ordering

| Path | What's wrong |
|---|---|
| `db/src/repos/execution/policy_proposals.rs:162-183` · `db/src/repos/lab/evolution_proposals.rs:129-156` · `db/src/repos/execution/healing.rs:401-424` · `commands/companion/approvals/approval_lifecycle.rs:327-360` · `db/src/repos/resources/triggers.rs:300-327` | **Five CAS implementations hardcode `WHERE status = 'pending'`** (or the single legal predecessor). They cannot express "I saw X", so no reopen and no multi-pending-status queue can be built on them. |
| `db/src/repos/communication/manual_reviews.rs:267-324` | Not transactional, and the connection is explicitly `drop(conn)`-ed mid-function (`:419`) before the memory writers, to avoid pool exhaustion. The swap and its consequences are therefore not atomic on the app's most-used verdict. |
| `src/commands/execution/policy_tuning.rs:189-213` | **Applies the policy before the swap.** A lost swap leaves the routing rule / monthly cost ceiling written and the proposal row owned by someone else's verdict. The doc (`:130-131`) justifies the order — *"a failed write never strands an `applied` row"* — which trades one inconsistency for a worse one; the fix is one transaction, not a different order. |
| `src/commands/execution/evolution.rs:308-322` | Same shape, higher stakes: `apply_promotion` installs the winning genome on a live persona **before** `resolve` swaps. A lost swap leaves the persona rewritten. |
| `db/src/repos/lab/evolution_proposals.rs:150-153` | The conflict message is outside the `isDecisionConflict` contract, so it reaches the reviewer as *"could not record that decision"* — advice to retry a write that will never succeed. Two of the five `CONFLICT_PATTERNS` exist only to paper over this. |
| `db/src/repos/dev_tools.rs:1394-1424` | `resolve_goal_acceptance`: `if normalize_goal_status(&goal.status) != "awaiting_acceptance" { … }` then a plain `update_goal`. The read→write interleave is wide open. Same shape at `src/commands/teams/assignments.rs:188-245` (`resume_team_assignment`, `resolve_team_assignment_review`). |
| `src/commands/design/reviews.rs:1198-1210` vs `manual_reviews.rs:279-282` | `validate_transition` is enforced only inside `update_status`. `gc_stale_pending` writes the terminal status with raw SQL and bypasses it — legal here (Pending→Resolved is allowed) and unenforced in general: nothing stops the next sweep writing an illegal transition. |

### Resilience — the failure direction, chosen fourteen times

| Surface | Pause | If nobody ever answers | Stated? |
|---|---|---|---|
| Manual review | team assignment parks `awaiting_review` (`engine/team_assignment_orchestrator.rs:621-638`) | **`resolved` at 7d, assignment stays parked** | partially |
| Build questions | `input_rx.recv().await`, no timeout (`runner.rs:1568`) | **hangs forever; unanswerable after a restart** | no |
| Companion approvals | action not run | expires at 24h, row never flipped, action never runs | **yes** (`mod.rs:38-43`) |
| Approval-gated trigger fires | event not published | **hangs forever** — no TTL, no sweep | no |
| Backlog ideas | nothing runs | **hangs forever** | no |
| Workspace practices | nothing adopted | **hangs forever** | no |
| Policy proposals | policy unchanged | **hangs forever** | no |
| Evolution promotions | genome not installed | superseded (auto-rejected) by the next cycle | **yes** (test `newer_proposal_supersedes_pending_one`) |
| Goal acceptance | goal not `done` | **hangs forever** | no |
| KPI proposals | KPI not active | hangs; the *scanner* throttles instead | no |
| Cloud reviews | server-side | unknown locally | n/a |
| Remote run-requests | command not executed | `expired` at 1h | **yes** (`remote_commands.rs:32-36`) |
| P2P device pairing | device not trusted | evaporates at 300s | **yes** (`device_pairing.rs:86`) |
| Cloud-origin pairing | key not minted | evaporates at 300s | **yes** (`pairing.rs:37-42`) |
| *(auto_triage)* | — | **resolves on evaluator timeout/parse failure** (`auto_triage.rs:487-503`) | in code, not in product |

Five of fifteen state their intent. Seven hang silently. The one queue that ages out does so into `resolved` — the neutral verdict — which is a defensible product choice and the *only* one of the fourteen where the choice is not visible to a reader of the queue's own module.

### Client — the 21 surfaces

| Path | What's wrong |
|---|---|
| `src/stores/slices/overview/overviewSlice.ts:22,524` | `respondToCloudReview` calls `cloudRespondToReview` directly, the one surviving import of a verdict wrapper from `@/api/**` outside the door. `resolveReviewRow` already routes local vs cloud (`rowWrites.ts:153-162`) precisely so this branch exists once. |
| `src/features/teams/sub_kpis/KPIProposalsQueue.tsx:70-73,169,178` | Verdict buttons with **no in-flight state**: a double-click fires two writes. Also the only queue-shaped verdict table in the app that hand-rolls `<table>` instead of `UnifiedTable` while implementing the loading-v2 ghost/cascade by hand (`:23-29`, `:199-267`). |
| `src/features/plugins/twin/sub_knowledge/KnowledgeAtelier.tsx:22,161-174,382` · `sub_brain/RejectionPatternsPanel.tsx:18,41-44,60-66` | `REJECT_PRESETS` and `presetLabel` duplicated verbatim; the structured preset is persisted inside a free-text column as `<preset>: <note>` and recovered by `indexOf(':')`. A reason containing a colon is silently mis-bucketed into `__other`. |
| `src/features/overview/sub_manual-review/components/ReviewFocusFlow.tsx:360,398,426,508-510,606-623` | Seven hardcoded English strings on the reference review surface, two of them wrapped in `DebtText k="auto_…"` (debt tracked, not paid). Also `:71` takes `isProcessing` as one boolean for the whole flow, so a verdict in flight disables navigation. |
| `src/features/teams/sub_factory/l2/FactoryOverviewTab.tsx:450` | `` setNote(`"${k.name}" ${status === 'active' ? 'accepted' : 'rejected'}`) `` — a verdict confirmation composed in a template literal. |
| `src/features/overview/sub_manual-review/components/ManualReviewList.tsx:186-203` | The verdict handler is an overloaded `(idOrStatus, statusOrNotes, maybeNotes)` with a runtime `['approved','rejected','pending'].includes(...)` discriminator and a `// Legacy:` branch. The app's busiest verdict entry point cannot be typechecked. |
| `src/features/overview/sub_manual-review/components/BulkActionBar.tsx:29-58` | A ninth confirm idiom (inline arm inside the selection bar), uncounted by `delete-semantics.md`, and the only bulk verdict in the app with any confirmation at all. |
| 8 verdict queues | **No keyboard navigation**: `ManualReviewList` inbox mode, `ReviewInboxPanel`, `BacklogTable`, `KnowledgeLibrary`, `KnowledgeApprovalsPanel`, `KPIProposalsQueue`, `KpiProposalsPanel`, `GoalsTriage`. Three of the four that *do* have it map only verdict keys (←/→), not a list walk — `IncidentsInbox` is the sole `j`/`k` index walk, and it is not a verdict queue. |
| `src/hooks/utility/interaction/useRovingTabIndex.ts` | Zero consumers anywhere in `src/**`. Dead primitive beside eight keyboard-less queues. |
| every verdict queue | **No unread / new-since state.** Only a pending count. A reviewer who cleared a queue yesterday cannot see what arrived overnight; `IncidentsInbox`'s `LAST_SEEN_KEY` marker is the pattern and nobody adopted it. |
| `src/features/plugins/companion/ApprovalCard.tsx:28,38,51` · `plugins/fleet/FleetTileAthenaBar.tsx:50,60` · `plugins/twin/sub_channels/ReplyOutbox.tsx:169` · `vault/sub_catalog/…/CapabilityApprovalCard.tsx:93` | Verdict pairs on row types with **no `rowWrites` door**, so each re-derives its own busy state and error handling — the exact condition the module was created to end, re-forming in four features. |
| 16 of 21 surfaces | Hand-rolled busy state (`isProcessing` / `busy` / `busyId` / `resolvingId` / `actingId` / `busyIds: Set` / a `phase` machine) while `DecisionAction.loading` sits unused. |
| `src/features/agents/quick-answer/triage/triageDispatch.ts:163` | Approving a review drops `reason`: `ports.reviewAction(item.sourceId, 'approved')` with no notes, while the reject branch passes them. An approval cannot be annotated from the deck even though `update_manual_review_status` takes `reviewer_notes`. |
| `src/features/agents/quick-answer/QuickAnswerPopover.tsx:100-104` | The 8,024-line unified triage subsystem — the app's only implementation of a fused queue, undo, session persistence, bounded skip, keyboard walk and conflict handling — has **exactly one consumer**, a title-bar popover. The eight keyboard-less queues above are separate code. |

### Security — the verdict surface's authorization posture

| Path | What's wrong |
|---|---|
| `src/commands/execution/policy_tuning.rs:132` · `src/commands/execution/evolution.rs:281` · `src/commands/tools/triggers.rs:184` · `src/commands/companion/approvals/approval_lifecycle.rs:74,270` | Four verdict commands with base auth only, each with a large blast radius: **writes the monthly cost ceiling and model-routing rules**, **overwrites a live persona's system prompt**, **publishes a held automation event**, **executes an arbitrary Athena-proposed action**. |
| `src/commands/network/pairing.rs:41` | `pair_confirm` writes an `owned_devices` row — device trust — under `require_auth` only, while its cloud-origin mirror `approve_pairing` (`commands/credentials/external_api_keys.rs:154`) is `#[requires(privileged)]` and listed. The same act, two tiers, by accident of which lane it arrived on. |
| `src/commands/design/reviews.rs:1081,1092` | `gc_stale_manual_reviews` (mass-resolve at a caller-supplied threshold) and `delete_all_manual_reviews` (wipe the queue) carry base auth only. |
| `src/commands/infrastructure/dev_tools.rs:621` | `dev_tools_reject_idea` writes a permanent `constraint` memory that suppresses the finding in **every future scan**, under base auth, with no confirm and no blast radius on the client. |

## Gaps in the primitives

1. **`seenStatus` is optional at every layer, and optionality is why it is missing.** `IdeaVerdictOptions.seenStatus?: string` inside a defaulted `options` object; `expected_status: Option<String>` on the two commands that take one; `Option<&str>` in `decide_knowledge_cas`. The one place it is required (`decide_idea_cas`'s `expected: &str`) is also the one place a caller cannot forget it — and the command wrapper immediately re-supplies a value when the frontend sent none (`dev_tools.rs:584-587`), which is a floor, not the guarantee. **This is the type-over-gate opportunity; see §9.**
2. **There is no door for four row types.** KPI proposals, goal acceptance, companion approvals and capability/pairing approvals all have verdict surfaces and no entry in `rowWrites.ts`. Adding a door is ~15 lines and it is where the rejection contract, the conflict wording and the reopen limits live — but nothing routes an author there, so the fifth surface writes through `@/api` and the sixth copies the fifth.
3. **No bulk door, and the bulk API cannot carry an expectation.** `decideWorkspaceKnowledgeBulk(ids: string[], decision)` is the only batch verdict command, and its parameter shape has nowhere to put a per-row seen status. `ManualReviewList` gets bulk by `Promise.allSettled` over the singular door — correct, but it means the fan-out cost is N round-trips and the two batch paths in the app share nothing.
4. **`DecisionAction.onClick: () => void`**, so the primitive cannot own the in-flight lock. A verdict is always async and always rejectable; if the signature were `() => Promise<void>`, `DecisionActions` could hold `loading`, disable the sibling action, and hand the rejection back — and the 16 hand-rolled busy states would be deletable. This is the exact `ConfirmDialog.onConfirm` defect `delete-semantics.md` Gap #3 names, in the constructive half of the app.
5. **`DecisionRecord` carries no status and no verdict token.** It has `title`, `summary`, `category`, `facts`, `timestamp` — everything needed to *render* a decision and nothing needed to *write* one. So the CAS token is threaded around the component tree by hand (`item.payload?.seenStatus`), which is why five of 21 surfaces have it.
6. **No blast radius for a verdict.** A reject writes a permanent constraint; an adopt fans cells into every member repo; an approve installs a genome. `delete-semantics.md` mandates `BlastRadiusPanelLazy` for destruction and this repo has three `*_blast_radius` commands — none for a verdict, and no primitive to show one. The reviewer's information about consequences is currently the button's colour.
7. **No unread/seen primitive.** Six independent implementations of "unread" exist (DB counters, Zustand slices, two `localStorage` markers, a hook-local `Set`), none on a verdict queue, and `RevealItem.newSince` is an animation offset that reads like one. A `useSeenMarker(key)` returning `{ newCount, markSeen }` is ~20 lines and would serve all seven queues.
8. **No keyboard-queue primitive.** `useRovingTabIndex` exists with zero consumers; `IncidentsInbox` hand-rolls the id-cursor walk, focus management and `aria` announcements in 30 lines; `useDeckControls` hand-rolls a different one in 100. A `useQueueCursor(items)` returning `{ cursorId, next, prev, bindings }` — **keyed by id, never index** — is the missing shared piece, and both sibling repos independently wrote the same warning about index cursors.
9. **`pending_counts` is a rollup, not a registry.** It knows six queues by name in one `impl` and nothing about what any of them holds, when they expire, or which command decides them. A `PendingQueue { table, pending_statuses, decide_command, on_timeout, holds }` descriptor would let the badge, the deck, the sweep and the gate below all read the same list — and would have made "seven queues hang forever" visible the day the seventh was added.
10. **The conflict contract is prose matched by regex.** Five patterns in TypeScript pinned against five `format!` strings in Rust, across three crates, with two of the patterns existing only because one implementation phrased it differently. A typed error variant (`AppError::DecisionConflict { id, actual }`) would make the match structural; the repo already has `typed-error-contract.md` for exactly this shape.
11. **`gc_stale_pending` has no counterpart for the other thirteen queues, and no way to acquire one.** It is a bespoke sweep for one table with a hardcoded threshold. There is no "age out pending rows" mechanism a new queue can opt into, which is a large part of why seven queues opted into nothing.
12. **Zero enforcement.** 21 custom ESLint rules, none about verdicts. `check:contracts` parses every `#[tauri::command]` and checks nothing about `expected_status`. Every deviation above shipped green.

## The missing gate

Everything above shipped under a green `npm run check`. Worth naming precisely, because this leaf has the *inverse* of the `delete-semantics` pathology: there, four artifacts manufactured confidence; here, the machinery is genuinely excellent — `rowWrites` is a well-argued single door, `decide_knowledge_cas` is a textbook CAS, `triageDispatch` is fully tested — and **none of it is load-bearing, because using it is optional at every layer.** Two gates: one that counts the bypasses, one that asserts the seam.

### Prefer a type over a gate — the answer for this leaf

**Yes, and it is available in two moves, both of which delete a whole deviation class.**

*Move 1 — make the token unforgeable and unforgettable (client).* Today the CAS token is an optional `string` that any caller can supply, omit, or invent. Brand it and mint it only at render:

```ts
// decisionTypes.ts
declare const SeenBrand: unique symbol;
/** The status a row was RENDERED with. Only `toDecisionRecord` can mint one. */
export type Seen = string & { readonly [SeenBrand]: true };

export interface DecisionRecord { /* … */ readonly seen: Seen; }
export interface DecisionAction {
  /* … */ onDecide: (seen: Seen) => Promise<void>;   // was: onClick: () => void
}
```

`DecisionActions` calls `a.onDecide(record.seen)` with the token *it was rendered with*; `rowWrites` doors take `seenStatus: Seen` (required, not in an options bag). The consequences are the point: a handler that closes over a captured id but not the rendered row **cannot typecheck**; `devToolsTriageSlice`'s `?? get().triageItems.find(…)?.status` cannot compile, because a store lookup returns `string`, not `Seen`; a verdict written from a `useEffect` or a bulk loop over ids has no token to pass and must be re-shaped to carry rows; and `onDecide` returning `Promise<void>` lets the primitive own `loading` and the rejection, retiring Gap #4 and 16 hand-rolled busy states in the same change. The bulk door becomes `decidePracticesBulk(rows: Array<{ id: string; seen: Seen }>, decision)`, which is the shape it should always have had.

*Move 2 — make "verdict" not expressible as a field patch (server).* `dev_tools_update_kpi` accepts `status` as one optional column among fifteen, which is why four surfaces write a verdict through it. Remove `status` from `UpdateKpiInput` and add `dev_tools_decide_kpi_proposal(id, verdict: KpiVerdict, expected_status: String)` with a real swap. A proposal verdict then has exactly one door, the same as the other five row types, and *cannot* be written by a PATCH — the census rule below stops needing its second alternative.

Both moves are mechanical, both are compile-time, and between them they make five of the six §Deviations P0 entries unrepresentable rather than merely counted. **Propose the types as the fix; the census rule below is the ratchet that holds the line until they land.**

### Gate A (census rule) — a verdict written outside the one door

- **The condition it is a proxy for.** *A human verdict reaches the backend without carrying the status the reviewer's card rendered.* That condition has no direct textual form — absence is not greppable — so the rule keys on the two shapes it wears in **this** repo: a verdict-writing IPC wrapper imported straight from `@/api/**` (bypassing `rowWrites`), and a proposal verdict expressed as a generic field patch (`updateKpi({ status })`). **An adopting repo must re-derive its own proxy**: the shapes above are local, but "which module is allowed to write a verdict, and does the write carry an expectation" is not.
- **Mechanism.** A `scripts/census/rules.json` entry — no new script. `npm run census` reports, `npm run census:check` gates.
- **Precision, measured.** 6 files / 8 matches, all true positives: the four KPI proposal surfaces plus `FactoryOverviewTab`, and `overviewSlice`'s direct `cloudRespondToReview` import. **Known false negative, stated rather than hidden:** the rule cannot see a verdict written through a *differently named* generic PATCH command, because "generic PATCH" has no name. That is precisely what Move 2 above fixes — and once `status` leaves `UpdateKpiInput`, the second alternative can be deleted and the baseline ratcheted to `{ files: 1, matches: 1 }`.
- **How it fails loudly if its own precondition is absent.** Inherited from the runner and verified by deliberately breaking it four ways (results below): floor breach, zero matches, stale exclude, and drift in **both** directions. A silent drop is treated as a broken matcher, not as fixed code.

```json
{
  "id": "verdict-write-outside-door",
  "goldenPath": "docs/concepts/golden-paths/human-review-queue.md",
  "title": "A human verdict written without going through the one verdict door",
  "roots": ["src"],
  "extensions": [".ts", ".tsx"],
  "signal": {
    "pattern": "(?:import\\s*\\{[^}]*\\b(?:updateManualReviewStatus|dispatchReviewAction|cloudRespondToReview|acceptIdea|rejectIdea|decideWorkspaceKnowledge|policyTuningApply|policyTuningDecline|resolvePromotionProposal)\\b[^}]*\\}\\s*from\\s*['\"]@/api/)|(?:updateKpi\\s*\\([^)]*\\bstatus\\b)",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "A verdict-writing IPC wrapper imported straight from @/api/**, or a KPI proposal verdict expressed as updateKpi({ status }) — both write a human decision without the compare-and-swap door in src/lib/decisions/rowWrites.ts"
  },
  "exclude": [
    {
      "path": "src/lib/decisions/rowWrites.ts",
      "reason": "the verdict door itself — it is the module every other call site is being routed TO, so it must import the raw API wrappers"
    },
    {
      "path": "src/features/teams/sub_kpis/useKpiDetail.ts",
      "reason": "pause/resume/archive on an ALREADY-accepted KPI is a lifecycle edit, not a human review verdict — no proposal row is being decided, so no seen-status expectation exists to carry"
    },
    {
      "path": "**/__tests__/**",
      "reason": "test files legitimately import raw verdict wrappers to assert the door forwards to them"
    },
    {
      "path": "**/*.test.ts",
      "reason": "test files legitimately import raw verdict wrappers to assert the door forwards to them"
    },
    {
      "path": "**/*.test.tsx",
      "reason": "test files legitimately import raw verdict wrappers to assert the door forwards to them"
    }
  ],
  "baseline": { "files": 6, "matches": 8 },
  "floor": 4000
}
```

**Validated** with `node scripts/census/run-census.mjs --rules <tmp> --check --verbose`: `OK  verdict-write-outside-door  files 6 (base 6)  matches 8 (base 8)  walked 4829  floor 4000`, exit 0. Exclude hit counts: 1 / 1 / 336 / 62 / 6 — no stale exemption. Deliberate breakage results are recorded in the composition report.

### Gate B (the seam) — every path that clears a review must resume what it held

The gate nobody has, and the one the leaf turns on.

- **Signal.** A held `team_assignments` row whose linked `persona_manual_reviews` row leaves `pending`. The link already exists (`assignment_id` / `step_id`), so this is a two-table join, not new infrastructure.
- **Mechanism.** A Rust `#[test]` beside `gc_stale_pending` in `personas-db`: seed a persona + an assignment parked at `awaiting_review` + a failed step + a `pending` review created 30 days ago carrying `assignment_id`; run `gc_stale_manual_reviews_inner` with a 7-day cutoff; assert (a) the review is no longer `pending`, **and (b) the assignment is no longer `awaiting_review`**. **It fails today on (b)** — that is the P0. A second case pins the positive control: the same fixture resolved through `update_manual_review_status` *does* resume, so a green run distinguishes "the resume works and the sweep skips it" from "nothing resumes anything".
- **Which lane it runs in.** `cargo test -p personas-db`, i.e. the `--workspace` job in `ci.yml` (added by `ad91bd538`). **`npm run test:rust` does NOT run crate tests** — it passes `--lib` against the root manifest — so a test placed here and validated only through that script would be written, merged, marked done and never executed. `delete-semantics.md`'s corrections pass records that exact trap; do not repeat it.
- **Allowlist.** Advisory reviews (`assignment_id IS NULL`) are exempt by construction — they hold nothing. Nothing else is: if a review holds work and a path clears it without resuming, that is the defect.
- **How it fails loudly if its precondition is absent.** Three ways this could no-op, all asserted before the act: `assert!(reviews_swept > 0, "the GC swept nothing — the fixture's created_at is not past the cutoff")`; `assert_eq!(assignment_before.status, "awaiting_review")` so a fixture that never parked cannot vacuously pass; and `assert!(review_before.assignment_id.is_some())` so a link that silently stops being written turns the whole test green forever. A gate over a seam must prove the seam exists before it asserts anything about it.

### Gate C — what a machine cannot catch here, and therefore belongs to review

**The failure direction is not a static property.** No signal distinguishes a queue that hangs forever *by decision* from one that hangs *by omission* — both are the absence of a constant. The only mechanical foothold is Gap #9's `PendingQueue` descriptor: make every queue declare `on_timeout`, and the gate becomes "every entry in `pending_counts` has one", which is a compile error rather than a linter. Until that exists, "what happens if nobody answers this?" is a question for the PR checklist on any change that adds a `pending` status — and the honest finding is that this repo has answered it fourteen times and written the answer down five.

## Convergence — what two sibling repos independently arrived at

Per the contract, convergence is the portability oracle. Both siblings were read fresh, with no shared document.

**`../brainiac`** (Rust/Postgres + Next.js console) — its promotion queue is the **reference CAS in any repo I have read**: `UPDATE promotions SET … WHERE id = $1 AND reviewed_at IS NULL` behind a `SELECT … FOR UPDATE OF p`, `rows_affected() == 0` → **409**, plus a rollback when the second half of the write (the memory's status) affects zero rows so a phantom approval cannot commit (`crates/brainiac-server/src/console.rs:149-257`). Its comment states the rule this path states: *"never a last-writer-wins reviewer."* Its console has `j`/`k`/`a`/`r`, bulk capped at 200, and an **id-based cursor** whose docstring explains that an index cursor would "silently re-point at the neighbouring claim while the operator believed they were still looking at the one they had read — and `a`/`r` would sign it."

**`../personas-web`** (Next.js) — not simpler: two review modes, a shortcuts HUD, shift-click range select, bulk with a progress meter, and a **5-second undo** whose unmount cleanup deliberately *flushes* rather than cancels. Its keybindings are `j`/`k`/`a`/`r`. Its write is a **blind `PUT { status }`** with no expectation, no `If-Match`, no 409 handling — guarded only by browser-local locks, which two operators in two browsers defeat.

| | Personas (this repo) | brainiac | personas-web |
|---|---|---|---|
| **Expectation in the write** | 5 of 8 CAS impls; 3 verdict paths blind | **Yes** — predicate + row lock + rollback + 409 | **No** — blind PUT, client-side locks |
| **Verdict typed** | `ManualReviewStatus` enum server-side; `string` on the wire for KPI/goal | `bool` in, `&'static str` to SQL, **no DB CHECK**; `"approved"` is not even a `PolicyDecision` variant | TS literal union, erased at runtime, lossily remapped `approved→processed` |
| **Failure direction** | 7 hang · 4 expire-as-reject · 1 age-out to `resolved` · 1 supersede | **auto-REJECT at 30d** (sweep ships disabled → stock = pending forever *and served*) | **auto-APPROVE at 8h** for `info` (ships disabled) |
| **Unread/seen** | none | none | none |
| **Undo** | 1 surface of 21 | none | yes (5s, flush-on-unmount) |
| **Backend pauses?** | **yes** — build sessions block; team assignments park | no — advisory, pipeline continues | no |

**Reinvented independently, therefore doctrine, not local taste:** `j`/`k`/`a`/`r` keybindings; an **id cursor, never an index** (both siblings wrote near-identical warnings, and both were written before this repo's `useUnifiedTriage:20-24` wrote a third — *"Index cursors desynchronise the moment anything else mutates the list"*); bulk-with-confirmation; and **shipping the automatic verdict disabled by default**.

**Divergent, therefore a real product decision that must be stated rather than inherited: the failure direction is exactly inverted between the two siblings** — brainiac's timeout rejects, personas-web's approves — and this repo lands in the middle with `resolved`. That is the strongest argument in this document for Gap #9's `on_timeout` field: three codebases in one operator's portfolio made three different choices, none of them wrong, and only one wrote it where a reader of the queue would find it.

**Unique to this repo, and therefore where the doctrine must come from here rather than from a sibling: only Personas actually pauses a backend job on a human.** In both siblings, "the job waits for a human" is really "the artifact stays unpublished while the pipeline keeps running." That is why §"The contract between the halves" — resolve and resume are one act — has no external precedent to lean on, and why the seam is where the P0 was found.
