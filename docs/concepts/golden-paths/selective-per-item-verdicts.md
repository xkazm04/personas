# Golden path — Selective per-item verdicts

> Situation node: `ai-agents/human-review/selective-per-item-verdicts` ·
> [situation spine](../situation-spine.md) · recurrence **10** · risk **HIGH** ·
> sides: **client** (the spine also carries `twoSided: true` — see [§12.1](#12-corrections-to-the-brief)) ·
> convergence: **diverged** · dimensions: **function · ui · resilience · cost**
> Composed 2026-08-16 against `master` @ `2a874e692`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` files under `src/`, walked **three** times — twice by the
> census engine (rule + control) and once by an independent structural counter that blanks comments,
> strings, template literals **and regex literals**, then extracts every `useState` type argument by
> angle-bracket balancing and every `.map(… => ({…}))` body by brace balancing. The Rust half was
> **not** swept whole; it was read at the four doors this leaf owns
> (`commands/core/memories.rs`, `db/src/repos/core/memory_review_proposal.rs`,
> `commands/companion/backlog_triage.rs`, `db/src/repos/communication/manual_reviews.rs`) plus the
> two producers that create the batches (`engine/dispatch.rs`, `engine/src/prompt/templates.rs`).
> Six neighbouring census rules were re-run to measure overlap; all six reproduced their committed
> baselines exactly.
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347 MB, 244 tables) and `personas_data.db` (17.5 MB, 71 tables) were taken
> 2026-08-16 21:20 with the app running; the live files were never opened for write and **the copies
> were deleted at the end of composition**. Two things were then replayed verbatim against scratch
> SQLite (`node:sqlite`, statements and DDL transcribed from this tree): the **whole body of
> `apply_persona_memory_review_proposal`** over the operator's real 11-entry proposal under four
> scenarios, and **`load_pending`'s consent-freshness predicate** over the eight real triage
> approvals. §0 publishes what the reviewer is offered beside what happens. **Nothing was resolved,
> approved, rejected or applied in the live app**, and `cargo` was not run.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It produced this document's sharpest clause
> ([§6 clause 2](#convergence--5-sibling-repos)), **inverted the brief's central assumption**
> (§12.2), and returned two silences that matter more than any agreement.
>
> **Settles:** where a subset of a generated batch is collected, what the wire can carry, what an
> abandoned partial verdict leaves behind, and whether an un-reviewed item is distinguishable from a
> rejected one.
>
> Cross-reference, not overlap. [`human-review-queue`](./human-review-queue.md) owns **the queue and
> the verdict on one row** — the CAS, `rowWrites`, the resume seam, the failure direction. This path
> owns **the N sub-items inside one row**. [`bulk-command-variant`](./bulk-command-variant.md) owns
> **one verdict over N rows**; this is its mirror — **N verdicts over one row** — and the two meet in
> §12.4.

---

## 0. The headline

**This repo asks the model to produce per-item verdicts, renders per-item controls for them, and
then stores one status for the batch.** On the operator's live install there are **258 per-item
verdicts** across three shapes, and **not one of them is recoverable as a per-item fact**:

| where | batches | sub-items | what survives |
|---|---:|---:|---|
| `persona_manual_reviews.context_data → decisions[]` | **47** of 194 reviews | **184** | one `status` for the batch; **0** rows record any per-item verdict |
| `persona_memory_review_proposal.proposal_json → entries[]` | **4** | **24** | `pending_review` on all four, `decided_at` NULL, **37–98 days old** |
| `companion_approval.payload → items[]` (the compliant shape) | **8** | **50** | staged per item, all 8 `pending` — and all 8 **past the 24 h consent window** |

The contrast that makes it a defect rather than a design is inside the same database. Where the same
concept is stored as **N rows** instead of a JSON array under one status, the per-item facts survive:
`dev_ideas` holds 158 accepted / 54 pending / 24 rejected, and **23 of the 24 rejections carry a
`rejection_reason` (96%)**. Where it is stored as an array, the reason coverage is **0 of 208**.

### Executed, not argued — the apply door

Replayed verbatim from `commands/core/memories.rs:874-1042` and
`db/src/repos/core/memory_review_proposal.rs:198-207`, over the operator's real 11-entry proposal
`memprop_56af47cd…` (10 × `synthesize`, 1 × `archive`, touching 52 distinct memory ids):

```
A1  apply_persona_memory_review_proposal(proposal_id)   <- the ONLY apply door
      before {"status":"pending_review","rows":52,"archived":0}
      after  {"status":"applied",       "rows":62,"archived":52}
      11 of 11 entries executed. 10 insights created, 52 memories archived.
      The signature has no parameter for a subset.

A2  discard_persona_memory_review_proposal(proposal_id)
      after  {"status":"discarded","rows":52,"archived":0}      0 of 11 entries executed.

A3  the process dies before entry 5 of 11
      proposal row: {"status":"applied","decided_at":set,"rows":57,"archived":33}
      -> 5 entries executed, 6 never run, and NOTHING on disk records which.
      retry: mark_applied's own `WHERE status='pending_review'` returns 0 rows,
             so the command answers "already applied by a concurrent action" and bails.

A4  double-apply: second call flipped=false  -> the CAS holds; no double-delete.
```

A1 and A2 are the entire decision surface. **A reviewer who wants 3 of 11 has two buttons: all
eleven, or none.** A3 is worse than a lost verdict — the status is flipped to `applied` *before* the
loop (`memories.rs:901`, a deliberate and well-argued CAS against double-application) and the loop
runs on a pooled connection with no transaction, so an interruption leaves an arbitrary prefix
applied, the row asserting the whole thing landed, and the CAS refusing the only retry. The file
says so itself:

> *"Status was already flipped to `applied` up front (CAS); entries that failed are surfaced in
> `errors`. **Full per-batch transactional rollback on a mid-apply crash is a remaining follow-up.**"*
> — `memories.rs:1031-1033`

### Executed, not argued — the abandoned partial verdict

`load_pending` (`commands/companion/approvals/approval_lifecycle.rs:292-318`) replayed verbatim,
`APPROVAL_FRESHNESS_WINDOW = "-24 hours"` (`approvals/mod.rs:43`), against the eight real triage
approvals in `personas_data.db`:

```
now = 2026-08-16 21:34:13
appr_60afc78…  2026-08-10 17:41:06  pending  fresh=0  -> Err(Validation: expired)   12 items (4 accept / 8 reject)
appr_e418a56…  2026-08-10 17:42:09  pending  fresh=0  -> Err(Validation: expired)    8 items
appr_5707e5d…  …:42:13  …  expired    7 items          appr_2f1b687…  …:42:16  …  expired   5 items
appr_5b5bfac…  …:42:20  …  expired    3 items          appr_169a278…  …:42:24  …  expired   1 item
appr_80d82d2…  …:42:27  …  expired    5 items          appr_afd8554…  …:42:31  …  expired   9 items
```

**8 of 8 expired. 50 per-item verdicts permanently unappliable.** This is the answer to *"what
happens when a reviewer decides 3 of 5 and closes the window"*, measured rather than reasoned: the
staged verdicts live in a `pending` approval row, nothing sweeps it, nothing surfaces it after 24 h,
and at hour 25 the only door that could apply them refuses. Zero of the eight carry the `overridden`
annotation `note_applied` writes (`backlog_triage.rs:290`), so **the best implementation of this leaf
in the repo has never successfully completed a run.**

### Four surfaces stage a per-item verdict map; three of them throw it away

| surface | how N verdicts become 1 | where the per-item map goes |
|---|---|---|
| `ReviewDetailPanel.tsx:96,:315-341` | the reviewer presses Approve **or** Reject, independent of the map | flattened to `"Decisions:\n+ label\n- label"` in `reviewer_notes`; **ids stripped**, undecided items **omitted entirely** |
| `ReviewFocusFlow.tsx:80,:174-186` | **derived: `anyAccepted ? approved : rejected`** — one accept out of eight approves the batch | same flatten, same loss (`buildVerdictNotes`, `:141-156`) |
| `MessageDetailModal.tsx:876,:858-859` | the reviewer presses Approve or Reject — and **Approve is `disabled` if any item is rejected** (`:949`) | **discarded.** `onApprove: () => void` has no parameter to put it in |
| `AthenaVerdictCard.tsx:69,:105-112` | **it doesn't** — the map is the payload | `batch.items.map((i) => ({ ideaId, verdict, reason }))` → `Vec<TriageOverride>` |

Three of the four are the same three files the census rule matches. The fourth is the exemplar.
`MessageDetailModal`'s own comment states the constraint plainly and then keeps the UI anyway:

> *"the parent's Approve/Reject **still resolves the whole review (single status on the backend)**,
> but the local verdicts capture intent so the user can see a coherent decision summary before they
> commit."* — `MessageDetailModal.tsx:864-870`

### And the batch verdict is what the app learns from

`manual_reviews::update_status` writes a memory for every approve and reject
(`manual_reviews.rs:337-357`) — the repo's standing product rule, **and it holds**. What it writes is
`"Human {approved|rejected} the review \"{title}\". Reviewer notes: {notes}. Apply this decision to
future work."`, filed as a team `decision` (importance 7) or `constraint` (importance 8)
(`:379-382`). So a 3-of-8 approval, if the reviewer used the per-item controls at all, teaches the
model a sentence whose verb and whose notes **contradict each other** — `Human approved …` followed
by five `- ` lines. Live: **237** human-review team memories, **236** of them category `decision`,
and **0** of any memory in either store carries a `Decisions:` block — **0 of the 10
human-review `persona_memories` rows and 0 of the 237 team rows** — because **0 of 194
`reviewer_notes` rows ever did.** (16 rows tree-wide do match `Decisions:`; all 16 are
session-capture and ADR memories from unrelated writers, checked.)

### Where the 184 sub-decisions actually went

| how the 47 decision-carrying reviews were resolved | count |
|---|---:|
| **auto-triaged** — one LLM verdict for the whole batch, no human ever saw the items | **35** |
| `dispatch_review_action` — a *suggested action* pick, a different control (`reviews.rs:1328`) | 9 |
| resolved with empty notes | 3 |
| **resolved carrying a per-item verdict map** | **0** |

The per-item control has been rendered for 184 items and has produced zero durable verdicts. The
producers are not the problem: `engine/dispatch.rs:579-586` deliberately merges `decisions` into
`context_data` *"so they're available in the frontend"*, and `engine/src/prompt/templates.rs:295`
**teaches the model to emit them**, complete with per-item `id`s and the suggested actions
`"Accept valuable signals"` / `"Reject noise"`. The whole pipeline is built to produce a per-item
verdict and has nowhere to put one.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path, primitive
name or count. Each clause names its warrant.

> **P1 — physics, and everything else follows.** **If a human is shown N items and can decide them
> individually, the outcome space is N verdicts, not one.** A store that holds one status for the
> batch has already decided it will lose the difference between *"I approved all eight"*, *"I
> approved six and rejected two"*, and *"I approved one and never looked at the rest"*.
> *Warrant: measured here at 184 sub-decisions under 47 statuses, 0 recoverable; and in the sibling
> cohort every surface that got this right stores N rows — **9 of 9**, with no exception.*
>
> **P2 — physics.** **"Un-reviewed" is a verdict and needs its own state.** Absence cannot carry it:
> an item missing from the accepted set may have been rejected, may have been skipped, may never
> have been rendered. A two-valued verdict silently annexes the third case to whichever side the
> code happens to default to.
> *Warrant: the one door in this repo that gets it right spells the third state — `verdict = "skip"`
> means "leave this idea exactly as it is" — and the one derivation that gets it right spells
> `unrated` as a first-class value beside `agree` and `disagree`. Independently: 5 of 9 sibling
> surfaces keep the distinction and the clearest failure (a refactor wizard) collapses
> unselected ≡ rejected ≡ never-persisted into one absence.*
>
> **P3 — physics, and the sharpest.** **A per-item verdict flattened into prose is destroyed, not
> stored.** Once `{id, verdict, reason}` becomes a line of text, the identity is gone, the un-decided
> items are gone (they simply do not appear), nothing can group or count by cause, and nothing can
> translate it. It reads to a human like a record and to every machine like nothing.
> *Warrant: executed here — 47 batches, 184 items, prose was the only channel and it carried
> **zero**; against `dev_ideas`, the same concept stored per row, where 96% of rejections carry a
> machine-readable reason.*
>
> **P4 — physics.** **The batch verdict must be a fact the reviewer stated, never one the code
> derives.** `any accepted → approved` and `any rejected → cannot approve` are both defensible
> collapse rules and they are opposite; a codebase that has more than one surface over the same data
> will grow both.
> *Warrant: three surfaces over one payload here, with three different collapse rules — one asks,
> one ORs, one forbids the mixed case by disabling the button.*
>
> **P5 — ergonomics with teeth.** **A partial verdict is work; treat it as work.** The reviewer's
> half-finished judgement over N items is more expensive than the click that commits it, and it
> lives — by default — in component state that a navigation destroys.
> *Warrant: the strongest silence in the sweep. **0 of 9** sibling surfaces persist a partial
> selection; the single mitigation anywhere in six codebases is an unmount handler that **flushes**
> a pending batch instead of cancelling it, and its author wrote down that without it "the
> operator's audit decisions are dropped with no signal".*
>
> **P6 — physics.** **A staging buffer with an expiry needs a way to be spent, or the expiry is the
> outcome.** If the verdicts are parked server-side under a consent window, something must bring the
> reviewer back before it closes.
> *Warrant: executed — 8 batches, 50 verdicts, 100% expiry, no sweep, no badge, no second surface.*
>
> **P7 — physics as a defect.** **Producing a per-item verdict shape and consuming it are independent
> decisions.** A door that accepts `Array<{id, verdict, reason}>` is worth nothing while its one
> caller fills `reason` with the justification for the verdict it just replaced.
> *Warrant: measured here, and it is this repo's most interesting single line — the compliant door is
> correct and its only caller is not.*
>
> **P8 — ergonomics.** **A pre-filter is a verdict nobody was asked for.** Dropping candidates below
> a threshold before the human sees them is a per-item rejection with no verdict UI, no reason and no
> disclosure — and it is invisible precisely because it looks like an empty list.
> *Warrant: 49% of this repo's personas are silently absent from one picker; two of five sibling
> repos pre-filter, and both mitigate by **returning the dropped set to the caller** rather than by
> not filtering.*
>
> **Scale condition.** P1, P2 and P3 are wrong on day one, at N = 2. P4 bites the second time
> somebody builds a surface over the same rows. P5 and P6 bite the first time a reviewer is
> interrupted — which, measured, is every time.

---

## 1. Trigger

- "The model came back with eight suggestions — let the user pick which ones to apply."
- "Add an Accept all / Reject all to this list." / "Add a checkbox per row and an Apply button."
- "Show the proposal and let them approve it." *(then the proposal turns out to have entries)*
- "I approved three of them and it applied all five." / "I rejected two and now it won't let me approve."
- "Where do we record *why* they said no to that one?"
- "I got halfway through the list and closed the tab."

**If you are about to write** `useState<Record<string, …>>` keyed by an item id over a rendered
collection; a JSON column named `*_json` / `payload` / `context_data` holding an **array of
sub-items** under a single `status`; a command whose only parameter is a **batch id**
(`apply_x(proposal_id)`, `resolve(review_id, status)`); an `Accept all` button; or a string built
by joining a verdict map — **you are in this situation.**

You are **not** in it for a selection that merely *scopes* an action with one meaning (export these
five, delete these five) — that is [`bulk-command-variant`](./bulk-command-variant.md) on the server
and `bulk-selection-actions` on the client. The discriminator is whether the items can receive
**different** verdicts.

### Boundaries with the adjacent leaves

- [**`human-review-queue`**](./human-review-queue.md) owns the queue, the CAS, `rowWrites`, the
  keyboard walk, the resume seam and the failure direction — **for one row**. Its `seenStatus`
  contract is about *this row's* status; this path is about the row's *contents*. Its §Gaps 3
  ("no bulk door, and the bulk API cannot carry an expectation") is the same wall from the other
  side. **Its `resolveReviewRow` is the door all three violating surfaces here call, and it is
  correct for what it does** — the defect is that a batch review has no other door.
- [**`bulk-command-variant`**](./bulk-command-variant.md) owns **one verdict over N rows** and its
  §2(a) mandates `Vec<Outcome>`. This path is **N verdicts over one row** and mandates
  `Vec<Input>`. They are the same insight applied to opposite ends of the call, and the repo has
  built the outcome half six times and the input half once — see §12.4.
- [**`aggregate-count-display`**](./aggregate-count-display.md) owns *"what does this number
  count"*. It owns `MessageDetailModal.tsx:906`'s `{decisions.length} decisions` badge and
  `ReviewDetailPanel.tsx:239`'s `{decisions.length - accepted - rejected} undecided` — which is the
  only place in the app that renders the un-reviewed count, and it is render-only.
- [**`optimistic-update`**](./optimistic-update.md) owns the rollback of a write in flight. This
  path owns the state that is **not yet a write at all** — a staging buffer has nothing to roll back
  and no server truth to reconcile against, which is exactly why it evaporates unnoticed.
- [**`informed-consent-gate`**](./informed-consent-gate.md) owns the consent-freshness window that
  expired all eight triage batches. That the window is right is not in dispute here; that nothing
  brings the reviewer back before it closes is §7 D5.
- [**`partial-update-semantics`**](./partial-update-semantics.md) owns which *fields* of one entity
  a patch touches. This owns which *members* of a set a verdict touches.

## 2. The one way

**Decide what item 5 of 8 will look like in the database before you render a single control, and
make the commit carry one entry per item — id, verdict, reason — or do not offer per-item controls
at all.** Concretely: (a) **store the sub-items as rows, not as a JSON array under one status**; the
moment a human can give them different verdicts they are entities, and every property this leaf
needs (a per-item status, a per-item reason, a per-item decided-at, an index) is a column on a row
and is unreachable inside a `TEXT` blob. (b) **Give the verdict three values, not two** —
`accept | reject | skip`, where `skip` means *leave it exactly as it is* — so an un-reviewed item is
a state and not an absence; and let the default be `skip`, never `reject`. (c) **Make the commit take
`Array<{ id, verdict, reason? }>`**, not a batch id and not a status: `apply(batchId, overrides)` is
the shape, and the count of entries the caller sends is the count of items it is claiming to have
judged. (d) **Record why on a reject, per item, with a machine token** — a preset id the reviewer
picks (`too_complex`, `already_exists`, `wrong_scope`, `not_valuable`, `not_now`) plus optional
prose; the token is what a future scan reads to avoid re-proposing the same thing, and free text is
not. (e) **Never derive the batch verdict** — if a batch must also carry one status, compute it from
the per-item rows and store it as a cache, or ask the reviewer explicitly; do not write
`anyAccepted ? approve : reject` and do not disable Approve because something is rejected. (f)
**Write the items first and flip the batch status last**, and put both in one transaction if the
store allows it; a status flipped before the loop is a row asserting an outcome the loop has not
produced yet. (g) **Report per item what happened** — `{ accepted, rejected, skipped, overridden,
failed: [{id, reason}] }` — and render the `failed` list, because a per-item outcome nobody displays
is the same as none. (h) **Persist the partial verdict, or say out loud that you are not going to**;
a staging map in component state is a decision to discard the reviewer's work on navigation, and it
should be a decision rather than a default. (i) **If you pre-filter the candidates, disclose the
count you dropped and why**, next to the list — a threshold applied before the human is a rejection
they never got to make. Then stop: do not add a second free-text field to carry the verdicts, do not
build a fifth collapse rule, and do not offer per-item controls over a door that cannot accept them.

If you must get one right first: **(a)**. (c)–(g) are all mechanical once the items are rows, and
all impossible while they are not — every deviation in §7 is downstream of a JSON array in a `TEXT`
column.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/src/commands/companion/backlog_triage.rs:73-83` — `TriageOverride { idea_id, verdict: "accept"\|"reject"\|"skip", reason: Option<String> }` | **the wire shape to copy.** One entry per item, and the **third verdict is spelled**: *"`verdict = \"skip\"` means 'leave this idea exactly as it is'"*. It is the only type in the repo where un-reviewed is representable. |
| `.../backlog_triage.rs:217-296` — `dev_tools_apply_triage_verdicts(approval_id, overrides: Vec<TriageOverride>)` | **the door to copy.** Merges the human's overrides over the model's verdicts item by item, counts `overridden`, writes the ideas **first** and flips the approval status **last** (`:290-292`, with the pool-split reasoning in the module header), and refuses a stale batch through `load_pending`. |
| `.../backlog_triage.rs:86-97` — `AppliedTriage { accepted, rejected, skipped, overridden, failed: Vec<SkippedIdea> }` | **four buckets and a failure list.** `skipped` and `rejected` are different numbers; `overridden` answers *"how many did the human flip"*, which no other surface in the app can ask. |
| `.../backlog_triage.rs:49-57` — `SkippedIdea { idea_id, reason }` + `:107-140`'s partition | **why an item is not in the batch, per item.** *"Surfaced per item rather than dropped, so 'I selected 12 and got 9 verdicts' is always explained."* Non-pending ids are skipped **with a reason** rather than silently re-decided. |
| `src/features/overview/sub_manual-review/components/backlog/AthenaVerdictCard.tsx:69-112` | **the client half.** A staging map (`Record<ideaId, EffectiveVerdict>`) that is *committed as a map*: `batch.items.map((i) => ({ ideaId: i.ideaId, verdict: effective(i), reason: i.reason }))`. `effective()` (`:91-95`) layers the human's override over the model's default without mutating it, so "unchanged" and "confirmed" stay distinguishable. Copy this component — **but not line 111 verbatim; see §7 D4.** |
| `src/features/teams/sub_factory/l2/ship/shipDuality.ts:64-79` — `itemVerdict()` / `deriveDuality()` | **`unrated` as a first-class verdict.** The fold emits one `{id, name, verdict}` per member and counts `rated / unrated / agree / disagree` **from the list**, so the roll-up cannot contradict the items. The cleanest statement of P2 in the repo. |
| `db/src/repos/dev_tools.rs:4456-4498` — `decide_idea_cas(id, expected, verdict, reason)` and `dev_ideas.rejection_reason` | **the storage shape that works, proven at scale.** N rows, a per-row status, a per-row reason. Live: 23 of 24 rejections carry one. Two statements rather than a `COALESCE` so a reason-less reject genuinely writes `NULL` — absence of a reason is itself recorded. |
| `src/lib/decisions/rowWrites.ts` (`resolveReviewRow`, `isDecisionConflict`) | **the one verdict door for the batch row itself.** Correct for what it does; per [`human-review-queue`](./human-review-queue.md) every batch-level status flip still goes through it. It is not a substitute for a per-item door. |
| `src/features/overview/sub_manual-review/components/FocusedDecisionCard.tsx:1-100` | **the per-item render unit**, shared by `ReviewFocusFlow` and `MessageDetailModal`. `VerdictButtons` (`:89`) is the accept/reject pair; do not hand-roll a fourth. |

**Do NOT build:** a fifth collapse rule; a second free-text channel for verdicts (`reviewer_notes`
already has two writers doing it); a `Record<itemId, verdict>` whose commit takes no argument; an
apply door parameterised only by a batch id; a two-valued verdict over a list the reviewer can leave
half-done; a `Reject all` that is the only way to express "I rejected most of these"; a pre-filter
with no disclosure.

## 4. Steps

1. **Count the items before you choose the storage.** If the model can emit more than one, they are
   rows. `persona_memory_review_proposal` holds 1, 2, 10 and 11 entries in four rows of one column;
   `persona_manual_reviews.context_data` holds 1 to 8. Neither can answer *"which ones"*.
2. **Write the verdict enum with three values and make `skip` the default.** `accept | reject |
   skip`. The default matters more than the enum: a map initialised to `{}` and read with `?? 'reject'`
   turns silence into a rejection, and a map read with `?? 'accept'` turns it into an approval.
3. **Design the commit signature next, before any component.** `apply(batchId, Array<{id, verdict,
   reason?}>)`. If you find yourself writing `onApprove: () => void`, ask what the eight verdicts
   already on screen are going to do.
4. **Ask whether the type can make the wrong call impossible — before you write the gate.** Here it
   can, in one edit; see below.
5. **Render the per-item control from the item, not from an index**, and keep the map keyed by the
   item's id. An index cursor over a list that can refresh signs the wrong item — three codebases
   wrote that warning independently ([`human-review-queue`](./human-review-queue.md) §Convergence).
6. **Show the three counts, including the un-reviewed one.** `3 accepted · 2 rejected · 3 undecided`.
   `ReviewDetailPanel.tsx:239` already does this and is the only place in the app that does.
7. **Decide, explicitly, what happens to a partial verdict on navigation** — persist it (a draft row,
   a keyed `localStorage` entry with a TTL, the server-side staging row you already have) or state in
   a comment that it is deliberately discarded. Do not leave it implicit; measured across six
   codebases, implicit means discarded.
8. **Commit the items, then the batch.** Per-item writes first, batch status last, and if the store
   supports it, one transaction. Return the four counts and the `failed` list.
9. **Render the `failed` list.** Not its length — its members, grouped by reason token.
10. **If the batch is staged server-side under an expiry, give it a way back**: register it in the
    pending-count rollup, badge it, and sweep it. Otherwise the expiry is the outcome, at 100%.
11. **And then stop.** Do not add a batch-level status the per-item rows cannot derive; do not build a
    second surface over the same items with a different collapse rule; do not put the verdicts in a
    notes field "for now".

### Can the type make the wrong call impossible? — asked before §9

**Yes, on the client, in one edit — and it deletes three of the four deviations rather than counting
them.** The bad state is not "the reviewer's verdicts were lost"; it is **"a component that renders
per-item controls can call a commit that has nowhere to put them"**. That is a type problem, and
`MessageDetailModal.tsx:858-859` (`onApprove: () => void`) is the proof.

Make the review a discriminated union at the point it is parsed, and give only one arm a
single-status door:

```ts
// reviewFocusHelpers.tsx — parseDecisions already computes the discriminant.
export type ReviewShape =
  | { kind: 'single'; review: ManualReviewItem }
  | { kind: 'batch';  review: ManualReviewItem; decisions: DecisionItem[] };

export type ItemVerdict = 'accept' | 'reject' | 'skip';        // three, not two
export interface ItemDecision { id: string; verdict: ItemVerdict; reason?: string }

// rowWrites.ts — two doors, and the batch one cannot be called without the items.
export function resolveReviewRow(r: SingleReview, status: ManualReviewStatus, notes?: string): Promise<void>;
export function resolveReviewBatch(r: BatchReview, items: readonly ItemDecision[], notes?: string): Promise<void>;
```

The consequences are the point. `MessageDetailModal`'s `onApprove: () => void` **stops compiling** —
it holds `childVerdicts` and must now pass them. `ReviewFocusFlow`'s `anyAccepted ? onApprove :
onReject` stops compiling — there is no status to derive, only items to send. `ReviewDetailPanel`'s
`buildVerdictNotes` has nothing left to do, because the verdicts have a typed channel. And a future
surface **cannot** render `FocusedDecisionCard` over a batch and then commit a bare status, because
the only door that takes a bare status will not accept a `BatchReview`.

Held against the seven qualifications:

- **Q1 (a type carries only what it encodes)** — holds, and this is where the leaf is honest: the
  union encodes *that the review has sub-items and that the commit must name them*. It does **not**
  encode that the backend will store them per item, and today it will not (§7 D2). That is why §2
  leads with (a) and not with (c): the type closes the client hole and leaves the storage hole open.
- **Q2 (requiredness ≠ closedness)** — the edit is *closedness on the door set*, not requiredness on
  a field. Making `notes` required would change nothing; it can already hold anything, which is
  precisely how it came to hold the verdicts.
- **Q3 (a type nobody constructs constrains nothing)** — **survives, and this is why it is "route the
  second caller", not "invent a type".** `TriageOverride`/`ItemDecision`'s shape is already
  constructed once, in production, at `AthenaVerdictCard.tsx:111`, and consumed by a Rust command
  that has run. This is not a `LaneOutcome<T>` with zero call sites; it is a proven shape with one
  caller and three surfaces that should be its second, third and fourth.
- **Q4 (a type anyone can construct authenticates nothing)** — relevant and live: `ItemDecision` is
  constructible with any `reason`, and D4 is exactly that failure — the caller fills it with the
  justification for the verdict it replaced. The type guarantees the *channel*, never the content.
- **Q5/Q6 (withhold the dangerous freedom, not the answer)** — the dangerous freedom is *answering
  for eight items with one status*. Withhold the single-status door **from batch reviews only**;
  withholding it everywhere would break 8 legitimate single-review call sites, and withholding the
  batch concept would break the feature.
- **Q7 (withholding a requirement helps only where the requirement forced the bad value)** — the
  callers here supply the bad value **voluntarily**: nothing required `MessageDetailModal` to pass
  no verdicts, it simply had no reason to. So the fix is withholding the *permissive door*, not
  widening a type. Q7 is the qualification that says this edit is the right kind.

**And one destination needs fixing before the gate points at it** (contract, fifth §9 failure mode).
Routing callers to `Array<{id, verdict, reason}>` is worth little while the one existing caller
fills `reason` with Athena's rationale for the opposite verdict (§7 D4) and the card has no reason
input at all. **Add a reason control — a preset token list, the shape `triageAdapters.ts:505-583`
already defines — before ratcheting anyone toward the door**, or the gate will route people to a
type that carries the wrong string.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A reviewable batch stored as a JSON array under one `status` column** | Every per-item property becomes unreachable. `persona_manual_reviews.context_data` (47 rows / 184 items) and `persona_memory_review_proposal.proposal_json` (4 rows / 24 items). Compare `dev_ideas`: same concept, N rows, 96% reason coverage. §7 D2. |
| **`apply(batch_id)` as the only apply door** | The reviewer's choice is all or nothing. Executed: 11 of 11 or 0 of 11, and the 11 archive 52 memories. **Zero sibling repos have an all-or-nothing batch apply** — this shape is unique to this repo in a six-codebase cohort. §7 D1. |
| **A two-valued verdict over a list the reviewer can leave half-done** | Un-reviewed becomes an absence and the absence gets annexed. `decisionStates[d.id] ?? null` filtered out at serialisation means an item nobody looked at leaves no trace at all. P2. §7 D3. |
| **Flattening the verdict map into a free-text field** | Identity gone, un-decided items gone, not groupable, not countable, not translatable. Two files, three sites, `"Decisions:\n+ label\n- label"`. Live yield: **0 of 184.** §7 D3. |
| **Deriving the batch verdict from the item verdicts** | `anyAccepted ? approved : rejected` (`ReviewFocusFlow.tsx:181-185`) approves a batch on one accept out of eight — and the learned memory then teaches the model that the human approved it. §7 D3. |
| **Forbidding the mixed case in the UI instead of supporting it** | `disabled={hasChildren && anyRejected}` with the title *"Clear rejections before approving the whole review"* (`MessageDetailModal.tsx:949-951`). The reviewer who rejects 2 of 8 **cannot approve the other 6** — the storage constraint surfaced as a disabled button, in hardcoded English. §7 D3. |
| **A staging map with no commit parameter** | `onApprove: () => void` beside `useState<Record<string, DecisionVerdict>>`. The work is done, rendered, counted — and then not passed. §7 D3. |
| **Flipping the batch status before the loop** | Executed: crash at entry 5 of 11 → `status='applied'`, 33 memories archived, 6 entries never run, nothing records which, and the CAS refuses the retry. The CAS is right; its *position* is the defect. §7 D1. |
| **Per-item errors as `Vec<String>` of `format!("memory `{id}`: {e}")`** | The same defect [`bulk-command-variant`](./bulk-command-variant.md) §7 D6 names, on the input side of the same feature: not groupable, not translatable — and here with **no consumer at all**. §7 D1. |
| **Staging verdicts server-side under an expiry with no way back** | 8 batches, 50 verdicts, 100% expired, 6 days old, not in `pending_counts`, no badge, no sweep. §7 D5. |
| **A per-item reason field filled from the item's original rationale** | Flip accept→reject and you persist the argument *for accepting* as the rejection reason. The backend shape is correct and the caller poisons it. §7 D4. |
| **Silently pre-filtering the candidate list** | A per-item rejection with no verdict UI, no reason, no disclosure. `useStudioComposer.ts:74` drops **38 of 78 personas (49%)** from a picker, and both consumers then filter by a search box so the exclusion reads as "no match". §7 D6. |
| **`serde_json::from_str(...).unwrap_or_default()` on the batch's entries** | A proposal whose JSON stops parsing renders as **zero items** while its stored `proposed_changes` integer still says 11 — an empty list beside a count that contradicts it. `memory_review_proposal.rs:225`. §7 D7. |
| **`JSON.parse(context_data)` inside a `silentCatch`** | 134 of 194 live reviews have non-JSON `context_data`, so the per-item parse throws on every render and is swallowed. Harmless today, and it is also the reason nobody noticed the payload shape changed. §7 D7. |

## 6. Evidence

**The one site to copy: `src-tauri/src/commands/companion/backlog_triage.rs:73-296` — the triage
override door.**

```rust
/// One per-item human override applied on top of Athena's verdict.
/// `verdict = "skip"` means "leave this idea exactly as it is".
pub struct TriageOverride { pub idea_id: String, pub verdict: String, pub reason: Option<String> }

pub struct AppliedTriage {
    pub accepted: u32, pub rejected: u32, pub skipped: u32,
    /// How many items the human flipped away from Athena's verdict.
    pub overridden: u32,
    /// Ids that could not be written (already deleted, etc.) — reported, never swallowed.
    pub failed: Vec<SkippedIdea>,
}

pub async fn dev_tools_apply_triage_verdicts(state, approval_id: String, overrides: Vec<TriageOverride>)
    -> Result<AppliedTriage, AppError>
{
    let (action, params) = approvals::load_pending(&state, &approval_id)?;   // :229 freshness + CAS to `running`
    let verdicts = parse_items(&params)?;                                     // the model's proposal
    let override_by_id: HashMap<&str, &TriageOverride> = …;                   // :236

    for item in &verdicts {                                                   // :250  IDEA WRITES FIRST
        let (verdict, reason) = match override_by_id.get(item.idea_id.as_str()) {
            Some(o) => { if o.verdict != item.verdict { applied.overridden += 1; }
                         (o.verdict.clone(), o.reason.clone().or(Some(item.reason.clone()))) }
            None    => (item.verdict.clone(), Some(item.reason.clone())),     // silence = the model's verdict
        };
        match verdict.as_str() {
            "accept" => …, "reject" => IdeaVerdict::Reject { reason: … },
            _ => applied.skipped += 1,                                        // :285  "skip" leaves the idea alone
        }
    }
    note_applied(&state, &approval_id, &applied);                             // :290  APPROVAL STATUS LAST
    approvals::finalize_approval(&state, &approval_id, "approved")?;
    Ok(applied)
}
```

Seven decisions worth copying: (1) the parameter is **one entry per item**, so a subset is the only
representable answer; (2) `skip` is a **named verdict**, not an omission; (3) the human's override is
layered over the model's proposal rather than replacing it, so `overridden` is countable; (4) `reason`
travels **per item** and lands in `dev_ideas.rejection_reason`, the column with 96% live coverage;
(5) the ideas are written **before** the approval status flips — the exact inverse of §0's A3, and
the module header says why; (6) `failed` carries identity and is *"reported, never swallowed"*; (7)
the batch is refused if stale, so a verdict cannot be applied to items that have moved on.

**And the client half: `AthenaVerdictCard.tsx:69-132`.**

```ts
const [overrides, setOverrides] = useState<Record<string, EffectiveVerdict>>({});
const effective = useCallback((item: BacklogVerdict): EffectiveVerdict =>
  overrides[item.ideaId] ?? (item.verdict === 'accept' ? 'accept' : 'reject'), [overrides]);   // :91-95

const applied = await devApi.applyTriageVerdicts(
  batch.approvalId,
  batch.items.map((i) => ({ ideaId: i.ideaId, verdict: effective(i), reason: i.reason })),      // :111
);
```

`:111` is the whole prescription in one line — **the map is the payload**. Note also `:74-77` (one
LLM turn per mounted card, enforced by a ref because StrictMode's double-mount would spend it twice —
the `cost` dimension of this leaf) and `:128`, which recognises the expiry failure by pattern-matching
the error and tells the reviewer to re-run rather than retry. **The design anticipated exactly the
failure that has since happened eight times.**

**Also exemplary:**

- `db/src/repos/dev_tools.rs:4456-4498` `decide_idea_cas` — per-row status, per-row reason, existence
  checked before the swap, and two statements rather than a `COALESCE` so *"no reason given"* is
  storable. This is the storage shape §2(a) mandates, and its live reason coverage (23/24) is the
  argument.
- `src/features/teams/sub_factory/l2/ship/shipDuality.ts:64-79` — `unrated` as a first-class verdict,
  and roll-up counts derived from the item list so they cannot drift from it.
- `backlog_triage.rs:107-140` — the batch's *front door*: empty-list refusal with an actionable
  sentence, `MAX_BATCH_IDEAS = 30` refusal that prints what it got, de-duplication before the loop,
  and a per-item `skipped` with `reason: "already {status}"` so *"I selected 12 and got 9 verdicts"*
  is always explained.
- `src/features/overview/sub_patterns/PracticeRolloutModal.tsx:52-104` — the other correct shape: a
  per-item map that **mirrors durable rows** rather than staging a decision. Seeded from
  `listWorkspaceAdoption`, and every change writes through immediately
  (`setWorkspaceAdoption(practice.id, project.id, state)`). 7,099 live rows. A staging buffer and a
  mirror look identical in the type system and behave oppositely on navigation.
- `ReviewDetailPanel.tsx:235-241` — the only place in the app that renders the **undecided** count
  beside accepted and rejected. The UI understands P2; the storage does not.

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** Nine surfaces found where N generated items
face a human verdict.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **The reviewable batch is stored as N rows** | **PHYSICS (9 of 9, no exception)** | brainiac `promotions` (one row per item, `reviewer_id`/`reviewed_at` NULL = unreviewed) and `standards.lifecycle`; personas-web per-event `manual_review` rows; vibeman `ideas(status, user_feedback)`; ascent `recommendations(status)`. **Not one sibling stores a reviewable batch as a JSON array under a single status.** Personas does it twice, plus a third time in `companion_approval.payload` — where it is correct, because that row is a *staging* record and the items it names are `dev_ideas` rows. |
| 2 | **⚠ THE SHARPEST — an all-or-nothing "apply the whole batch id" endpoint** | **PERSONAS IS ALONE, and it is a negative result** | Three sibling endpoints take a subset by signature — `BulkReviewRequest { action, ids: Vec<Uuid> }` (brainiac `console.rs:320`), `{ repos: string[], practiceId }` (ascent `apply-batch/route.ts:52`), `{ opportunities }` (vibeman) — and a fourth fans out client-side over per-id PATCHes (personas-web). **Zero all-or-nothing batch-apply endpoints were found in five repos.** `apply_persona_memory_review_proposal(proposal_id)` has no counterpart anywhere in the cohort. |
| 3 | **Un-reviewed is distinguishable from rejected** | **MIXED (5 of 9) — and the failures are instructive** | Kept: brainiac (`reviewed_at IS NULL`; and `rejected` is a *retained* lifecycle state, not a delete), personas-web (`pending`, with failed ids explicitly reverted to it), vibeman (`pending` vs `rejected`, **plus a sentinel that distinguishes a stale auto-archive from a real rejection**), ascent (`open` vs `dismissed`). Lost: vibeman's refactor wizard, where unselected ≡ rejected ≡ never persisted. |
| 4 | **A per-item reject reason** | **MINORITY (1 of 9 fully) — and the gap is always the bulk path** | vibeman is the only complete one: a five-option preset picker with number-key shortcuts → `user_feedback`. personas-web collects `reviewerNotes` on the single-item panel and **the bulk path silently drops it** (`resolveReview(ids[i], status)` — no notes). ascent has the `note` column, the API parameter and a history renderer, and **no UI control that writes it**. brainiac records *who* and *when* but never *why*. |
| 5 | **⚠ A partial verdict survives the reviewer leaving** | **SILENCE — 0 of 9, in six codebases** | Every selection is component or zustand state with no `persist`, no storage key, no draft row. The single mitigation anywhere is personas-web's unmount **flush**: *"if the operator navigates away while an undo window is open, commit the optimistic batch before clearing the timer… without this flush, clearTimeout silently abandons the 5-second-pending PATCHes and the rows revert on the next poll — the operator's audit decisions are dropped with no signal."* Nobody has solved P5; one person noticed it. |
| 6 | **Mid-apply failure leaves the batch honest** | **PHYSICS (4 of 4 that could fail) — and Personas is the outlier** | brainiac runs **each id in its own transaction**, so there is no batch status to flip; personas-web reverts `failedIds` to `pending` and re-selects them; ascent's per-repo worker owns its errors (*"One bad repo never aborts the rest"*); vibeman's accept is DB-first CAS with a 3-attempt rollback. **Not one sibling flips a batch-level status before the loop.** |
| 7 | **An item cap, and what it means** | **MIXED (3 caps / 9)** | brainiac `BULK_MAX = 200`, equal to the console page, argued as *"Not a performance number — a governance one… the largest batch a reviewer can honestly claim to have read"*; ascent `MAX_BATCH = 25`, duplicated client-side with a comment tying the two, and **ordered neediest-first so the cap does not silently drop the repos the rollout should fix**. Personas caps one door (`MAX_BATCH_IDEAS = 30`) and the two JSON-array batches are bounded only by what the model emitted. |
| 8 | **A generated candidate is silently dropped before the human sees it** | **PRESENT (2 of 5) — and both mitigate; Personas does not** | vibeman drops near-duplicates before insert **and returns `skippedDuplicates` to the caller**, deliberately not seeding the dedup set with stale auto-archived rejections; brainiac's `auto_approved` bypasses the queue **but still writes a row**, and RLS-hidden claims render as *"restricted — claim not visible to you"* rather than vanishing. `useStudioComposer.ts:74` returns nothing and renders nothing. |

**Physics — keep as doctrine:** clauses 1, 2 (as a negative), 3, 6.
**Reported as silence:** clause 5 — *nobody in six codebases persists a partial verdict*, so P5 is a
frontier rather than a lag, and any prescription here is a proposal, not an adoption.
**Personas is behind** on clauses 1, 2 and 6, which is unusual for this corpus and is the reason this
leaf is `risk: HIGH` at `recurrence: 10`.

> **The sentence the cohort wrote that this leaf should be judged against**, from
> `brainiac/console/app/console/modules/reviews/review-surface.ts:55-59`:
> *"Returns a per-ROW outcome rather than a single ok/failed, because a mixed batch is the normal
> case… **Answering 'some of them' with 'no' is what a single boolean would do.**"*
> Its migration comment (`0029_library_mining.sql:3-8`) states P2 from the other end: *"REJECTION IS
> KNOWLEDGE. The mining sweep must dedup against candidates a maintainer already said no to, or it
> re-proposes the same rejected idea on every run and turns triage into a treadmill."*

## 7. Deviations

Every entry is live on `master` @ `2a874e692` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database. **Per the campaign's no-destructive-applies rule
these are notes for later, not asks** — the operator uses this app daily and every fix below either
changes a schema, changes what a live verdict surface does, or deletes rows.

### D1 — `apply_persona_memory_review_proposal` is all-or-nothing, flips the status first, and has no UI

`commands/core/memories.rs:874-1042` → `db/src/repos/core/memory_review_proposal.rs:198-221`.
Executed in §0 (A1–A4). Four defects in one door:

1. **No subset parameter.** The signature is `(state, proposal_id: String)`. The reviewer's only
   alternatives are `apply` (all) and `discard` (none). No sibling repo in the cohort has this shape.
2. **The status flips before the loop** (`:901`), and the loop is N un-transacted repository calls on
   a pooled connection. A crash at entry 5 of 11 leaves 33 memories archived, 4 insights created,
   `status='applied'`, `decided_at` set — and the CAS then refuses the retry. The file names this
   gap itself (`:1031-1033`).
3. **`errors: Vec<String>`** built as `format!("memory \`{}\` delete: {}", …)` — per-item outcomes
   only a human can read, which is [`bulk-command-variant`](./bulk-command-variant.md) §7 D6 arriving
   on the input side of the same feature. And they have **no consumer**.
4. **Zero UI.** `applyPersonaMemoryReviewProposal`, `discardPersonaMemoryReviewProposal`,
   `listPersonaMemoryReviewProposals` and `getPersonaMemoryReviewProposal` are referenced in exactly
   **three** files across 4,829: `src/api/overview/memories.ts` and two generated bindings. Nothing
   in `src/features`, `src/stores`, `src/hooks` or `src/components` calls them. The reflection command
   returns a `proposalId` (`memories.rs:792`) that nothing reads. **Live: 4 proposals, 24 sub-items,
   `pending_review`, `decided_at` NULL, created 2026-05-10 and 2026-07-10 — 98 and 37 days ago.**

The blast radius is the reason this is D1 and not D8: the largest proposal's 11 entries archive **52
memories** in one click, and the reviewer has no way to say "these three".

**Fix (note):** `apply(proposal_id, verdicts: Vec<EntryVerdict>)` with `skip` as the default for an
un-named entry; write the entries first and `mark_applied` last, with a per-entry outcome row; then
build the surface. *(Not an apply — the first run of anything here archives or deletes rows.)*

### D2 — the reviewable batch is a JSON array in a `TEXT` column, so no per-item column exists

`persona_manual_reviews.context_data` and `persona_memory_review_proposal.proposal_json`. Live: **47
reviews carrying 184 sub-decisions** and **4 proposals carrying 24 entries**. Neither table has a
per-item status, reason, decided-at, or decider. This is upstream of D3, D4 and D7 — every one of
them is a workaround for a column that does not exist. Doctrine's *"where types cannot reach"* has a
fourth member: **inside a JSON blob column**, where no Rust type, no ts-rs binding and no CAS
predicate reaches, and where `serde_json::from_str(...).unwrap_or_default()` (`memory_review_proposal.rs:225`)
turns a schema change into an empty list.

The same install proves the alternative works: `dev_ideas` is the identical concept as N rows, and
**23 of its 24 rejections carry a `rejection_reason` (96%)** against **0 of 208** for the array shape.

**Fix (note):** `persona_manual_review_decisions(review_id, decision_id, verdict, reason, decided_at)`
and the equivalent for proposal entries; keep the JSON as the *proposal* and make the rows the
*verdicts*. This is a schema migration on the app's most-used verdict table and must not be applied
while the operator is running it.

### D3 — three surfaces over one payload, three collapse rules, and the map reaches storage in none of them

| path | defect |
|---|---|
| `ReviewDetailPanel.tsx:96,:315-341` | The per-item map is flattened to `"Decisions:\n+ {label}\n- {label}"` and appended to `reviewer_notes`. **`d.id` is discarded** — only the label survives. `.filter((d) => decisionStates[d.id])` **drops undecided items entirely**, so "I rejected 3 and never looked at 2" and "there were only 3" write the same string. The block is duplicated verbatim in both button handlers (`:319-323`, `:332-336`). Pressing **Reject** still writes the `+` lines for the accepted items — the prose contradicts the row status it is stored beside. |
| `ReviewFocusFlow.tsx:80,:141-156,:174-186` | Same flatten (`buildVerdictNotes`), plus the sharper defect: `decideAndAdvance` **derives** the batch verdict — `const anyAccepted = decisions.some(… === 'accept'); if (anyAccepted) onApprove(…) else onReject(…)`. **One accept out of eight approves the batch**, and `manual_reviews.rs:337-357` then writes a team `decision` memory at importance 7 saying the human approved it. |
| `MessageDetailModal.tsx:876,:858-859,:948-951` | The worst: `onApprove: () => void` / `onReject: () => void`. `handleResolveReview` (`:311-322`) calls `resolveReviewRow(review, status)` with **no notes**, so `childVerdicts` is **discarded entirely** — not even prose. And `disabled={resolving \|\| (hasChildren && anyRejected)}` with `title="Clear rejections before approving the whole review"` means a reviewer who rejects 2 of 8 **cannot approve the other 6**. The title, `aria-label`s and `{decisions.length} decisions` (`:906`) are hardcoded English in a 14-locale app; so are `ReviewDetailPanel.tsx:215-226`'s `title="Accept"` / `aria-label="Accept"` and `:286`'s `Review {status} on …`. |

Live yield of all three, across 47 batches and 184 items: **zero.** 35 batches were auto-triaged
(one LLM verdict for the batch — `auto_triage.rs:158-166` does pass the whole `context_data`,
truncated at 4,000 chars, so the evaluator *sees* the items and has no shape to answer per item), 9
went through `dispatch_review_action`'s suggested-action door, and 3 were resolved with empty notes.

**Fix (note):** the discriminated-union door in §4. It is compile-time, it is mechanical, and it
makes all three stop compiling until they carry the items — but it changes what three live verdict
surfaces do, so it is a note.

### D4 — the compliant door's only caller fills `reason` with the rationale for the verdict it replaced

`AthenaVerdictCard.tsx:111` sends `reason: i.reason` — **Athena's** justification, taken from the
proposal item — for every entry, including the ones the human just flipped. The backend
(`backlog_triage.rs:255-259`) honours it: `o.reason.clone().or_else(|| Some(item.reason.clone()))`.
So a reviewer who overrides `accept → reject` persists *the argument for accepting* into
`dev_ideas.rejection_reason`, which is the column a future scan reads to avoid re-proposing the idea.
The card has **no reason input at all**, and `TriageOverride.reason` is `Option<String>` so sending
`None` would have been both spellable and honest.

This is the contract's fifth §9 failure mode inverted: the destination is correct and the caller
poisons it. It is also Q4 exactly — a type anyone can construct authenticates nothing.

**Fix (note):** send `reason: overrides[i.ideaId] ? undefined : i.reason`, and add a preset picker
using the `{ id, value, copy }` shape at `triageAdapters.ts:505-583`. The one-line half is a
behaviour change on a live door; both are notes.

### D5 — 8 staged batches, 50 verdicts, 100% expired, and nothing was ever going to bring them back

Executed in §0. The consent-freshness window (`approvals/mod.rs:38-43`) is right and its reasoning is
written down. What is missing is everything that would let a reviewer spend a batch before it closes:
the triage approvals are **not registered in `pending_counts`** (`db/src/repos/dev_tools.rs:1338-1387`,
which knows six queues), so they never reach the title-bar decision badge; there is no sweep, so the
row sits `pending` forever with no `expired` status; and `AthenaVerdictCard` is modal and unmounted,
so the only surface that can render them is gone. **0 of 8 carry `note_applied`'s annotation, so this
door has never completed a run on this install.**

**Fix (note):** register the queue in `pending_counts`, and give `companion_approval` an `expired`
status a sweep can write so a stale batch is visibly stale rather than silently unusable.

### D6 — a picker silently excludes 49% of its candidates on a threshold that is on the wrong scale

`src/features/triggers/sub_studio/useStudioComposer.ts:74`:

```ts
const healthyPersonas = useMemo(() => personas.filter((p) => attentionFor(p) === null), [personas]);
```

`attentionFor` (`src/features/home/sub_cockpit/widgets/personaStats.ts:197-208`) returns non-null for
`setup_status === 'needs_credentials'`, `enabled === false`, or `trust_score < 0.5`. Live: **38 of 78
personas (49%) are absent from the Studio picker** — 29 + 2 + 7. Both consumers
(`StudioRails.tsx:75,:180`) then filter by a search box, so an excluded persona reads as *"no match
for your search"*. There is no count, no disclosure and no override.

**And the threshold is a unit bug.** `personas.trust_score` is stored **0–100** on this install
(values 58.5 … 100.0); `< 0.5` therefore fires only for the **7 rows at exactly 0** and can never
fire for a genuinely low non-zero score — 58.5 is the lowest real score in the table and it passes.
`personaStats.ts:204` is the **only** comparison of `trust_score` against a threshold in all 4,829
frontend files; everywhere else it is rendered. This belongs to
[`metric-definition`](./metric-definition.md) as much as here — it is that path's Q1 exactly, the
unit living in the number beside the tag — and it is flagged there rather than gated here.

**Fix (note):** show the excluded count with a reason breakdown and an "include anyway" affordance;
separately, correct the scale. Both change a live surface.

### D7 — two silent parses stand between the payload and the reviewer

- `db/src/repos/core/memory_review_proposal.rs:225` — `serde_json::from_str(&entries_json).unwrap_or_default()`.
  A proposal whose entry shape drifts renders as **zero entries** while the row's stored
  `proposed_changes` integer still reports 11. An empty list beside a count that contradicts it, and
  no error anywhere. (The count is a stored `INTEGER` computed at insert from `e.action != "keep"` —
  `:111-115` — so it cannot self-correct.)
- `ReviewDetailPanel.tsx:89-93` — `JSON.parse(contextData)` inside a `silentCatch`. **134 of 194 live
  reviews have non-JSON `context_data`**, so this throws and is swallowed on every render of the
  majority of the queue. Harmless in effect and load-bearing in consequence: it is why nobody noticed
  that only 47 of 194 reviews carry the payload the surface was built for.

**Fix (note):** return a `Result` from the entry parse and surface a "this proposal can no longer be
read" state; make the count derived rather than stored.

### D8 — no test asserts a partial verdict anywhere in the repo

`grep` over `src/**/__tests__` and the Rust crates finds no test that gives a batch a mixed verdict
and asserts the outcome. `dev_tools_apply_triage_verdicts` — the compliant door — has none, so its
`overridden` counter, its `skip` branch and its write-order have never been executed by CI; the
evidence is that **it has never executed in production either** (D5). The instrument is small: seed
three ideas, apply `[accept, reject, skip]`, assert `accepted == 1 && rejected == 1 && skipped == 1`,
assert the skipped idea's status is unchanged, and assert the approval row flipped **after** the idea
rows. That is the test that turns §0's A3 from a replay into a gate.

## 8. Gaps

1. **There is no per-item verdict table, and the JSON column is where the concern goes to die.** Two
   of the three batch stores are JSON arrays under one status; every deviation from D3 to D7 is a
   consequence. This is a genuine limitation, not laziness: no type, no CAS predicate and no census
   rule reaches inside a `TEXT` column, which is why §2's first clause is about storage and not about
   the client.
2. **`DecisionItem` has no verdict field and `DecisionRecord` has no status.** Both render units are
   verdict-free by construction (`reviewFocusHelpers.tsx:21-30`; and
   [`human-review-queue`](./human-review-queue.md) Gap 5 says the same of `DecisionRecord`), so the
   verdict must be carried *beside* the item in a parallel map — which is exactly the staging buffer
   this leaf is about. A render unit that owned its own verdict would make the map unnecessary.
3. **There is no shared per-item *input* type**, only a per-item *outcome* one. The repo has six
   bespoke `{id, reason}`-shaped **outcome** types ([`bulk-command-variant`](./bulk-command-variant.md)
   §8 Gap 1) and exactly **one** input type — `TriageOverride`, in a companion module, not shared.
   The asymmetry is the finding: six ways to say what happened, one way to say what to do.
4. **No primitive persists a partial verdict, and no sibling has one either.** `triageSession.ts:12-44`
   is the closest thing in the repo — per-reviewer working state in `localStorage` behind a 12 h TTL
   with per-collection caps and the reasoning written down — and it holds *skips and drafts for a
   queue*, not per-item verdicts inside a row. A `useStagedVerdicts(batchId, items)` returning
   `{ verdicts, setVerdict, undecided, clear }` over that same storage is ~30 lines and would serve
   all four surfaces. Convergence says **0 of 9** sibling surfaces have one, so this is a frontier
   proposal and should be labelled as such.
5. **`skip` exists in exactly one type and has no UI anywhere.** `TriageOverride.verdict` can be
   `"skip"`; `AthenaVerdictCard` never sends it — `effective()` (`:93`) defaults an un-touched item to
   Athena's verdict, which is the right default for *that* surface (the model already judged it) and
   would be exactly wrong for a surface where nobody has. No component in the app renders a
   three-state verdict control.
6. **The un-reviewed count is rendered once and stored never.** `ReviewDetailPanel.tsx:239` computes
   `decisions.length - accepted - rejected` for display. Nothing persists it, nothing counts it across
   batches, and no rollup can answer *"how many items has a human actually looked at"* — which is the
   number that would have revealed all of §0 on day one.
7. **`tokenMaps.ts` has no category for a verdict reason.** Its ten categories are execution, event,
   automation, severity, priority, healing_status, healing_category, connector_status, test, dev.
   §2(d) mandates a machine token for *why*; there is no shared door for that vocabulary, which is
   the same gap [`bulk-command-variant`](./bulk-command-variant.md) §8 Gap 6 found for bulk failure
   reasons. One category would serve both.
8. **Nothing links a batch row to the entities its items name.** `persona_memory_review_proposal`
   entries carry `memoryId` and `sourceIds` as strings inside JSON — no foreign key, no cascade, no
   integrity check. A memory deleted between proposal and apply surfaces as `"not found or protected
   (core-pinned)"` in a `Vec<String>` nobody reads. Live: 0 such orphans today, across 52 referenced
   ids.

## 9. The missing gate

**The condition, stated stack-free:** *a human is offered a verdict per item over a batch, and the
call that commits it has no parameter that can carry more than one verdict — so the reviewer's
partial judgement is destroyed at the boundary, silently, with a success toast.*

**The signal (a proxy, and stated as one):** a component-scoped **staging map of per-item verdicts** —
`useState<Record<string, …Verdict…>>`. This keys on the shape the condition wears **in this repo**,
where a per-item verdict UI is a React component holding a `Record` keyed by item id. **An adopting
repo must re-derive its own proxy**: a Vue `ref({})`, a form's checkbox array, a server-rendered
multi-select and a zustand slice all carry this condition and none of them match this pattern.

**The mechanism: a census rule.** The runner already exists (`scripts/census/`) and implements the
fail-loud contract, so this path writes no script.

**Where it executes:** two places, neither CI-only. `npm run census:check` is part of `npm run check`,
which the agent runs before opening a PR; and it is the **`golden-path-census` pre-push job** in
`lefthook.yml:74-75`. That matters here: `ci.yml` is currently red on 10 pre-existing failures, so
**a gate that only runs in CI runs nowhere.** This one fails the push.

**Precision 3/3 on the stated condition; every match opened and read.** All three are surfaces that
render `FocusedDecisionCard`-style per-item controls over `context_data.decisions[]` and commit
through a single-status door. On the stricter question *"is this a defect"* it is also 3/3 —
`MessageDetailModal` discards the map outright, and the other two flatten it into prose that has
yielded 0 durable verdicts in 47 live batches.

**Two independent implementations reconcile on the anchor and DISAGREED on the partition — which is
the more useful result.** Implementation #1 is the census regex. Implementation #2 is a structural
counter that blanks comments, strings, template literals and regex literals, extracts every `useState`
type argument by **angle-bracket balancing**, parses `Record<K,V>` by balancing again, and separately
finds per-item commit shapes by **brace balancing**. They agree **exactly on the anchor: 4 matches / 4
files, identical membership and identical line numbers.** They disagreed on the partition — the
census says **3 violating / 1 compliant**, #2 said **2 / 2** — because #2 credited
`MessageDetailModal.tsx:932` as a per-item commit. Hand-verification resolved it against #2: line 932
is `decisions.map((decision) => (<FocusedDecisionCard … />))`, a **JSX render loop**, not a call
argument. The census control requires `=> ({` (an object literal) which JSX's `=> (<` cannot match,
so it is the more precise of the two. *Two implementations agreeing on a count is not soundness —
these agreed on 4 and still disagreed about what the 4 were.*

**The population partitions, and the residual is named:**

| | matches | files |
| --- | ---: | ---: |
| **anchor** — a per-item verdict staging map in a component | **4** | 4 |
| ↳ **violating** — committed through a door that takes one status (or nothing) | **3** | 3 |
| ↳ **compliant** — committed as one entry per item (the positive control) | **1** | 1 |

3 + 1 = 4, exactly. The control's own pattern (a `.map(… => ({…verdict:…}))` argument) matches **2 /
2** tree-wide: `AthenaVerdictCard.tsx:111` (the commit) and `shipDuality.ts:73` (a derivation that
emits one `{id, verdict}` per item **including an explicit `unrated`**). Both were opened; both are
true positives for *"the per-item shape survives the fold"*, which is what the control asserts.

**Existing rules checked for overlap first, by re-running each neighbour's committed pattern over its
own roots and intersecting the file sets — measured, not assumed.** All six reproduced their
committed baselines exactly, which is also the instrument's own check.

| neighbour rule | its files / matches | overlap with my 3 files | why it is a different condition |
|---|---:|---:|---|
| `verdict-write-outside-door` ([`human-review-queue`](./human-review-queue.md)) | 6 / 8 | **0 (0%)** | The nearest neighbour by subject and **disjoint by construction**: it keys on a verdict wrapper imported from `@/api/**` or `updateKpi({status})`. All three of my files route correctly through `rowWrites`. It asks *did the write go through the door*; this asks *could the door carry what the reviewer decided*. |
| `inline-verdict-band` (`scoring-and-thresholds.md`) | 37 / 52 | **0 (0%)** | Name collision only — it is about score→band rendering, not human verdicts. |
| `snapshot-replace-rollback` ([`optimistic-update`](./optimistic-update.md)) | 2 / 9 | **0 (0%)** | A rollback that restores a whole collection. A staging buffer has no server truth to roll back to; that is why it evaporates instead of reverting. |
| `absent-entity-count-as-zero` ([`aggregate-count-display`](./aggregate-count-display.md)) | 30 / 40 | **0 (0%)** | It owns *what a rendered count counts*; it would own `{decisions.length} decisions` if that badge were wrong, and it is not. |
| `unregistered-key-handler` (`focus-management.md`) | 72 / 72 | **1 file (33%), 0 matches (0%)** | Shares `MessageDetailModal.tsx` only, at `:172`, an unrelated `onKeyDown`. |
| `hand-rolled-disabled-state` (`design-token-usage.md`) | 361 / 815 | **1 file (33%), 0 matches (0%)** | Shares `MessageDetailModal.tsx` at `:468,:478,:701,:950,:965`. `:950` is the *same button* as this leaf's D3 — but that rule is about the disabled **styling** and this is about the disabled **predicate**. Complementary, not overlapping. |

The largest **match-level** overlap is **0%**; the largest file-level overlap is 33% of three files.

**Disclosed recall gap — the anchor is a vocabulary, and the misses cluster exactly where the
doctrine says they will.** The pattern keys on the *type name* of the map's value, so it sees
`DecisionVerdict` and `'accepted' | 'rejected'` and misses a staging map typed as something else. It
does **not** see: a `Set<string>` of accepted ids (the shape `ImprovePopover.tsx:41`,
`KnowledgeTree.tsx:83` and `ArxivSearchModal.tsx:23` use — a two-valued verdict where absence is the
rejection, which is P2's failure mode with no vocabulary to grep); a `useReducer`; a map lifted into a
zustand slice; and — the whole other half of this leaf — **the server-side all-or-nothing apply door**
(D1), which has no client staging map at all because it has no client. True recall over surfaces
carrying this condition is roughly **4 of 8**.

**How it fails loudly if its own precondition is absent:** `floor: 4000` against a live walk of 4,829
`.ts`/`.tsx` files, so a broken glob or a moved root fails rather than reporting zero; a rule matching
zero files anywhere is a structural failure in the runner; a rise is fatal; a **drop** without
`--update` is fatal; and a stale `exclude` is fatal — which matters here because the exclude *is* the
positive control's file, so if `AthenaVerdictCard` is deleted or renamed the gate fails rather than
quietly losing its own reference implementation. **All six were verified by deliberately breaking the
rule** (results below).

**What the gate cannot do, stated so nobody trusts it further than it goes:**

- **It cannot see the storage**, which is D2 and the root of everything else. A surface could pass
  this gate by shipping `Array<{id, verdict}>` to a backend that writes one status.
- **It cannot see the all-or-nothing apply door.** D1 — the highest-blast-radius entry in this
  document, 52 memories on one click — has no client staging map and scores a structural zero here.
- **It cannot see a `Set<string>` verdict**, where the un-reviewed/rejected collapse (P2) happens by
  construction rather than by omission.
- **It cannot see whether `reason` is honest.** D4 sends the wrong string through a correct type and
  is invisible to any matcher.
- **It counts a declaration, not a behaviour.** `PracticeRolloutModal.tsx:52` holds a per-item map and
  is *correct* — it mirrors durable rows and writes through on every change. It does not match only
  because its value type is `AdoptionState`, not because the pattern understood the difference.

```json
{
  "rules": [
    {
      "id": "staged-verdict-map-collapsed",
      "goldenPath": "docs/concepts/golden-paths/selective-per-item-verdicts.md",
      "title": "A component stages a per-item verdict map over a batch whose commit cannot carry it",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "useState<\\s*Record<\\s*string\\s*,\\s*(?:[A-Za-z_$][A-Za-z0-9_$]{0,40}Verdict|'(?:accept|approve|reject)[a-z]{0,4}'|\"(?:accept|approve|reject)[a-z]{0,4}\")",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A React component holding a STAGING MAP of per-item verdicts keyed by item id - useState<Record<string, SomethingVerdict>> or useState<Record<string, 'accepted'|'rejected'|...>>. PROXY FOR the stack-free condition: a human is offered a verdict per item over a batch, and the call that commits it has no parameter that can carry more than one verdict, so the reviewer's partial judgement is destroyed at the boundary with a success toast. MEASURED 2026-08-16 at 2a874e692: 3 matches across 3 of 4829 .ts/.tsx files under src, EVERY ONE OPENED AND CONFIRMED (precision 3/3 on the stated condition, and 3/3 on the stricter 'is this a defect' question). THE POPULATION PARTITIONS EXACTLY: the raw anchor matches 4 files, and 3 violating + 1 compliant (AthenaVerdictCard.tsx, excluded below and counted by the positive control) = 4. THE THREE: (1) ReviewDetailPanel.tsx:96 Record<string,'accepted'|'rejected'|null> - the map is flattened at :319-323 and again at :332-336 into `Decisions:\\n+ {label}\\n- {label}` and appended to reviewer_notes, DISCARDING d.id and OMITTING every undecided item, so 'I rejected 3 and never looked at 2' and 'there were only 3' write the same string; pressing Reject still writes the '+' lines for accepted items, so the prose contradicts the status stored beside it. (2) ReviewFocusFlow.tsx:80 - same flatten via buildVerdictNotes (:141-156), plus decideAndAdvance (:174-186) DERIVES the batch verdict as `anyAccepted ? onApprove : onReject`, so ONE accept out of eight approves the whole batch and manual_reviews.rs:337-357 then writes a team `decision` memory at importance 7 saying the human approved it. (3) MessageDetailModal.tsx:876 - the worst: the props are `onApprove: () => void` / `onReject: () => void` (:858-859) and handleResolveReview (:311-322) calls resolveReviewRow(review, status) with NO notes, so childVerdicts is DISCARDED ENTIRELY, not even as prose; and :949 disables Approve when any child is rejected (title, hardcoded English: 'Clear rejections before approving the whole review'), so a reviewer who rejects 2 of 8 CANNOT approve the other 6. MEASURED LIVE against a read-only copy of the operator's personas.db (347 MB, copied 2026-08-16 21:20 with the app running, never opened for write, deleted after): 47 of 194 persona_manual_reviews rows carry a context_data.decisions[] array holding 184 sub-decisions in batches of 1 to 8; ZERO reviewer_notes rows in the entire table contain a 'Decisions:' block, and ZERO human-review memories do either (0 of the 10 matching persona_memories rows, 0 of the 237 matching team_memories rows; 16 rows tree-wide do match the string and all 16 are session-capture/ADR memories from unrelated writers) - so the per-item control has been rendered for 184 items and has produced no durable verdict at all (35 of the 47 batches were auto-triaged with one LLM verdict for the batch, 9 went through dispatch_review_action's suggested-action door, 3 were resolved with empty notes). THE CONTRAST IS IN THE SAME DATABASE: dev_ideas stores the identical concept as N ROWS with a per-row status and a per-row rejection_reason, and 23 of its 24 rejections carry one (96%) against 0 of 208 for the JSON-array shape. TWO INDEPENDENT IMPLEMENTATIONS AGREE EXACTLY ON THE ANCHOR (4 matches / 4 files, identical membership and line numbers) AND DISAGREED ON THE PARTITION (3/1 vs 2/2): implementation #2 is a structural counter that blanks comments, strings, template literals and regex literals then extracts each useState type argument by ANGLE-BRACKET BALANCING and each per-item commit by BRACE BALANCING; it credited MessageDetailModal.tsx:932 as a per-item commit, and hand-verification resolved it against #2 - :932 is `decisions.map((decision) => (<FocusedDecisionCard ... />))`, a JSX RENDER LOOP, so the census control (which requires `=> ({`, an object literal, and cannot match JSX's `=> (<`) is the more precise instrument. AGREEING ON A COUNT IS NOT SOUNDNESS: these agreed on 4 and still disagreed about what the 4 were. ZERO MATCH-LEVEL OVERLAP with `verdict-write-outside-door` (human-review-queue.md, 6 files / 8 matches) - re-measured by re-running its committed pattern, not assumed: it keys on a verdict wrapper imported from @/api/** or updateKpi({status}), and all three of my files route CORRECTLY through src/lib/decisions/rowWrites.ts. It asks whether the write went through the door; this asks whether the door could carry what the reviewer decided. Also 0% match overlap with `inline-verdict-band` (score bands, not human verdicts - a name collision), `snapshot-replace-rollback`, and `absent-entity-count-as-zero`; `unregistered-key-handler` and `hand-rolled-disabled-state` each share MessageDetailModal.tsx (1 of my 3 files, 33%) at unrelated lines, 0 shared matches. DISCLOSED RECALL GAP, exactly where the doctrine predicts: the anchor is a VOCABULARY keyed on the map's value TYPE NAME, so it cannot see a `Set<string>` of accepted ids (ImprovePopover.tsx:41, KnowledgeTree.tsx:83, ArxivSearchModal.tsx:23 - a two-valued verdict where absence IS the rejection, which is this leaf's P2 failure with no name to grep), a useReducer, a map lifted into a zustand slice, or the SERVER half of the leaf: apply_persona_memory_review_proposal(proposal_id) (commands/core/memories.rs:874) is all-or-nothing over a stored 11-entry batch that archives 52 memories in one click, and it has NO client staging map because it has NO CLIENT AT ALL (referenced in exactly 3 of 4829 files: src/api/overview/memories.ts and two generated bindings). True recall over surfaces carrying this condition is about 4 of 8. LEGAL DESTINATIONS the pattern leaves unmatched by construction, both of which exist in this tree: (1) the compliant commit - AthenaVerdictCard.tsx:111 `batch.items.map((i) => ({ ideaId: i.ideaId, verdict: effective(i), reason: i.reason }))` into dev_tools_apply_triage_verdicts(approval_id, overrides: Vec<TriageOverride>) where TriageOverride carries a THIRD verdict, `skip`, documented as 'leave this idea exactly as it is' (commands/companion/backlog_triage.rs:73-83); (2) a per-item map that MIRRORS DURABLE ROWS rather than staging a decision - PracticeRolloutModal.tsx:52 Record<string, AdoptionState>, seeded from listWorkspaceAdoption and written through on every change (7,099 live rows). A staging buffer and a mirror are indistinguishable in the type system and behave oppositely on navigation, and this pattern does not understand the difference - it misses the mirror only because AdoptionState is not spelled 'Verdict'. PRECONDITION (must be re-derived per repo): this repo expresses a per-item verdict UI as a React component holding a Record keyed by item id. A repo whose reviewer state is a Vue ref, a checkbox array in a form POST, or a server-rendered multi-select scores a structural zero here while carrying the condition at scale - measured in the sibling checkouts, where 9 such surfaces exist and NONE would match: brainiac ReviewWorklist.tsx:182 uses useState<ReadonlySet<string>>, ascent PracticeApply.tsx:47 a Set seeded to all candidates, vibeman's refactor wizard a zustand slice with no persist middleware. Do NOT silence a match by widening the value type to `string`, by moving the map into a store, or by deleting the per-item controls while leaving the batch payload - the honest fixes are to make the commit take Array<{id, verdict, reason}> (the golden path's section 4) or to store the sub-items as rows."
      },
      "exclude": [
        {
          "path": "src/features/overview/sub_manual-review/components/backlog/AthenaVerdictCard.tsx",
          "reason": "the compliant form and this leaf's reference implementation - its map is committed AS A MAP (batch.items.map(i => ({ ideaId, verdict, reason })) at :111) into a door whose parameter is Vec<TriageOverride>, so the per-item verdict reaches the backend; it is the positive control below, and this exemption failing is how the gate reports that its own reference implementation was deleted"
        },
        {
          "path": "**/__tests__/**",
          "reason": "test files legitimately construct a staged verdict map to assert the collapse"
        }
      ],
      "baseline": { "files": 3, "matches": 3 },
      "floor": 4000
    },
    {
      "id": "staged-verdict-map-collapsed-positive-control",
      "goldenPath": "docs/concepts/golden-paths/selective-per-item-verdicts.md",
      "title": "POSITIVE CONTROL - the commit that carries one entry per item",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\.map\\(\\([^)]{1,40}\\) => \\(\\{[^}]{0,260}\\b(?:verdict|decision|approved|accepted)\\s*:",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "POSITIVE CONTROL - the COMPLIANT form of the same condition, over the same root and extensions: a collection folded into ONE OBJECT PER ITEM CARRYING A VERDICT, so a subset is the only representable answer. Measured 2026-08-16 at 2a874e692: 2 matches in 2 files, against the violating rule's 3 in 3. THIS IS A PARTITION, NOT A RATIO: the shared anchor (a component-scoped per-item verdict staging map, any commit shape) matches 4 files, and 3 violating + 1 compliant = 4 exactly; the 1 compliant file is AthenaVerdictCard.tsx, which is excluded from the violating rule by path and counted here. THE TWO MATCHES, both opened: (1) AthenaVerdictCard.tsx:111 - `batch.items.map((i) => ({ ideaId: i.ideaId, verdict: effective(i), reason: i.reason }))`, the argument to dev_tools_apply_triage_verdicts(approval_id, overrides: Vec<TriageOverride>). This is the whole prescription in one line: THE MAP IS THE PAYLOAD. Its backend (commands/companion/backlog_triage.rs:217-296) writes the item rows FIRST and flips the batch approval status LAST, counts `overridden` (how many the human flipped away from the model's verdict), and returns AppliedTriage { accepted, rejected, skipped, overridden, failed: Vec<SkippedIdea> } - four buckets where `skipped` and `rejected` are different numbers. (2) shipDuality.ts:73 - `core.map((m) => ({ id, name, ready, rating, verdict: itemVerdict(...) }))`, a DERIVATION rather than a commit, included deliberately because it is the cleanest statement in the repo of this leaf's P2: itemVerdict returns 'unrated' as a FIRST-CLASS VALUE beside 'agree' and 'disagree' when the rating is null, and the roll-up counts are computed FROM the item list so they cannot contradict it. A MATCH HERE IS NOT A CERTIFICATE: AthenaVerdictCard sits in this control and still sends `reason: i.reason` for items the human just FLIPPED, so an accept-to-reject override persists the model's argument FOR ACCEPTING as the rejection reason - the door is correct and its only caller poisons it (see the golden path's section 7 D4). Carries NO baseline by construction: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved (scripts/census/lib/engine.mjs exempts a -positive-control id; merge-published-rules.mjs skips it; verified by deliberately adding one, which exits 1). THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if staged-verdict-map-collapsed falls while this stays flat, a per-item verdict UI was DELETED rather than given a per-item commit, and the ratchet would otherwise have recorded that as progress. NOTE the pattern requires `=> ({` - an object literal - which is what separates a commit argument from a JSX render loop: an independent structural implementation using brace-balancing counted MessageDetailModal.tsx:932 as compliant, and :932 is `decisions.map((decision) => (<FocusedDecisionCard ... />))`, JSX, whose `=> (<` this cannot match. That component in fact commits through `onApprove: () => void` and carries NOTHING."
      },
      "exclude": [],
      "floor": 4000
    }
  ]
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <a composer-private scratch
registry, filename unique to this composer because siblings share the scratchpad>`, never against the
shared `rules.json`, and **the full registry was not run** (doctrine §4). The runner reports **3
matches / 3 files** for the rule and **2 / 2** for the control over **4,829** files against a floor of
4,000, and `--check` exits **0** at the declared baseline. Exclude hit counts: 1 / 336 — no stale
exemption. **Re-extracted from this finished document and re-run, with identical counts.**

**Deliberately broken six ways, all fatal as required:**

```
baseline (3f/3m, control 2f/2m)      -> exit 0
floor 6000 > 4829 walked             -> exit 1   (matcher/root broken, not codebase clean)
pattern matches zero files           -> exit 1
stale exclude entry                  -> exit 1
baseline too LOW (a rise)            -> exit 1
baseline too HIGH (a silent drop)    -> exit 1
baseline ON the positive control     -> exit 1   (validateRule rejects a control with a baseline)
```

### The type, alongside the ratchet

The gate counts a **declaration**. Three things it cannot reach, in descending importance:

- **The storage is not a type at all** (§8 Gap 1). Whether the sub-items are rows or a JSON array
  under one status is a schema fact, and no client-side signal sees it. A surface can ship
  `Array<{id, verdict}>` into a backend that writes one status and pass this gate forever. **D2 is
  upstream of everything and is the fix that matters.**
- **The client type IS available and closes three of the four deviations** — the discriminated-union
  door in §4, which makes `onApprove: () => void` fail to compile beside a batch review. Propose the
  type as the fix; this rule is the ratchet that holds the line until it lands.
- **Fix the destination before ratcheting the callers** (contract: *a gate on reaching a destination
  is only as good as the destination's defaults*). The one compliant caller fills `reason` with the
  rationale for the verdict it replaced (D4), and there is no reason control anywhere in the app.
  Add the preset picker **first**, or the gate will route people to a type that carries the wrong
  string in 14 languages.

## 12. Corrections to the brief

1. **`sides: "client"` is wrong, and the spine already contradicts it in the same node.** The leaf
   carries `twoSided: true`. The evidence is decisive in both directions: the single
   highest-blast-radius instance (`apply_persona_memory_review_proposal`, 52 memories on one click)
   is **server-only and has no client at all**, and the single best instance
   (`dev_tools_apply_triage_verdicts` + `AthenaVerdictCard`) is a **pair** in which the server is
   correct and the client poisons it. A client-only sweep would have found neither. **Recommend
   flipping `sides` to `both`.** I swept the server doors anyway.

2. **"This leaf is the inverse of the delete-confirmation and bulk-command risks: a per-item UI over
   an all-or-nothing backend" — confirmed, and the convergence oracle showed it is worse than
   "inverse": it is unique.** Across five sibling repos and nine surfaces, **zero** all-or-nothing
   batch-apply endpoints exist; three take a subset by signature and one fans out per-id on the
   client. `apply(proposal_id)` has no counterpart in six codebases. And the corollary the brief did
   not anticipate: **9 of 9 sibling surfaces store the reviewable batch as N rows**, so the JSON-array
   storage (D2) is not a variation on a common practice — it is the thing nobody else does, and every
   other defect in this document follows from it.

3. **"The Memory Engine is proposal-gated; reflection writes proposals a human resolves" — the first
   half is true and the second half has never happened.** 4 proposals, 24 entries, all
   `pending_review`, `decided_at` NULL, 37 and 98 days old. The reason is not reviewer neglect:
   `applyPersonaMemoryReviewProposal` / `discardPersonaMemoryReviewProposal` /
   `listPersonaMemoryReviewProposals` / `getPersonaMemoryReviewProposal` are referenced in **3 of
   4,829** files — the api wrapper module and two generated bindings — and in **no** component, hook
   or store. The gate is real, the door exists, and **there is no room in the app that has it.** The
   brief asked what happened to the un-resolved remainder; the answer is that the remainder is the
   entire population.

4. **"A standing product rule in this repo: review accept/reject must save Memory items. Check
   whether it does." — it does, and that is exactly why the collapse is expensive.**
   `manual_reviews::update_status` (`:337-357`) writes a memory on every approve and reject, routed
   to a shared team `decision`/`constraint` when the persona has a team and to a per-persona
   `learned` memory otherwise, with the Director carve-out documented. Live: **237** human-review team
   memories, **236** of them `decision`. The rule holds. Its consequence is that the *batch* verdict
   is what the app learns: a 3-of-8 approval teaches the model `"Human approved the review X"` at
   importance 7, and the five rejections exist — at best — as `-` lines inside the same sentence. **A
   correct learning loop over a lossy verdict amplifies the loss instead of exposing it.**

5. **"`useStudioComposer.ts:74` silently drops entities from a picker based on a score" — confirmed,
   and it is three predicates rather than one, and the score half is broken.** `attentionFor` excludes
   `needs_credentials`, `enabled === false`, **and** `trust_score < 0.5`. Live: **38 of 78 personas
   (49%)** are absent from the picker — 29 + 2 + 7. And `personas.trust_score` is stored **0–100** on
   this install (58.5 … 100.0), so `< 0.5` fires only for the **7 rows at exactly 0** and can never
   fire for a genuinely low non-zero score. `personaStats.ts:204` is the **only** threshold comparison
   against `trust_score` in 4,829 files. The exclusion is the finding for this leaf (a per-item
   rejection with no verdict, no reason and no disclosure); the unit bug belongs to
   [`metric-definition`](./metric-definition.md) and is flagged there.

6. **"Human-review resume: approve → resume. Ask what happens when a reviewer approves 3 of 5 and
   closes the window." — answered by replay, and the answer is worse than "the selection is lost".**
   For the three violating surfaces the staging map is component state and dies on unmount, which is
   the expected answer. For the **compliant** door it is not: the verdicts are staged server-side in a
   `companion_approval` row, and **8 such rows hold 50 verdicts, all `pending`, all past the 24 h
   consent-freshness window, all now permanently unappliable** — verified by replaying
   `load_pending`'s exact predicate. The batch is not registered in `pending_counts`, so it never
   reached the decision badge; there is no sweep, so it has no `expired` status; and the only surface
   that renders it is a modal that was closed. **Persisting a partial verdict is necessary and not
   sufficient — it also needs a way back**, which is P6 and which no repo in the cohort has.

7. **A correction to my own instrument, offered because the doctrine asks for it — twice.** (a) My
   structural counter first reported **3** anchors where the census found **4**, missing
   `MessageDetailModal.tsx:876`. The cause was its string-blanker having no **regex-literal**
   handling: `.replace(/'/g, '&#39;')` at `:339` opened a phantom string at the `'` inside `/'/` that
   cascaded through hundreds of lines of real code. It is the same family as the CSP checker whose
   comment stripper ate every URL — *a stripper that eats the thing it was meant to preserve* — and
   it lost precisely the file holding this leaf's worst instance. (b) After the fix the two
   implementations agreed on the anchor at **4/4 with identical membership** and then **disagreed on
   the partition, 3/1 vs 2/2**, because the structural counter's brace-balancing credited a **JSX
   render loop** (`decisions.map((d) => (<FocusedDecisionCard …/>))`) as a per-item commit.
   Hand-verification resolved it against the structural implementation. Both errors would have
   shipped as confident numbers, and the second is the sharper lesson: **the two implementations
   agreed on the count and still disagreed about what they had counted.**

8. **A correction to a claim in a neighbouring path, offered upward.**
   [`bulk-command-variant`](./bulk-command-variant.md) §8 Gap 1 says the repo has *"six bespoke
   `{id, reason}`-shaped types and one generic type nobody constructs"*, and reads that as a
   type-proliferation problem. Measured from this side it is an **asymmetry**: all six are per-item
   **outcome** types (what happened), and the repo has exactly **one** per-item **input** type —
   `TriageOverride` — with one caller. Six ways to say what happened, one way to say what to do. That
   reframes doctrine Q3 for this neighbourhood: `TriageOverride` is *not* a `LaneOutcome<T>` with zero
   call sites, it is a proven shape with one caller and three surfaces that should be its second,
   third and fourth — which is why §4 says *route the callers*, not *write a type*.
