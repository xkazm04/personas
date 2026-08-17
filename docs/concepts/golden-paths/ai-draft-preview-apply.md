# Golden path — AI draft, preview, apply

> **Topic path:** `ai-agents` › `agent-ux` › `ai-draft-preview-apply`
> [situation spine](../situation-spine.md) · recurrence **24** · risk **medium** ·
> sides: **client** (the spine also carries `twoSided: true` in the same node — see
> [§12.1](#121--sides-client-is-wrong-and-the-spine-contradicts-it-in-the-same-node)) ·
> convergence: **mixed** · dimensions: **ui · function · cost · resilience**
> `mergedFrom`: *Generate-preview-apply* + *Natural-language to definition* +
> *AI-assisted connector authoring* + *AI draft with human edit*
> Composed 2026-08-17 against `master` @ `64b1aa5c3`.
>
> **Sweep size.** All **4,829** `.ts`/`.tsx` under `src/` and all **963** `.rs` under `src-tauri/`.
> The Rust half was walked **twice** — once by the census engine and once by an independently
> written structural counter that brace-matches all **14,710** `fn` bodies over two
> length-preserving blanked views of each file. **24** client draft→preview→apply surfaces and
> **6** generate-is-apply surfaces were opened and read end to end, along with their Rust doors
> (`build_sessions.rs`, `template_adopt.rs`, `team_synthesis.rs`, `consolidate.rs`,
> `consolidation.rs`, `kpi_derivation.rs`, `backlog_triage.rs`, `approval_autopilot.rs`,
> `n8n_transform/confirmation.rs`, `scraper.rs`, `auto_cred_browser.rs`). Six neighbouring
> census rules rooted in `src-tauri` were re-run to measure overlap; all six reproduced their
> committed baselines exactly.
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347 MB, 244 tables) and `personas_data.db` (17.5 MB, 71 tables) were taken
> 2026-08-16 23:31 UTC with the app running; the live files were never opened for write and
> **the copies were deleted at the end of composition**. Four things were then replayed
> verbatim: the **capability preview's own hydration** (`matrixBuildSlice.ts:1355-1400`) against
> every promoted `build_sessions.agent_ir`, beside the rows `promote_build_draft_inner` actually
> wrote, attribution-scoped by `created_at` to the promote instant; **`goal_summary()`**
> (`db/src/repos/dev_tools.rs:1254-1261`) over all 188 `dev_goals`; **`load_pending`-style
> resolution latency** over all 120 `companion_approval` rows; and a whole-schema provenance
> census over both databases. **Nothing was generated, drafted, adopted, promoted or applied in
> the live app**, and `cargo` was not run.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It **cut the effective cohort from 5 to 3**
> (§6), produced the sharpest quote in this document from a repo that fixed this exact bug, and
> **the spine's `convergence: mixed` label survived** — which, per
> [doctrine §5](../golden-path-doctrine.md#5-the-convergence-oracle), is worth reporting as
> loudly as a failure.
>
> **Settles:** what a preview may claim, whether the artifact that gets written is the artifact
> that was shown, what a partial apply leaves, where the draft lives between the two, and
> whether anything records that a model authored the result.
>
> Cross-reference, not overlap.
> [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) owns **the verdict on N
> sub-items**; this owns **the draft and the apply**. Its `apply_persona_memory_review_proposal`
> finding is cited, never re-derived — and §0 answers the question it asked of this leaf.
> [`optimistic-update`](./optimistic-update.md) owns **a write in flight**; this owns **a write
> the user has not authorised yet**. [`audit-trail-view`](./audit-trail-view.md) owns **reading
> the record back**; this owns **whether the record was written**, and §0 finds its
> 168-of-194 defect wearing a second hat.
> [`entity-draft-editing`](./entity-draft-editing.md) owns a draft **the user typed**; this owns
> a draft **a model wrote**, which is why its rule *"on failure keep the draft"* and this path's
> attribution rule are about different objects.

---

## 0. The headline

**Twenty-four surfaces in this app show you something a model wrote and then write it into your
database. Four of them record that a model wrote it.** And on the one queue where a human is
asked to accept a model-authored artifact, the provenance is present in the row and **removed on
its way to the screen** — replayed verbatim, **16 of 16**, including both rows sitting in that
queue right now.

```
goal_summary()   db/src/repos/dev_tools.rs:1254-1261, replayed over all 188 dev_goals
  model-derived goals (kpi_id set, written by derive_goal_from_kpi)      16
  ...whose description carries the provenance footer                     16   (100%)
  ...whose footer survives goal_summary() into the acceptance view        0   (0%)
  currently in the human-acceptance queue (status='awaiting_acceptance')  2
  ...of those, model-authored                                            2/2
  ...of those, showing any sign of it                                    0/2
```

The footer is the *only* provenance these rows have — `dev_goals` has no `source`, `origin`,
`created_by` or `model` column — and the function that strips it says so in its own docstring:

> *"First paragraph of a goal description, with the autonomous-provenance footer
> (`\n\n---\n*Derived from KPI ...*`) stripped — the human-readable summary the acceptance view
> shows under each goal title."* — `db/src/repos/dev_tools.rs:1250-1253`

### The persona's prompt is rewritten by a model between the preview and the apply, and no surface renders it

This is the leaf's seam, and it is open. During template adoption:

1. `ChronologyAdoptionView.tsx:1099` hydrates the client store with `agentIr: effectiveDesignResult`
   — the template's IR. The capability preview (`GlyphCapabilityPreview.tsx:73-88`) renders from
   that store.
2. `ChronologyAdoptionView.tsx:1211` then fires `await adjustAdoptionDraft(sessionId)` **from a
   `useEffect`, while the preview is on screen**, under a comment that states the design:

   > *"Approach 1 — always-on LLM adjustment of the pre-built base IR. Runs once per adopted
   > persona, after answers are seeded and BEFORE the auto-test, so the test + promote operate on
   > a persona specialized to the user's actual connector/credential picks and configuration
   > answers."* — `ChronologyAdoptionView.tsx:1184-1189`

3. `adjust_adoption_draft` (`template_adopt.rs:1923-2098`) runs a 600-second Claude pass and
   writes the result back over `build_sessions.agent_ir` (`:2075`).
4. `promote_build_draft(sessionId, personaId, excluded)` (`useLifecycle.ts:263`) sends **no
   draft**. The server re-reads `build_sessions.agent_ir` (`build_sessions.rs:2626`).

So the applied `system_prompt` and `structured_prompt` are a model rewrite of the ones the
preview was built from. **Nothing re-hydrates the client store after step 3** —
`hydrateBuildSession` has three call sites (`App.tsx:201`, `ChronologyAdoptionView.tsx:1099`,
`useBuildSession.ts:538`) and none of them runs after the adjustment. And it does not matter much,
because **no adoption surface renders `system_prompt` at all**: the only occurrence in
`ChronologyAdoptionView.tsx` is the literal placeholder `"You are a helpful AI assistant."` at
`:1062`, written at persona creation and replaced later by the model.

The command *knows* what it did and hands the answer back:

```rust
pub struct AdoptionAdjustResult { pub adjusted: bool, pub divergence: String,
                                  pub model: Option<String>, pub note: Option<String>, … }
```

`AdoptionAdjustResult` is referenced in exactly **one** file in 4,829 — its own API wrapper,
`src/api/templates/templateAdopt.ts:90-113`. The single call site is
`await adjustAdoptionDraft(sessionId);` with the result **discarded**, and its `catch` is a
`silentCatch`. Whether your persona was specialized by a model, by which model, or not at all is
computed, serialized across IPC, and dropped on the floor.

### Previewed vs written, executed against ten real promotions

The capability preview enumerates one trigger per capability and one chip per event
subscription. Replaying its own hydration (`matrixBuildSlice.ts:1355-1400`, which skips any
use case without an `id`) against each promoted session's stored `agent_ir`, beside the rows
whose `created_at` is within 120 s of that session's promote:

| session | previewed capabilities | previewed triggers | **trigger rows written** | previewed subscriptions | **subscription rows written** |
|---|---:|---:|---:|---:|---:|
| `68e326f6` | 2 | 2 | **4** | 2 | 2 |
| `6dbeba37` | 4 | 4 | **11** | 11 | 9 |
| `0b9a225b` | 2 | 2 | **6** | 5 | 4 |
| `3efd2c29` | 3 | 3 | **5** | 6 | 4 |
| `0ab43938` | 2 | 2 | **4** | 4 | 3 |
| `7bc440fb` | 2 | 2 | **5** | 3 | 3 |
| `1f206953` | 1 | 1 | 2 | 1 | 1 |
| `b2a85e10` | 1 | 1 | **3** | 3 | 3 |
| `aa452376` | 1 | 1 | 2 | 1 | 1 |
| `b3c89e6a` | 1 | 1 | 2 | 1 | 1 |
| **total** | **18** | **19** | **44** | **37** | **31** |

**The preview under-reports triggers by 2.3× and over-reports subscriptions by 19%.** It errs in
*both* directions, which is the tell that nothing reconciles the two — the number on screen is
computed by the client from one shape and the number written is computed by the server from
another. `create_triggers_in_tx` (`build_sessions.rs:2890`) mints an `event_listener` trigger row
per subscription; the preview renders those as radio chips inside a capability, not as triggers.
The user approves "2 capabilities" and the Triggers page afterwards holds 4 rows.

### And the exclusion control cannot reach half the shapes it is offered for

`promote_build_draft`'s exclusion filter is honest in its own comment and the honesty is the
defect:

> *"Match against the LLM-emitted Structured variant id (`uc_morning_digest`) … **Simple variants
> have no id to match — they pass through unchanged.**"* — `build_sessions.rs:2782-2786`

The client half has the same hole from the other side: `matrixBuildSlice.ts:1381` reads
`const id = uc.id as string | undefined; if (!id) continue;`. **A Simple-variant capability is
invisible in the preview and unexcludable at promote.** It is latent on this install — 0 of the
27 use cases across 10 promoted sessions are Simple — and it is a silent capability, not a
visible one, which is the worse failure.

The trigger half of the same filter is **dead code on every session measured**: it only fires
when `ir.triggers.len() == original_count`, and `ir.triggers` is `[]` in **10 of 10** promoted
sessions.

### The provenance census, whole-schema, both databases

| artifact class | live rows | model-authored | what records it |
|---|---:|---:|---|
| `personas` | **78** | ≥73 (`last_design_result` non-empty); 63 via `adoption_log`, 12 via a build session | **nothing.** `trust_origin` is `builtin` on **77 of 78** |
| `persona_triggers` | 351 | 44 written by promote from an LLM IR | **nothing** |
| `persona_prompt_versions` | 25 | 10 | prose: `change_summary = "Promoted from PersonaMatrix build"` |
| `dev_goals` | 188 | 16 | prose footer — **stripped before the human sees it** |
| `companion_fact` | 90 | ~all, via `companion_approval` | **no actor column on the approval** |
| `connector_definitions` | 134 | 0 (`is_builtin = 0` count is **0**) | the AI connector-design path has never landed a row here |
| `playwright_procedures` | **0** | — | the AI browser-procedure path has never landed a row |
| `dev_ideas` | 236 | 214 | ✅ **`model` column** (`claude-sonnet-4-6`) |
| `workspace_knowledge` | 1,306 | 1,304 | ✅ **`provenance` JSON** — `{"actor_kind":"agent","model_ref":"harvest-sonnet"}`; exactly **2 rows are `{"actor_kind":"human"}`** |

Two tables in this install get it right and they are the two newest. Everything the user thinks
of as "my agents" carries nothing.

### The approval that is the preview was not seen by a human 61% of the time

`companion_approval` is the model's action draft awaiting consent — the preview for
`write_fact`, `write_goal`, `enqueue_dev_job` and 20 more. Live:

```
companion_approval rows                                        120
  resolved                                                     106
  ...resolved within 2 seconds of being created                 65   (61.3%)
  median resolution latency                                      0 s
  rows carrying human_review_id                                  0   (0 of 120)
  columns identifying WHO approved                               0
```

`approval_autopilot.rs:783-786` states the posture in a test docstring:

> *"2026-08-10 — the autoapprove ALLOWLIST is gone: **under autonomous mode every proposed action
> fires.**"*

That is a defensible product decision. What is not defensible is that the row it produces is
byte-identical to one a human approved. This is
[`audit-trail-view`](./audit-trail-view.md) §0's *"168 of 194 machine decisions rendered as a
human's"* arriving on the **apply** side of the same seam, in a different table, with a different
mechanism — and it is the brief's third primed lead, confirmed.

### Then look at the denominator

| | count | |
|---|---:|---|
| client surfaces that render a model draft and then commit it | **24** | every one opened |
| — that hand the **whole artifact** back to the persist door | **17** | |
| — that send **only an id** (server re-reads its own copy) | **4** | rows 1, 2, 22, 24 |
| — that send **an id plus the human's delta** — the correct shape | **3** | rows 20, 21, 23 |
| — that write **any** provenance into the durable artifact | **4** | `generatedBy`, `composed_by`, `'ai-compose'`, `committedTriggerId` |
| surfaces where **generate *is* apply** (no preview gate at all) | **6** | §7 D2 |
| Rust call sites that invoke a model | **38** | |
| — that persist the model's output **in the same call** | **4** | §9; 3 reachable by the gate |
| abandoned drafts still at `test_complete` | **2** | **84 days old**, and immortal (§7 D6) |

**24 surfaces, 3 correct apply shapes, 4 provenance records.**

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics, and everything else follows.** **A preview is a promise, and the apply must be
> able to keep it.** The artifact you commit must be traceable to the artifact you displayed —
> by identity, by version, or by being the same bytes. If the apply re-derives, re-reads or
> re-generates, then the preview was an illustration of what *might* happen, and the user's
> approval attaches to nothing.
> *Warrant: measured here — the applied system prompt is a model rewrite produced after the
> preview rendered, and a preview enumerating 19 triggers precedes an apply writing 44; and a
> sibling repo shipped exactly this bug, diagnosed it, and wrote the rule into the call site.*
>
> **P2 — physics, and the sharpest.** **The apply must carry the draft's identity and the human's
> delta, never the merged artifact.** Handing the whole edited object back destroys the only
> information that mattered: which parts the model wrote and which the human changed. A merged
> artifact is unattributable *by construction*, which is why the surfaces that hand one back are
> also the surfaces with no provenance — it is one defect, not two.
> *Warrant: 17 of 24 surfaces here hand back the artifact and 12 of those record nothing; the 3
> that send `(id, delta)` are the only ones that can count an override, and one of them writes
> the word for it. Independently: every sibling with this surface applies by id.*
>
> **P3 — physics.** **A model-authored artifact must say so in a field, not in its prose.** A
> sentence appended to a description is not provenance: nothing can group by it, nothing can
> filter on it, no policy can act on it — and any layer between the row and the reader is free
> to trim it away without knowing what it removed.
> *Warrant: executed — 16 of 16 model-derived goals carry provenance only as a prose footer, and
> the summariser that feeds the human-acceptance queue strips it from 16 of 16, including both
> rows queued today. The two stores here that use a field instead have 100% coverage across
> 1,540 rows.*
>
> **P4 — physics.** **The thing you did not preview is the thing that will hurt you.** Preview
> effort follows what is easy to render — a list of capabilities, a diff, a name — while the
> apply also writes the parts that are long, structural or derived. Enumerate what the apply
> *creates*, not what the draft *contains*.
> *Warrant: the preview here renders capabilities and misses the prompt, the tools, the output
> assertions and 25 of 44 trigger rows; the prompt is the artifact that decides everything the
> agent subsequently does and it is the one nothing shows.*
>
> **P5 — physics.** **An approval that a machine can grant needs a different word than one a
> human granted.** If a consent record cannot distinguish the two, then every downstream claim
> built on it — "a human accepted this", "this was reviewed" — is false for an unknown fraction
> of rows, and the fraction is not small.
> *Warrant: 120 consent rows here, 61.3% resolved at machine speed, zero columns that could tell
> you which. Reached independently from the read side by a neighbouring leaf at 86.6%.*
>
> **P6 — ergonomics with teeth.** **Between preview and apply the draft can go stale, and
> something must notice.** Time passes, the world moves, a second pass rewrites the draft. An
> apply that cannot detect "what you approved is no longer what this is" will confidently commit
> a superseded artifact.
> *Warrant: the strongest silence in the sweep — exactly **one** surface in six codebases reasons
> about it, and it is not in this repo. Personas' three id-only applies re-read a **mutable** row
> with no version check, which is the shape that makes the staleness invisible.*
>
> **P7 — ergonomics.** **A draft the user was shown is work; abandonment is an outcome, not an
> absence.** Half the drafts a model produces are never applied. If nothing distinguishes
> "rejected", "still deciding" and "walked away", the store fills with artifacts that are neither
> live nor dead and no sweep can safely touch.
> *Warrant: 2 previewed-and-abandoned personas here have sat 84 days at `setup_status = 'ready'`,
> preserved by a sweep whose exemption is individually correct.*
>
> **P8 — cost.** **A draft has a price and the price belongs on the draft.** Regenerating on
> apply, adjusting after preview, refining in place — each is another billable call, and a
> pipeline that does not record what a draft cost cannot tell an expensive preview from a cheap
> one, or notice that it paid twice for the same artifact.
> *Warrant: `build_sessions` has `total_cost_usd`, `input_tokens`, `output_tokens` and
> `num_turns` columns and **all four are NULL on all 12 rows**; the adoption path additionally
> spends a 600-second model pass on every adopt whose only guard against wasted spend is a
> divergence check added later, and whose result is discarded.*
>
> **Scale condition.** P1 and P4 are wrong on day one, when the draft is one field and the apply
> writes one row. P2, P3 and P5 bite the first time anyone asks "who decided this" — which is the
> first incident, not the first release. P6 bites the first time a preview stays on screen longer
> than a model call. P7 bites at the second abandoned draft. P8 bites when the second generation
> pass is added, which is always.

---

## 1. Trigger

- "Let the model draft it, show it to them, and they hit Apply."
- "Turn what they typed into a real trigger / schema / persona / connector."
- "Generate a starting point they can edit before saving."
- "Add a Refine button so they can ask for changes and regenerate."
- "It created three triggers and I only approved one." / "That's not the prompt it showed me."
- "Which of these agents did *I* write?"

**If you are about to write** a `useState` holding a model's parsed output that a later button
persists; an `apply(...)` / `promote(...)` / `confirm(...)` whose argument is the object you just
rendered; a `useEffect` that calls a generate/adjust API while a preview is mounted; a Rust
command that runs a model and writes a row in the same body; or an `INSERT` of an artifact a
model produced into a table with no `origin` column — **you are in this situation.**

### Boundaries with the adjacent leaves

- [**`entity-draft-editing`**](./entity-draft-editing.md) owns a draft the **user typed**. Its
  rule is *on failure, keep the draft*, and it is right — the user's input is irreplaceable. A
  model's draft is **replaceable by construction** (you can regenerate it) and **unattributable
  by default** (you cannot tell later who wrote it). Opposite properties, opposite prescriptions.
  Ask **who authored the bytes.**
- [**`optimistic-update`**](./optimistic-update.md) owns a write **already issued** whose result
  is painted early. This owns the window where **no write has been authorised**. Its P5 — *the
  server must outrank the local value* — inverts here: during preview the **local draft** is
  authoritative, and the defect in §7 D1 is precisely a server-side value silently outranking it.
- [**`selective-per-item-verdicts`**](./selective-per-item-verdicts.md) owns **N verdicts over one
  batch**. This owns **one artifact end to end**. They meet at `AthenaVerdictCard` /
  `dev_tools_apply_triage_verdicts`, which is that leaf's exemplar and this leaf's §3 too — for a
  different reason: it is one of only three surfaces here that send `(id, delta)`.
- [**`audit-trail-view`**](./audit-trail-view.md) owns **rendering the record back**. This owns
  **writing it**. Its P1 — *a view may only render what the record contains* — is downstream of
  this path's P3: an audit view cannot show a model author that no apply ever stored.
- [**`structured-output-extraction`**](./structured-output-extraction.md) owns **parsing the
  model's reply**. This starts one step later, at the parsed object.
- [**`model-composed-ui`**](./model-composed-ui.md) owns a surface a model **renders**. This owns
  an artifact a model **persists**.
- [**`informed-consent-gate`**](./informed-consent-gate.md) owns whether consent was **asked**.
  This owns whether what was consented to is what happened.

## 2. The one way

**Persist the draft as a row with an id and a version before you render it, show the user what
the apply will *create* rather than what the draft *contains*, and commit with `apply(draftId,
seenVersion, edits?)` — the id so the server re-reads its own copy, the version so a stale draft
is refused, and the edits as a delta so the artifact that lands can still say which parts a model
wrote.** Concretely: (a) **write the draft down first** — a row with a status, a `created_at`, a
model name and the prompt version; a draft that lives only in component state cannot be resumed,
cannot be attributed, cannot be swept, and cannot be shown to have gone stale. (b) **Stamp the
artifact, not the prose** — an `origin`/`authored_by` column with a closed set (`human` | `model`
| `scan` | `import`) plus a nullable `model_ref`, on the *applied* row, not on the draft; a
sentence in a description field is not a record. (c) **Never regenerate, re-adjust or re-fetch
after the preview renders**; if a second pass is genuinely needed, run it *before* the preview and
show its output, or show the user that it ran and what it changed. (d) **Make the apply take
`(draftId, seenVersion, edits?)`** — withhold the merged artifact from the wire so the caller
*cannot* substitute one, and take the human's changes as a delta so `overridden` is countable.
(e) **Enumerate the effects in the preview, not the draft's fields** — if the apply writes 44 rows
the preview says 44; derive both counts from the same function or they will disagree, and here
they disagree in both directions. (f) **Make the whole apply one transaction** and flip the
draft's status **last**; a status that says `applied` before the loop finishes is a row asserting
an outcome that has not happened. (g) **Give the consent record an actor** — `human` vs
`autopilot` vs `policy`, with the rule that granted it — and never let an auto-granted approval be
byte-identical to a human one. (h) **Give an abandoned draft a terminal state**; decide whether it
expires, and if it does, sweep it and say so on screen. (i) **Record the draft's cost on the
draft** — tokens, model, elapsed — so a second generation pass is visible as a second charge.
Then stop: do not add a second free-text field to carry attribution, do not let the preview render
from a different copy than the apply reads, and do not offer an exclusion control over items the
apply cannot match.

If you must get one right first: **(b)**. It costs one column, it is the only clause that is still
true a year later when the surface has been rewritten, and every sibling repo that has this
surface has it.

## 3. Mandated primitives

**Exist today — use them:**

| primitive | what it gives you |
| --- | --- |
| `src-tauri/src/commands/companion/consolidate.rs:160-211` — `ApplyEdits` + `companion_apply_consolidation_item(item_id, edits)` | **the apply signature to copy.** Its docstring is the whole prescription: *"Optional edit overrides — UI sends only the fields the user changed. Unset fields fall back to the original proposal."* The server re-reads the proposal (`consolidation.rs:311`), refuses a non-`pending` item (`:312-317`), and resolves each field as `edits.x.unwrap_or(item.x)` — so what the model proposed and what the human changed are still separable at write time. |
| `src-tauri/src/commands/design/build_sessions.rs:2869-2921` — the promote transaction | **the atomic apply.** `BEGIN` → tools → triggers → subscriptions → assertions → persona → version snapshot → **draft status last** → `COMMIT`. It is the exact inverse of `apply_persona_memory_review_proposal`'s status-first loop ([`selective-per-item-verdicts`](./selective-per-item-verdicts.md) §0 A3) and it is in this repo already. Copy the ordering and the comment banners. |
| `src-tauri/src/commands/design/build_sessions.rs:2626-2662` — `promote_build_draft_inner`'s re-read | **withholding, done right.** The signature is `(session_id, persona_id, excluded_use_case_ids)`; the artifact never crosses the wire, so a client cannot substitute one. Add a `seen_version` and this is §2(d). |
| `db/src/repos/dev_tools.rs` — `dev_ideas.model` (214 of 236 populated) | **the minimum viable stamp**: one column, the model id, on the applied row. |
| `workspace_knowledge.provenance` — `{"actor_kind":"agent"\|"scan"\|"human","model_ref":…}` | **the shape to copy for §2(b).** 1,306 live rows, **1,304 machine-authored and all 1,304 stamped**, 2 human. The only place in this app where "who wrote this" is a first-class, queryable fact at scale. |
| `src/features/shared/components/feedback/AthenaComposedBadge.tsx` | **the render half**, already shared, already translated, already rendered at **8** sites (`CockpitPanel.tsx:256`, `HomeLearning.tsx:96`, `AutonomousLane.tsx:56`, `IncidentDiagnosisCard.tsx:63`, `ModelRoutingSection.tsx:98`, `PolicyProposalsSection.tsx:232`, `SurfaceRenderer.tsx:115`, `CrewFoundryPanel.tsx:143`). Do not hand-roll a ninth "AI generated" chip. |
| `src/features/home/sub_cockpit/briefing/useMorningBriefing.ts:140-159` | **the provenance value to copy on the client**: `source: { kind, generatedAt, composedBy }` where `composedBy: 'athena' \| 'fallback' \| 'quiet'` — a closed set that distinguishes *the model wrote it* from *the fallback wrote it*, rendered at `CockpitPanel.tsx:255-267`. The cleanest three-valued origin in the tree. |
| `src/features/triggers/sub_studio/suggestions/useAutomationSuggestions.ts:67-85` — `acceptAutomationSuggestion(s.id, created.id)` | **the audit link**: after creating the trigger, the suggestion row is stamped with `committedTriggerId`, so the applied artifact and the draft that proposed it point at each other. The only bidirectional draft→artifact link in the app. |
| `src-tauri/src/commands/companion/backlog_triage.rs:73-296` — `TriageOverride` / `AppliedTriage` | **`(id, delta)` on the wire and `overridden` in the answer.** One entry per item, a named third verdict, and a counter for how many the human flipped. Shared with [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) §3, which owns its per-item half. |
| `src/features/teams/sub_kpis/KPIConnectWizard.tsx:143` + `src/api/devTools/kpis.ts:308,331` — `composed_by` | **the field survives the wire and reaches a badge** (`ComposedByBadge`, `:45`, `:307`). One of four. |
| `src-tauri/db/src/repos/core/build_sessions.rs:308-340` — `expire_stale_non_terminal` | **the abandonment sweep**, with its transition legality reasoned out in the docstring. It exists; it just exempts the population that needs it (§7 D6). |

**Do NOT build:** a fifth "AI generated" badge; a provenance sentence appended to a text column; a
`useEffect` that regenerates while a preview is mounted; an `apply(wholeObject)` for an artifact a
model wrote; an exclusion list matched by an id half the items do not have; a preview whose counts
are computed by different code than the apply's; a consent row with no actor.

## 4. Steps

1. **Write the draft down before you render it.** A row: `id`, `status`, `created_at`, `model`,
   `prompt_version`, the payload, and a monotonic `version`. Everything below needs it, and it is
   what makes §2(c), (f), (g), (h) and (i) expressible at all.
2. **Decide the artifact's `origin` column at the same time as the draft table** — on the
   *applied* row, closed set, plus a nullable `model_ref`. Adding it later means backfilling from
   nothing, which is why 78 personas here will never be attributable.
3. **Design the apply signature next, before any component.** `apply(draftId, seenVersion,
   edits?)`. If you find yourself writing `apply(draft)` or `save({...generated})`, ask what the
   server is supposed to record about who wrote which field.
4. **Enumerate the effects, then render the preview from that enumeration.** Write the function
   that answers *"what rows will this create"* once, call it from the preview and from the apply,
   and assert they agree. Here they don't, by 2.3× in one direction and 19% in the other.
5. **Ask whether the type can make the wrong call impossible — before writing the gate.** Here it
   can, on the wire, and it deletes a whole family; see below.
6. **Run every model pass you intend to run *before* the preview renders.** If a pass must run
   after, it is not an adjustment, it is a second draft, and it needs its own preview.
7. **Commit in one transaction, draft status last.** Return per-artifact outcomes, not a bare ok.
8. **Stamp the applied rows** — `origin`, `model_ref`, and the draft id, so the artifact and its
   draft point at each other.
9. **Give the consent record an actor** and render it. `human` and `autopilot` must be different
   values, not different wall-clock latencies somebody might infer later.
10. **Sweep abandoned drafts, and show the user they were swept.** An expiring draft that
    disappears silently is the same defect as one that never expires.
11. **And then stop.** Do not add a "regenerate on apply" convenience; do not let a second surface
    preview the same draft from a different copy; do not put provenance in prose.

### Can the type make the wrong call impossible? — asked before §9

**Yes, on the wire, and it is the highest-leverage single edit in this document.** The bad state
is not *"the artifact was not attributed"*; it is **"the apply accepted an artifact whose
authorship it could not know"**. That is a signature problem, and `createHypothesis({ statement:
c.text.trim(), generatedBy: persona?.name ?? 'agent' })` is the proof — the caller is *asked* for
the author and answers with a guess, because it is the only party that no longer knows.

Withhold the merged artifact:

```ts
// The dangerous freedom is passing the artifact. Take that; keep the answer.
export interface DraftRef  { draftId: string; seenVersion: number }
export type   FieldEdits<T> = Partial<Record<keyof T, string | number | null>>;

// NOT: applyX(artifact: T)
export function applyX<T>(ref: DraftRef, edits?: FieldEdits<T>): Promise<AppliedX>;
```

```rust
pub struct AppliedX { pub id: String, pub origin: Origin, pub overridden_fields: Vec<String> }
pub enum Origin { Human, Model { model_ref: String }, Scan, Import }   // closed, on the ARTIFACT
```

The consequences are the point. The server owns the draft, so `origin` is a fact it computes
rather than a string the client supplies; `overridden_fields` is derivable because the delta
arrived separately; a `seenVersion` mismatch is a refusal rather than a silent stale commit; and a
surface **cannot** render a preview from copy A and commit copy B, because there is no copy B on
the wire.

Held against the seven qualifications
([doctrine §1](../golden-path-doctrine.md#1-prefer-a-type-over-a-gate--and-the-seven-qualifications)):

- **Q1 — a type carries only what it encodes.** Honest limit: `DraftRef` encodes *that the server
  re-reads its own copy at a version the client saw*. It does **not** encode that the preview
  rendered from that same copy. §7 D1 would survive this edit — the adjustment pass writes a new
  version, `seenVersion` would now *catch* it, but only if the client's preview state is where the
  version comes from. That is why §2 leads with (a) and not with (d).
- **Q2 — requiredness ≠ closedness.** The win is closedness twice: on `Origin` (a `String`
  `origin` column reproduces `trust_origin`, which is `builtin` on 77 of 78 personas *and is
  required*), and on the door set (`applyX` accepts a ref, never an artifact).
- **Q3 — a type nobody constructs constrains nothing.** **Survives, and this is why the
  prescription is "route the callers", not "invent a type".** The `(id, delta)` shape is already
  constructed three times in production — `companionApplyConsolidationItem(item.id, edits)`,
  `applyTriageVerdicts(approvalId, overrides)`, `acceptAutomationSuggestion(s.id, created.id)` —
  and consumed by Rust commands that have run. Seventeen surfaces should be its fourth through
  twentieth.
- **Q4 — a type anyone can construct authenticates nothing.** Live and decisive: `generatedBy:
  persona?.name ?? 'agent'` is a `string` the client invents. **The whole reason `Origin` must be
  computed server-side from the draft row is Q4** — a provenance field the client fills is a
  comment.
- **Q5 — withholding beats requiring.** The dangerous freedom is *sending the artifact*. Requiring
  a `generatedBy` argument has been tried here — it is the one surface that asks, and it gets a
  guess. Withholding the artifact means the question never needs asking.
- **Q6 — withhold the dangerous freedom, not the answer.** The answer is *what the human changed*;
  keep that, as a delta. Withholding the edits entirely (`apply(id)` alone) is what the four id-only
  surfaces do, and it breaks the feature — the user's edits vanish. This is Q6 exactly, and the
  three hybrid surfaces are the ones that got the split right.
- **Q7 — withholding a requirement helps only where the requirement forced the bad value.**
  Nothing *required* these 17 surfaces to send the whole artifact; it is simply the obvious
  spelling of "save this". So the fix is withholding the permissive door, not widening a type.

**And one destination needs fixing before the gate points at it** (contract, fifth §9 failure
mode). Routing callers to a provenance-carrying door is worth little while the reader strips it:
`goal_summary()` removes the only provenance `dev_goals` has, 16 of 16, on the exact surface where
a human accepts the artifact. **Fix the reader first**, or the gate will route people to a field
that a summariser deletes on the way to the screen.

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A model pass fired from a `useEffect` while the preview is mounted** | The applied artifact is a rewrite of the one on screen, and the seam is invisible because the rewritten field is not rendered anywhere. `ChronologyAdoptionView.tsx:1190-1220` → `template_adopt.rs:2075`. §7 D1. |
| **`apply(wholeArtifact)`** | The server cannot tell model bytes from human bytes, so it cannot stamp `origin`, cannot count overrides, and cannot refuse a stale draft. 17 of 24 surfaces; 12 of them consequently record nothing. §7 D3. |
| **`apply(draftId)` with no delta** | The mirror error: the user's edits are dropped at the boundary. Withhold the artifact, not the answer (Q6). |
| **`apply(draftId)` against a mutable row with no version** | The server re-reads *the current* draft, not *the approved* draft. Correct-looking and the reason §7 D1 is invisible. Only one surface in six codebases guards this, and it is not here. |
| **Provenance as a sentence in a text column** | Not groupable, not filterable, not policy-actionable — and any summariser is free to trim it. Executed: 16 of 16 stripped, on the acceptance queue. §0. |
| **Asking the client for `generatedBy`** | The client is the one party that has already merged the model's draft with the human's edits, so it answers with a guess — `persona?.name ?? 'agent'`. Q4. |
| **A preview that renders the draft's fields instead of the apply's effects** | 18 capabilities on screen; 44 trigger rows, 31 subscriptions, 210 tool rows and a rewritten prompt in the database. §0. |
| **An exclusion control matched on an id half the items lack** | `Simple` variants have no id, so they are invisible in the preview *and* unexcludable at apply — a capability the user cannot see and cannot remove. `build_sessions.rs:2782-2786` + `matrixBuildSlice.ts:1381`. §7 D4. |
| **A filter whose guard is positional alignment with an array that is always empty** | `if ir.triggers.len() == original_count` with `ir.triggers == []` in 10 of 10 sessions: dead code that reads as a safeguard. §7 D4. |
| **A consent row with no actor column** | 61.3% of this app's action approvals resolved at machine speed and nothing distinguishes them from a human's. Every downstream "a human approved this" is false for an unknown fraction. §7 D5. |
| **Computing provenance and discarding it** | `AdoptionAdjustResult { adjusted, divergence, model, note }` — serialized across IPC, `await`-ed, dropped. `TrainingStudio.tsx:111` sets `aiDrafted: true` in row state and `:160` persists the text without it. Twice, independently. §7 D1, D3. |
| **Generate == apply, called a preview** | `TeamSynthesisPanel.tsx:28` creates the team and its personas server-side; the result screen is a receipt. Fine as a decision, a lie as a gate. §7 D2. |
| **Leaving the draft's cost columns NULL** | `build_sessions` has `total_cost_usd`, `input_tokens`, `output_tokens`, `num_turns`; all four are NULL on all 12 rows, so a 600-second adjustment pass and a 3-second one are indistinguishable forever. §7 D7. |
| **A sweep whose exemption is the population that needs it** | `expire_stale_non_terminal` correctly spares `lifecycle='draft'` personas because their builds are live work — and the abandoned previews are exactly those. 2 rows, 84 days, `setup_status='ready'`. §7 D6. |

## 6. Evidence

**The one site to copy: `src-tauri/src/commands/companion/consolidate.rs:160-211` and its
implementation at `src-tauri/src/companion/brain/consolidation.rs:305-395`.**

```rust
/// Optional edit overrides — UI sends only the fields the user changed.
/// Unset fields fall back to the original proposal.
pub struct ApplyEdits { pub value: Option<String>, pub key: Option<String>,
                        pub scope: Option<String>, pub importance: Option<i32>,
                        pub confidence: Option<f32> }

pub async fn companion_apply_consolidation_item(state, item_id: String, edits: Option<ApplyEdits>)
    -> Result<ApplyOutcome, AppError>
{
    …
    let item = load_item(pool, item_id)?;                       // :311  the SERVER re-reads
    if item.status != "pending" { return Err(…) }               // :312  and refuses a spent draft
    let value = edits.value.as_deref().unwrap_or(&item.proposed_value);   // :321  delta over proposal
    let importance = edits.importance.unwrap_or(item.importance);
    …
    conn.execute("UPDATE companion_consolidation_item
                  SET status='applied', resolved_at=?1, fact_id=?2 WHERE id=?3", …)  // :390 status LAST
}
```

Five decisions worth copying: (1) the wire carries **an id and a delta**, never the artifact;
(2) the server **re-reads its own copy**, so the client cannot substitute one; (3) a non-`pending`
draft is **refused by name**, which is the cheapest half of P6; (4) every field resolves as
`edits.x.unwrap_or(item.x)`, so *"the model proposed this and the human changed it"* is still a
fact at write time; (5) the draft's status flips **after** the artifact is written, and the
resulting `fact_id` is written back onto the draft row — a bidirectional link.

**And its client half, `ConsolidationReview.tsx:413-421`:**

```ts
const edits = editing
  ? { value: draftValue !== item.proposedValue ? draftValue : undefined, key: …, importance: … }
  : undefined;
await companionApplyConsolidationItem(item.id, edits);
```

`draftValue !== item.proposedValue ? draftValue : undefined` is the whole prescription in one
expression: **an unchanged field is not sent**, so silence means "the model's value" and a present
value means "the human overrode it". Every one of the 17 hand-back surfaces destroys exactly this
distinction.

**One honest caveat, because it is this leaf's own trap.** The `ml`-enabled arm of `apply_item`
(`consolidation.rs:350-380`) can fold the approved value into an existing near-duplicate fact via
`find_near_duplicate` → `reinforce_fact`, returning **a different `fact_id` than the one the user
approved**. The design is defensible (dedup) and it is unannounced: the preview said "write this
fact" and the apply may reinforce another. It is latent here —
`companion_consolidation_item` holds **0 rows**, so the best apply door in the app has never run
in production, which is the same shape [`selective-per-item-verdicts`](./selective-per-item-verdicts.md)
§D5 found for its own exemplar.

**Also exemplary:**

- `build_sessions.rs:2869-2921` — the promote transaction and its `BEGIN`/`COMMIT` comment
  banners. Tools → triggers → subscriptions → assertions → persona → snapshot → **draft status
  last**. This is what §2(f) looks like, and it is already here.
- `useAutomationSuggestions.ts:67-85` — `createTrigger(...)` then
  `acceptAutomationSuggestion(s.id, created.id)`: the applied artifact's id is written back onto
  the draft. The only bidirectional link in the app.
- `useMorningBriefing.ts:140-159` + `CockpitPanel.tsx:255-267` — a three-valued
  `composedBy: 'athena' | 'fallback' | 'quiet'` that reaches a badge. Distinguishing *the model
  wrote it* from *the fallback wrote it* is the distinction 20 other surfaces cannot make.
- `useConversation.ts:112-115` — the correct way to **decline** a model suggestion at apply time,
  with the reason at the call site: *"Personas are re-resolved at run time — the preview's
  suggestion is a routing hint, not a binding"*, then `assignedPersonaId: null`. A previewed value
  deliberately dropped, in writing.
- `db/src/repos/dev_tools.rs` `dev_ideas.model` — one column, 214 of 236 populated, and it is the
  column [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) §0 already showed
  carries 96% reason coverage on rejections. The cheap answer works.

### Convergence — five sibling repos, and the cohort is really three

Read-only sweep of `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. All five exist; all five were opened; none was modified. Searched by **name**
(`draft`, `preview`, `proposal`, `suggest`, `generate`, `apply`, `accept`, `staged`, `candidate`,
`dryRun`) **and** by **mechanism** (a model call whose result is held in state and persisted by a
separate user action), per [doctrine §5](../golden-path-doctrine.md#5-the-convergence-oracle).

**Establish the cohort first.** Two of the five have **zero** surfaces of this shape:

- **`personas-web`** contains no LLM call anywhere in `src` — the only `claude`/`anthropic` hits
  are marketing copy and guide content. Its one review queue flips a mirrored Supabase row's
  status; nothing is drafted and nothing is committed. Its `resolvedBy` is the hardcoded string
  `"You"` / `"System"` (`reviewStore.ts:70,324`).
- **`personas-cloud`** pauses a running Claude process on a `manual_review` event and resumes it
  with free text (`executor.ts:208-216`). Nothing is previewed as an object; the pending reviews
  are **in-memory only** and vanish on orchestrator restart.

So the cohort with this surface is **3**, and one of those three — `brainiac` — shares this
repo's operator and states this repo's doctrine nearly verbatim
(`brainiac/docs/LIBRARY-PLAN.md:51` *"Agents propose; the gate decides"* ≡ `src/api/devTools/workspaces.ts:5`
*"agents propose / humans adopt"*). No shared code or constants were found, so it is a shared
*author*, not a port — **weaker than independent reinvention and stronger than nothing.** Ratios
below are stated against 3, not 5.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **The applied artifact records that a model authored it** | **PHYSICS (3 of 3) — Personas is behind at 4 of 24** | `brainiac`: `standards.origin ∈ human\|sweep\|agent` (`0030_library_proposals.sql:10-11`), `skills.proposed_by`, a `standard_provenance` table **and a DB trigger that refuses adoption without it**. `vibeman`: `DbIdea.provider`/`DbIdea.model` persisted (`idea.repository.ts:202,225`), `tech_debt.detected_by ∈ automated_scan\|manual_entry\|ai_analysis`. `ascent`: `Scan.engineProvider`/`engineModel` (`schema.prisma:302-303`). **Three repos, three stacks, three independent spellings of the same column.** |
| 2 | **The apply withholds the artifact and takes an id** | **PHYSICS (3 of 3) — Personas is behind at 7 of 24** | `brainiac` **universally**: `adopt(id)`, `publish(slug)`, `approve(revisionId)`, `ratify(id)`; editing is a separate, revisioned, attributed call. `vibeman`: `accept({ideaId})`, `accept(directionId)`. `ascent`: `apply(practiceId, repo)`, `apply(playbookId, repo)`. Its one hand-back path (`POST /api/org/issue {title, body}`) is also its one unattributed path — **the same coupling this path's P2 predicts, in a repo that never read it.** |
| 3 | **⚠ THE SHARPEST — the previewed thing is what gets applied, enforced at the call site** | **`ascent` alone, and it is a fixed bug** | `ascent/src/components/connect/../PracticeApply.tsx:128-131`, written after `bug-ui-scan-2026-06-25/practices-governance-adoption.md:16` ("Preview can be applied to a different repo than the one previewed"): *"// Apply the repo we actually PREVIEWED, never whatever the dropdown reads now — the previewed artifact (commands/description) is repo-specific, so opening a PR in a different repo would land content the user never reviewed."* **A sibling shipped this leaf's bug, found it, and wrote the rule into the code.** |
| 4 | **⚠ Something notices the draft went STALE between preview and apply** | **SILENCE — 1 of 6, and not here** | `brainiac/crates/brainiac-store/src/documents.rs:761-766`: *"Reject a backwards move: while this revision sat in review, a memory change may have auto-published a NEWER revision as current. Approving the older one would republish content built from since-superseded memories — a confident republish of known-stale belief. Leave it pending so the UI can prompt a recompose."* Nothing anywhere else in six codebases reasons about this. Personas' three id-only applies re-read a mutable row with no version check. **P6 is a frontier, not a lag.** |
| 5 | **The apply is transactional** | **MIXED (1 of 3)** | `brainiac` runs every handler in `scoped_tx` and commits once (its one non-transactional seam is edit-then-adopt as two server actions, `TriageControls.tsx:153,250`). `vibeman` compensates rather than transacts — a CAS claim, a file write, a 3-attempt rollback, then a `CRITICAL` log. `ascent` has no transaction at all; its batch `mapPool`s per-repo with independent try/catch. **Personas' promote is fully transactional and is ahead of two of three.** |
| 6 | **⚠ The apply REGENERATES the artifact** | **PRESENT (2 of 3), and both are deterministic** | `ascent/lib/practices/apply.ts:31-32` re-runs `fetchRepoContext` + `buildArtifact` on apply; `vibeman/src/lib/ideas/ideaAcceptanceWorkflow.ts:135` rebuilds from the stored idea with goal/context **re-fetched**. Both are safe *because no model is involved* — `ascent/src/lib/practice-artifact.ts:6` is explicit: *"Deterministic and pure (no LLM, no I/O)… it never invents architecture it can't know."* **Regeneration is survivable when it is deterministic and fatal when it is a model**, which is exactly the difference between them and §7 D1. |
| 7 | **The consent record names its actor** | **MIXED (2 of 3)** | `brainiac`'s provenance is justified as a review affordance, not a checkbox (`library.rs:110-112`: *"a maintainer deciding whether to trust a rule must see who is asking"*). `ascent` records `actorId` on `AuditLog` but never notes that a draft preceded the write; its issue filer stamps `_Filed via Ascent by @{login}_` — **attributing the human for a model's draft.** Personas' `companion_approval` has no actor at all. |
| 8 | **SILENCE — the prompt or prompt version stored beside the artifact** | **0 of 6** | `brainiac` comes closest (`compose.rs:37` names `COMPOSE_SYSTEM_PROMPT_V1` as a constant and `model_ref` rides the faithfulness verdict), and even there the version is not on `document_revisions`. Nobody can answer *"which prompt produced this artifact"*. Reported as a silence; §2(a)'s `prompt_version` is a proposal, not an adoption. |
| 9 | **One idea to steal** | `ascent` | `MAX_BATCH = 25` is duplicated client-side with a comment tying the two, **and the batch is ordered neediest-first so the cap never silently drops the repos the rollout should fix.** A cap that changes *which* items are dropped is a preview-fidelity decision, and it is the only place in the fleet that treats it as one. |

**Physics — keep as doctrine:** clauses 1, 2 (both as *Personas is behind*), 6 (as the
deterministic-vs-model discriminator).
**Reported as silence:** clauses 4 and 8.
**Personas is ahead** on clause 5 (its promote transaction is the best in the cohort) and on
having a shared, translated `AthenaComposedBadge` at all — and **behind** on 1, 2, 4 and 7, which
is why the numbers in §0 are what they are.

> **The sentence the cohort wrote that this leaf should be judged against**, from
> `brainiac/crates/brainiac-pipeline/src/library_sweep.rs:14-18`:
> *"A GENERATOR, NEVER AN AUTHORITY (L2): everything lands as `proposed` with its signal attached
> as provenance; only a named human adopts."*
> Two words carry it: **attached** (provenance is on the row, not in the prose) and **named** (the
> human is identified, so the machine's approval cannot wear the human's clothes).

## 7. Deviations

Every entry is live on `master` @ `64b1aa5c3` and was verified by reading the file, by replay, or
against a read-only copy of the operator's database. **Per the campaign's no-destructive-applies
rule these are notes, not asks** — the operator adopts and promotes personas in this app, and
every fix below changes a schema, changes what a live apply writes, or changes what a preview
shows.

### D1 — P0. The previewed draft is rewritten by a model before the apply, and nothing shows it

`ChronologyAdoptionView.tsx:1190-1220` → `templateAdopt.ts:111-115` → `template_adopt.rs:1923-2098`
→ `build_sessions.rs:2626`.

1. **The rewrite happens after the preview mounts.** The `useEffect` is gated on
   `currentBuildPhase === 'draft_ready'` — the phase whose own status label is *"Draft ready — test
   & promote"* (`:1247`). The preview is on screen.
2. **The client never re-reads.** `hydrateBuildSession` has three call sites and none is
   downstream of the adjustment; `handleStartTest` (`useLifecycle.ts:125-179`) calls
   `testBuildDraft` and stores tool results, not the IR.
3. **The rewritten field is rendered nowhere.** `system_prompt` appears once in the 1,900-line
   adoption view, as the placeholder `"You are a helpful AI assistant."` (`:1062`).
4. **The evidence is returned and discarded.** `AdoptionAdjustResult`'s four fields —
   `adjusted`, `divergence`, `model`, `note` — are referenced in **1 of 4,829** files, the api
   wrapper itself. `ChronologyAdoptionView.tsx:1211` awaits the call and drops the value; the
   `catch` is a `silentCatch`.

The pass is well-built in every other respect — it is scoped to prose
(`merge_adjusted_prose`, `:2061`), it skips the LLM entirely on a default adopt (`:2071-2090`,
with the measured 42-second saving written down), it has a degradation guard
(`adjustment_prose_degraded`, `:2046`), and it falls back to the base IR on any failure. **The
defect is not the rewrite; it is that the rewrite is invisible.**

**Fix (note):** surface the result — an `AthenaComposedBadge` with `model` and `divergence` on the
draft-ready card — and re-hydrate the session (or render the adjusted `system_prompt`) before
promote is offered. Both change what a live adoption surface shows.

### D2 — P0. Six surfaces where generate *is* apply, presented as a flow with a gate

| site | what it writes with no preview |
|---|---|
| `TeamSynthesisPanel.tsx:28` → `team_synthesis.rs:423-620` | a team **and N personas** (`persona_repo::create`, `:581`; `team_repo::create`, `:619`). The result screen (`:112-129`) is a receipt. |
| `CrewFoundryPanel.tsx:116` → `synthesize_project_crew` | same shape. **This one does stamp** `forgedFromProjectId` and renders `AthenaComposedBadge` "Forged by Athena" (`:143`) — the correct half of §2(b) on a surface with no gate at all. |
| `devToolsContextSlice.ts:188` `generateContextDescription(contextId)` | the description, server-side, on generate. |
| `useAddKpi.ts:100` `proposeKpiAuto(...)` | a KPI row at `proposed` status — the one member of this list that is honest: the gate is downstream in Teams › KPIs, and the row says so. |
| `useDevCloneAdoption.ts:33` `instantAdoptTemplate('Dev Clone', …)` | a full persona. Deliberate no-preview shortcut, documented. |
| `kpi_derivation.rs:313-400` `derive_goal_from_kpi` | a `dev_goals` row, from an unattended loop, with provenance in a prose footer. **16 live rows.** |

The pattern that separates the acceptable from the not is `useAddKpi`'s: **write it at a
non-active status.** Four of the six write a live artifact.

**Fix (note):** for the two synthesis paths, either write the personas at `lifecycle='draft'` (the
column exists and the promote path already uses it) or state on the button that it creates
immediately.

### D3 — P1. Seventeen surfaces hand the merged artifact back, and twelve consequently record nothing

The population, from reading all 24: rows that pass the previewed object (or fields read off it)
straight into a persist door — `useN8nWizardLifecycleHandlers.ts:41`
(`confirmN8nPersonaDraft(payloadJson, sessionId)`), `useCreateTemplateActions.ts:101`,
`GenerateHypothesesModal.tsx:111`, `ReplyOutbox.tsx:177`, `IdentityAtelier.tsx:68`,
`TrainingStudio.tsx:160`, `useConversation.ts:101`, `useAutoTeam.ts:109,132,169`,
`useCredentialDesign.ts:85,108`, `useAutoCredSession.ts:206`, `ChatTab.tsx:183`,
`ScrapeEditorModal.tsx:30`, `applyDesignResult.ts:87,94`, `RecipeVersionsTab.tsx:78`,
`KPIConnectWizard.tsx:143`, `MeasureSetupModal.tsx:178`, `KpiSimSuggestions.tsx:106`.

Four of them do write provenance and **all four had to invent the value client-side**:
`generatedBy: persona?.name ?? 'agent'` (`GenerateHypothesesModal.tsx:114`),
`result.composed_by` (`KPIConnectWizard.tsx:143`), the literal `'ai-compose'`
(`MeasureSetupModal.tsx:76`), `committedTriggerId` (`useAutomationSuggestions.ts:84`). The rest
write nothing, and **two of them compute the fact and then drop it**:
`TrainingStudio.tsx:111` sets `aiDrafted: true` on the row and `:160` persists the text without
it; `useCredentialDesign.ts:108` packs `setup_instructions` and `summary` into the connector's
`metadata` JSON and no model marker.

Two sub-defects found while reading:

- **`useCreateTemplateActions.ts:89` silently discards the user's edits on the recovery path.**
  `updateDraft` (`useWizardReducer.ts:75-77`) writes `draft` and `draftJson`, **not**
  `designResultJson`; the save reads `state.designResultJson || JSON.stringify({...state.draft...})`,
  and on the snapshot-recovery path (`useCreateTemplateSnapshot.ts:114`) `designResultJson` is
  non-empty. The user edits the preview, presses save, and the un-edited generation is stored.
- **`useDesignAnalysis.ts:180-187` re-sends the stored canonical result, not the thing on screen**
  — deliberately, with the reasoning at the call site. Correct for its purpose (P1's *identity*
  form) and it is the one place where the "preview and apply read different copies" hazard is
  faced in writing.

**Fix (note):** route these to `(draftId, seenVersion, edits)` (§4). It changes every one of 17
live commit paths, so it is a rollout, not an apply.

### D4 — P1. The exclusion control cannot reach `Simple` capabilities, and its trigger half is dead

`build_sessions.rs:2789-2842` + `matrixBuildSlice.ts:1379-1381`.

- `AgentIrUseCase::Simple(_) => false` (`:2801`) — never excluded, stated in the comment.
- `if (!id) continue;` (`matrixBuildSlice.ts:1381`) — never rendered either. A `Simple` capability
  is invisible in the preview and unexcludable at promote: the user cannot see it and cannot
  remove it.
- The aligned-trigger filter (`:2823`) requires `ir.triggers.len() == original_count`.
  **`ir.triggers` is `[]` in 10 of 10 promoted sessions on this install**, so the guard has never
  executed. It reads as a safeguard against phantom trigger rows and is not one.

Live blast radius today: **0** — no session carries a `Simple` variant. That is why this is D4 and
not D1; it is also exactly the kind of latency that makes a defect ship.

**Fix (note):** give `Simple` variants a synthesised stable id at parse time (title slug) so both
halves can address them, and drop the positional-alignment branch in favour of filtering triggers
by `use_case_id`.

### D5 — P1. 120 consent rows, 61.3% granted at machine speed, zero actor columns

`personas_data.db` → `companion_approval(id, session_id, kind, payload, status, human_review_id,
created_at, resolved_at)`. There is no `decided_by`, no `actor`, no `resolver_kind`. Replayed over
every row:

```
resolved 106   |  min 0 s   p50 0 s   max 1,060,383 s
resolved within 2 s of creation ............ 65  (61.3%)
human_review_id populated .................. 0   (0 of 120)
```

By action: 30 `write_fact` (all approved), 24 `fleet_kill` approved / 7 rejected / 6 failed,
6 `enqueue_dev_job`, 5 `register_project`, 4 `dev_improve`, 3 `write_backlog_item`,
8 `backlog_apply_triage` still `pending`, and 18 more. The autonomous posture that produces the
zero-second resolutions is deliberate and documented
(`approval_autopilot.rs:783-786`); what is missing is the column that would let anything
downstream tell the two apart.

This is the same defect [`audit-trail-view`](./audit-trail-view.md) §0 measured on
`persona_manual_reviews` (168 of 194, no `resolved_by`), in a second table, reached from the apply
side. **Two independent stores, two independent teams of one, same omission.**

**Fix (note):** add `decided_by TEXT` with a closed set and write it at both grant paths. It is a
schema migration on the companion store and it changes what the approvals surface renders.

### D6 — P2. Two abandoned drafts, 84 days old, immortal by correct reasoning

```
build_sessions.phase = 'test_complete'
  769a79ce  updated 2026-05-25T17:38  persona "Knowledge Base Health Auditor"        lifecycle=draft  setup_status=ready
  60f85cb4  updated 2026-05-25T17:48  persona "Website & Market Intelligence Profiler" lifecycle=draft  setup_status=ready
```

`expire_stale_non_terminal` (`build_sessions.rs:308-340`) would sweep both — its `WHERE` covers
every non-terminal phase past `min_age_hours` — except for the clause that spares
`lifecycle='draft'` personas, whose docstring explains it: *"a draft's in-flight build IS live
work"*. That reasoning is right for a build in progress and exactly wrong for a build that was
previewed and walked away from, and **on this install those are the same two rows**: the only two
`lifecycle='draft'` personas in the table are these two.

They also carry `setup_status = 'ready'` — a persona that was never promoted, asserting readiness,
for 84 days.

**Fix (note):** distinguish "the build is running" (`analyzing`/`resolving`/`testing`) from "the
build finished and nobody promoted it" (`test_complete`/`draft_ready`), and sweep the second.
First run of any change here deletes or cancels rows.

### D7 — P2. A draft's cost is unrecorded, and the pipeline pays twice by design

`build_sessions` carries `total_cost_usd`, `input_tokens`, `output_tokens` and `num_turns`
(`core/src/models/build_session.rs:302-313`, with a doc comment describing exactly what should
fill them). **All four are NULL on all 12 rows.** Grep finds no writer.

Meanwhile the adoption path spends a **600-second-budgeted** model pass per adopt
(`template_adopt.rs:2013`, wrapper timeout 660 s at `templateAdopt.ts:115`); the custom-template
path re-runs `generateTemplateBackground` on "apply adjustment"
(`useCreateTemplateActions.ts:147`); and the vault connector path fires a second design call from
inside the preview (`useCredentialDesignOrchestrator.ts:183-211`). The one guard that exists is
the divergence check that skips the LLM on a default adopt, added after measuring *"~42s of pure
overhead for zero value"* (`template_adopt.rs:2064-2070`) — a good fix, arrived at by someone
timing it by hand, because the columns that would have shown it are empty.

**Fix (note):** write the four columns from the CLI's `result` line, and put the draft's cost on
the draft-ready card.

### D8 — P2. Two AI-authoring paths have never produced a stored artifact

- `connector_definitions` holds **134 rows and 0 with `is_builtin = 0`**. The AI connector-design
  flow (`useCredentialDesign.ts:85` → `createConnectorDefinition({… is_builtin: false })`) has
  never landed one on this install.
- `playwright_procedures` holds **0 rows**, so `start_auto_cred_browser`'s
  `playwright_procedures::save` — one of the four no-preview-seam sites in §9 — has never
  persisted a model-authored browser procedure either.

Reported, not fixed: an unexercised path is a fact about coverage, and it is the reason both are
absent from the live-blast-radius column above.

### The measurement that could not be made

I tried to size the damage the obvious way: *how many artifacts in this database did a model write
that a human believes they wrote?* **There is no such query, and the reason is the finding.**

For 78 personas, 351 triggers, 210 tools and 102 subscriptions, the origin was never recorded, so
the question is not merely unanswered — it is **unanswerable, permanently, with no backfill
possible**. The best available proxy is `last_design_result` being non-empty (73 of 78), which
tells you a design pass *ran*, not that a model authored what shipped. The two tables that *can*
answer it (`dev_ideas`, `workspace_knowledge`) answer it completely, at 100% coverage across 1,540
rows, because somebody added one column.

This is the mirror of [`optimistic-update`](./optimistic-update.md) §7's failed measurement. There,
the damage never reached rest. Here it reached rest and **arrived stripped of the one field that
would have made it auditable** — which is why §2's first-priority clause is a column and not a
component, and why §9 must key on the code shape rather than on evidence of harm.

## 8. Gaps

1. **There is no draft table, only draft-shaped columns on other things.** `build_sessions` is the
   nearest thing to a general draft row and it is welded to persona construction; every other
   surface either invents its own (`n8n_transform_sessions`, `companion_consolidation_item`,
   `companion_approval`, `automation_suggestions`) or keeps the draft in component state (17 of
   24). A shared `ai_drafts(id, kind, payload, model, prompt_version, version, status, cost_usd,
   created_at)` would make §2(a), (c), (f), (h) and (i) mechanical; today each is re-derived.
2. **No artifact table has an `origin` column, and adding one to `personas` cannot be backfilled.**
   `trust_origin` looks like the place and is not — it is `builtin` on 77 of 78 rows including all
   63 adopted and all 10 promoted, so it is measuring provenance of the *template*, not of the
   *artifact*. This is a genuine limitation, not laziness: the information was never captured.
3. **Nothing versions a draft, so P6 is unimplementable today.** `build_sessions` has
   `updated_at` and no version; `companion_approval` has `created_at` and a 24 h freshness window
   but no version. A `seenVersion` on the apply needs a monotonic counter on the draft row, which
   does not exist anywhere in either database.
4. **`tokenMaps.ts` has no category for an origin.** Its ten categories are execution, event,
   automation, severity, priority, healing_status, healing_category, connector_status, test, dev.
   §2(b) mandates a closed origin vocabulary and there is no shared door for it — the same gap
   [`selective-per-item-verdicts`](./selective-per-item-verdicts.md) §8 Gap 7 found for verdict
   reasons and [`bulk-command-variant`](./bulk-command-variant.md) §8 Gap 6 for failure reasons.
   **Three leaves now want one category table.**
5. **`AthenaComposedBadge` is a chip with no data behind it.** Seven of its eight render sites draw
   it from a locally-known fact, not from a field on the row — so it cannot be used over a list, and
   the one place it *is* driven by stored data (`composed_by`) is stored on the binding, not the
   KPI.
6. **The preview and the apply have no shared effect-enumerator.** `GlyphCapabilityPreview` counts
   from `sess.capabilities`; `create_triggers_in_tx` counts from `ir.use_cases` plus
   `event_subscriptions`. Nothing forces them to agree and §0 measures that they don't. This is a
   real gap: the function that answers *"what will this write"* would have to live on the Rust
   side and be callable as a dry run, and no such door exists.
7. **`companion_apply_consolidation_item`'s dedup can substitute the artifact and cannot say so.**
   `ApplyOutcome { item_id, fact_id }` carries no flag distinguishing "written as approved" from
   "folded into an existing fact". The best door in the app has a one-field gap.
8. **There is no dry-run anywhere.** No apply door in the app accepts a `dry_run: bool` and
   returns the effect set. `ContextMapHealth.tsx:102,113` comes closest —
   `repairCrossRefs(projectId, false)` then `(projectId, true)` — and it demonstrates the hazard
   rather than solving it: the server recomputes the plan on apply, so the applied set can differ
   from the previewed one, with nothing comparing them.

## 9. The missing gate

**The condition, stated stack-free:** *a model's output reaches durable storage inside the same
call that produced it, so no preview seam exists at all — the user is shown a result, never a
proposal.*

**The signal (a proxy, and stated as one):** a **model invocation followed by a durable write of a
domain artifact within the same function body**. This keys on the shape the condition wears **in
this repo**, where every model call goes through one of nine named helper functions and every
durable write goes through a repo module or a rusqlite `execute` on a SQL string literal. **An
adopting repo must re-derive its own proxy** — an ORM `create` after an SDK `messages.create`, a
Django view, a serverless handler that awaits a completion and then upserts. The condition to
re-derive is *"is there a point between the model's answer and the row where a human could have
said no"*, not the token `run_claude_prompt`.

**The mechanism: a census rule.** The runner already exists (`scripts/census/`) and implements the
fail-loud contract, so this path writes no script.

**Where it executes:** two places, neither CI-only. `npm run census:check` is part of
`npm run check`, and it is the **`golden-path-census` pre-push job** in `lefthook.yml:74-75`. Per
this batch's calibration `ci.yml` is red on 10 pre-existing failures, so **a gate that only runs in
CI runs nowhere.** This one fails the push.

**Precision 3/3 on the stated condition; every match opened and read.**

| match | the model call | the write | is it a defect |
|---|---|---|---|
| `commands/design/team_synthesis.rs:444` | `run_claude_prompt_tracked` | `persona_repo::create` (`:581`), `team_repo::create` (`:619`) | **yes** — a team and N live personas from one prompt, receipt-not-gate (§7 D2) |
| `commands/design/template_adopt.rs:2014` | `run_claude_prompt_text_inner` | `build_sessions::update` (`:2075`) | **yes** — the P0 in §0/§7 D1: it rewrites the draft the preview is rendering |
| `engine/kpi_derivation.rs:318` | `cli_text_with_usage` | `create_goal` (`:384`), `UPDATE dev_goals SET kpi_id` (`:397`) | **yes** — 16 live goals whose only provenance is a prose footer the reader strips |

On the stricter question *"is this a defect"* it is also 3/3. Two of the three are the two P0s in
§7.

**Two independent implementations AGREED on the population, DISAGREED on the count — and the
disagreement is the disclosed recall gap.** Implementation #2 is a structural counter that
brace-matches all **14,710** `fn` bodies in 963 files over two length-preserving blanked views,
and partitions bodies that invoke a model into *persists* vs *returns*. It reports **4 / 34**;
the census reports **3 / 35**. The extra one is
`commands/credentials/auto_cred_browser.rs:752 start_auto_cred_browser` — model call at `:877`,
`playwright_procedures::save` at `:1359`. Hand-verified: **it is a true positive the regex cannot
reach**, because the span is **23,835 characters** and contains a `\n}` inside a raw string
literal, which the pattern's `(?!\n\})` temper treats as a function boundary. So the gate's recall
on the same-body condition is **3 of 4 (75%)**, and *the positive control contains one false
positive*, which is stated in the control's own description rather than hidden.

> **And implementation #2 was wrong first, in the way the doctrine names.** Its first version
> blanked comments **and strings** before testing for a write, and reported the wrong partition —
> because in Rust *the SQL is a string literal*, so blanking strings deletes every `INSERT INTO`
> and `UPDATE … SET` in the tree. `derive_goal_from_kpi` landed in the compliant bucket. That is
> the same family as the CSP checker whose comment stripper ate every URL: **a stripper that eats
> the thing it was meant to preserve.** The fix is two blanked views of the same source, both
> length-preserving so the offsets still align.

**The population partitions, and the residual is named:**

| | matches | files |
| --- | ---: | ---: |
| **anchor** — a model invocation in `src-tauri` | **38** | 28 |
| ↳ **violating** — its output is persisted in the same call | **3** | 3 |
| ↳ **compliant** — its output is returned to a caller (the positive control) | **35** | 25 |

3 + 35 = 38, exactly. The control's 35 include the one known false positive above; the other 34
were spot-checked and are the shared helpers (`ai_artifact_flow.rs`), the job runners
(`n8n_transform/cli_runner.rs`, `recipes/crud.rs`), and the brain's oneshots — every one of which
hands its parsed artifact back for a caller to decide about.

**Existing rules checked for overlap first, by re-running each neighbour's committed pattern over
its own roots and intersecting the file sets — measured, not assumed.** All six reproduced their
committed baselines exactly, which is also the instrument's own check.

| neighbour rule | its files / matches | overlap with my 3 files | why it is a different condition |
|---|---:|---:|---|
| `handrolled-llm-envelope-scan` ([`model-composed-ui`](./model-composed-ui.md)) | 9 / 15 | **0 (0%)** | Nearest by subject. It keys on hand-rolled scanning of a model's *envelope*; this keys on where the parsed artifact *goes*. Disjoint file sets. |
| `model-reply-parser-without-a-reason` ([`structured-output-extraction`](./structured-output-extraction.md)) | 22 / 34 | **0 (0%)** | It owns the parse failing silently; this owns the parse *succeeding* and being written unreviewed. It does contain `auto_cred_browser.rs` — my known recall gap, at unrelated lines (`:1624,:1685`). |
| `unverified-effect-dispatch` ([`post-write-side-effects`](./post-write-side-effects.md)) | 60 / 162 | **0 (0%)** | The largest neighbour by file count and still disjoint: it owns a side effect whose success is unchecked; this owns a write nobody authorised. It shares `ai_artifact_flow.rs` and `recipes/crud.rs` with my *control*, never with the gate. |
| `autonomy-verdict-outside-the-front-door` ([`autonomy-gating`](./autonomy-gating.md)) | 4 / 5 | **0 (0%)** | It asks whether the autonomy decision went through the door; this asks whether a decision was offered at all. |
| `discarded-guard-verdict` ([`conditional-write`](./conditional-write.md)) | 7 / 11 | **0 (0%)** | A guarded write whose affected-row count is dropped. Complementary: it would own a `seenVersion` CAS once §4's type lands. |
| `unledgered-credential-provisioning` ([`automated-credential-provisioning`](./automated-credential-provisioning.md)) | 3 / 3 | **0 (0%)** | Shares the credentials tree by name only. |

**The largest match-level overlap is 0%, and the largest file-level overlap is 0 files of 3.**

**Disclosed recall gaps — four, all structural, and the third is the important one:**

1. **A span longer than 6,000 characters, or one containing `\n}` inside a raw string.** One known
   miss, named above.
2. **A model call in one function and the write in another.** `companion/tours.rs:356
   compose_tour` returns to `companion_compose_tour` (`commands/companion/tours.rs:24`), which
   persists. The gate scores a structural zero on every two-function split, and that is the most
   common Rust idiom in this tree.
3. **The gate cannot see the whole client half — 24 surfaces, including 17 that hand back the
   merged artifact and 12 that record no provenance.** §0's headline numbers are almost entirely
   invisible to it. This is stated so nobody reads a green census as coverage: **the count here
   could reach zero while every defect in §7 D3 is untouched.**
4. **It cannot see an absence, which is what P3 is about.** The census cannot assert *"this INSERT
   has no origin column"*, *"this summariser strips the only provenance"*, or *"this approval row
   has no actor"* — §0's sharpest finding, §7 D5, and D7 are all absences and all ungateable by
   counting. `goal_summary()` stripping 16 of 16 was findable only by **running it**.

**How it fails loudly if its own precondition is absent:** `floor: 800` against a live walk of 963
`.rs` files, so a moved root or a broken glob fails rather than reporting zero; a rule matching
zero files anywhere is a structural failure in the runner; a rise is fatal; a **drop** without
`--update` is fatal; and a stale `exclude` is fatal. **All seven were verified by deliberately
breaking the rule:**

```
baseline (3f/3m, control 25f/35m)      -> exit 0
floor 2000 > 963 walked                -> exit 1   (matcher/root broken, not codebase clean)
pattern matches zero files             -> exit 1
stale exclude entry                    -> exit 1
baseline too LOW (a rise)              -> exit 1
baseline too HIGH (a silent drop)      -> exit 1
baseline ON the positive control       -> exit 1   (validateRule rejects a control with a baseline)
control pattern matches zero files     -> exit 1
```

```json
{
  "rules": [
    {
      "id": "model-output-persisted-without-preview",
      "goldenPath": "docs/concepts/golden-paths/ai-draft-preview-apply.md",
      "title": "A model's output is written to durable storage inside the same call that produced it, so there is no preview seam for a human to refuse at",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\b(?:run_claude_prompt(?:_tracked|_text_inner)?|spawn_claude_and_collect|cli_text_with_usage|call_claude_text)\\s*\\((?:(?!\\n\\})[\\s\\S]){0,6000}?(?:\\b(?!llm_spend|audit_log|spend)[a-z_]+::(?:create|update|save|upsert)\\s*\\(|INSERT\\s+INTO\\s+(?!dev_llm_spend)[a-z_]+|UPDATE\\s+(?!dev_llm_spend)[a-z_]+\\s+SET)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "A call to one of this repo's nine model-invocation helpers, followed WITHIN THE SAME FUNCTION BODY by a durable write of a DOMAIN artifact (a repo-module create/update/save/upsert, or a rusqlite INSERT INTO / UPDATE .. SET), with the span tempered by (?!\\n\\}) so it cannot cross a top-level function boundary. PROXY FOR the stack-free condition: a model's output reaches durable storage inside the same call that produced it, so no preview seam exists at all - the user is shown a RESULT, never a PROPOSAL. The spend ledger (dev_llm_spend / llm_spend::record) and the audit log (audit_log::insert) are excluded by construction, because every legitimate model call site writes both and they are bookkeeping, not the artifact. MEASURED 2026-08-17 at 64b1aa5c3: 3 matches across 3 of 963 .rs files, EVERY ONE OPENED AND CONFIRMED (precision 3/3 on the stated condition, and 3/3 on the stricter 'is this a defect' question - two of the three are this golden path's two P0s). THE THREE: (1) commands/design/team_synthesis.rs:444 run_crew_synthesis - one Claude call at :444, then persona_repo::create at :581 and team_repo::create at :619, so a team AND N LIVE PERSONAS are created from one prompt with no gate; the panel that calls it (TeamSynthesisPanel.tsx:28) renders a result screen at :112-129 which is a RECEIPT, not a preview. (2) commands/design/template_adopt.rs:2014 adjust_adoption_draft - a 600-second Claude pass whose merged output is written back over build_sessions.agent_ir at :2075 WHILE THE ADOPTION PREVIEW IS ON SCREEN (ChronologyAdoptionView.tsx:1190-1220 fires it from a useEffect gated on phase 'draft_ready', whose own status label is 'Draft ready - test & promote'), after which promote_build_draft RE-READS that row (build_sessions.rs:2626). Nothing re-hydrates the client store (hydrateBuildSession has 3 call sites, none downstream of the adjustment) and NO ADOPTION SURFACE RENDERS system_prompt AT ALL - its only occurrence in the 1,900-line view is the placeholder 'You are a helpful AI assistant.' at :1062. The command returns AdoptionAdjustResult { adjusted, divergence, model, note }, which is referenced in exactly 1 of 4,829 frontend files (its own api wrapper, src/api/templates/templateAdopt.ts:90-113) and DISCARDED at the single call site. (3) engine/kpi_derivation.rs:318 derive_goal_from_kpi - an unattended loop that creates a dev_goals row at :384 and links it at :397; its ONLY provenance is a markdown italic footer appended to the description at :366, and MEASURED LIVE against a read-only copy of the operator's personas.db (347 MB, copied 2026-08-16 23:31 UTC with the app running, never opened for write, deleted after): 16 of 188 dev_goals were written this way, 16 of 16 carry the footer, and goal_summary() (db/src/repos/dev_tools.rs:1254-1261) STRIPS IT FROM 16 OF 16 on its way to the human-acceptance view - including BOTH rows sitting in that queue right now, which are 2 of 2 model-authored and 0 of 2 showing any sign of it. TWO INDEPENDENT IMPLEMENTATIONS AGREE ON THE POPULATION (38 model-invocation sites) AND DISAGREE ON THE COUNT, 3/35 vs 4/34, AND THE DISAGREEMENT IS THE RECALL GAP: implementation #2 brace-matches all 14,710 fn bodies in 963 files over TWO length-preserving blanked views of each source (comments+strings blanked for structure, comments ONLY for the write test) and finds a fourth true positive at commands/credentials/auto_cred_browser.rs:752 start_auto_cred_browser (model call :877, playwright_procedures::save :1359) that this pattern CANNOT REACH, because the span is 23,835 characters and contains a `\\n}` inside a raw string literal which the (?!\\n\\}) temper reads as a function boundary. Hand-verification resolved it in favour of #2, so recall on the same-body condition is 3 of 4 (75%) and the positive control carries one known false positive, stated there rather than hidden. IMPLEMENTATION #2 WAS ITSELF WRONG FIRST, in the way the doctrine names: its first version blanked comments AND strings before testing for a write, which in Rust deletes every INSERT INTO and UPDATE .. SET in the tree because THE SQL IS A STRING LITERAL - a stripper that eats the thing it was meant to preserve, same family as the CSP checker whose comment stripper ate every URL. ZERO MATCH-LEVEL OVERLAP and ZERO FILE-LEVEL OVERLAP with all six neighbours re-measured by re-running their committed patterns (not assumed): handrolled-llm-envelope-scan (model-composed-ui.md, 9 files / 15 matches - it owns hand-rolled scanning of the model's ENVELOPE, this owns where the parsed artifact GOES), model-reply-parser-without-a-reason (structured-output-extraction.md, 22/34 - it owns the parse failing silently, this owns the parse SUCCEEDING and being written unreviewed; it does contain auto_cred_browser.rs at unrelated lines :1624,:1685), unverified-effect-dispatch (post-write-side-effects.md, 60/162 - shares ai_artifact_flow.rs and recipes/crud.rs with my CONTROL, never with the gate), autonomy-verdict-outside-the-front-door (4/5), discarded-guard-verdict (7/11 - complementary: it would own the seenVersion CAS once this path's type lands), unledgered-credential-provisioning (3/3). FOUR DISCLOSED RECALL GAPS, all structural: (1) a span over 6,000 chars or one containing `\\n}` inside a raw string - the one known miss above; (2) A MODEL CALL IN ONE FUNCTION AND THE WRITE IN ANOTHER, which is the most common Rust idiom in this tree - companion/tours.rs:356 compose_tour returns to commands/companion/tours.rs:24 which persists, and scores a structural zero here; (3) THE GATE CANNOT SEE THE CLIENT HALF AT ALL - 24 React surfaces render a model draft and commit it, 17 of them hand the whole merged artifact back to the persist door and only 4 of the 24 write any provenance into the durable artifact, and none of that is visible here, so THE COUNT CAN REACH ZERO WHILE EVERY DEFECT IN THE GOLDEN PATH'S SECTION 7 D3 IS UNTOUCHED; (4) it cannot assert an ABSENCE, which is what this leaf's P3 is about - 'this INSERT has no origin column', 'this summariser strips the only provenance', 'this approval row has no actor' are the three sharpest findings in the document and all three are ungateable by counting, findable only by RUNNING the code. PROVENANCE CONTEXT measured whole-schema across both live databases: 78 personas (>=73 model-drafted, 63 via adoption_log, 12 via a build session) carry NOTHING - trust_origin is 'builtin' on 77 of 78; 351 persona_triggers, of which 44 were written at promote from an LLM-authored IR, carry nothing; 120 companion_approval rows have NO ACTOR COLUMN and 65 of the 106 resolved were resolved within 2 seconds of creation (median 0 s, human_review_id NULL on all 120) under a posture whose own test docstring says 'under autonomous mode every proposed action fires' (approval_autopilot.rs:783-786). The two stores that get it right get it right completely: dev_ideas.model is populated on 214 of 236, and workspace_knowledge.provenance holds {\"actor_kind\":\"agent\",\"model_ref\":...} on 1,304 of 1,306 rows with exactly 2 marked human. PRECONDITION (must be re-derived per repo): this repo routes every model call through one of nine named helper functions and every durable write through a repo module or a rusqlite .execute on a SQL string literal. A repo calling an SDK directly (`await anthropic.messages.create`) and persisting through an ORM (`prisma.x.create`), a Django view, or a serverless handler has the SAME condition wearing markup this pattern cannot see and scores a structural zero - measured in the sibling checkouts, where ascent persists its scan's Recommendation rows straight from the model with no preview gate at all (lib/scan-finalize.ts) and vibeman's context generation lets the model write contexts directly via MCP (api/context-generation/execute/route.ts:53-56). The condition to re-derive is 'IS THERE A POINT BETWEEN THE MODEL'S ANSWER AND THE ROW WHERE A HUMAN COULD HAVE SAID NO', not the token run_claude_prompt. LEGAL FIX, in order: (1) return the artifact instead of writing it, and give the caller a door to apply it - commands/companion/consolidate.rs:160-211 is the shape to copy, `companion_apply_consolidation_item(item_id, edits)` whose docstring reads 'UI sends only the fields the user changed; unset fields fall back to the original proposal', with the server re-reading the proposal at consolidation.rs:311, refusing a non-pending draft at :312, and flipping the draft status LAST at :390; (2) if the write must stay, write it at a NON-ACTIVE status so the gate is downstream - useAddKpi.ts:100 proposeKpiAuto creates a KPI at 'proposed' and is the one honest member of this family; (3) either way, stamp the artifact with a CLOSED origin enum plus a nullable model_ref computed SERVER-SIDE from the draft row, never a string the client supplies (GenerateHypothesesModal.tsx:114 sends `generatedBy: persona?.name ?? 'agent'`, which is a guess, because the client is the one party that has already merged the model's draft with the human's edits). Do NOT silence a match by hoisting the write into a helper function called from the same place (that hides it from the rule and from implementation #2 without changing what happens), or by moving the write behind a channel or a spawned task. END OF LIFE: this rule is designed to reach zero - all 3 are removable and the compliant form exists in this tree at 35 sites. When it does the runner fails structurally on zero-matches BY DESIGN: DELETE the rule then, do not baseline it at 0."
      },
      "exclude": [
        {
          "path": "**/tests/**",
          "reason": "integration-test fixtures legitimately drive a model helper and then seed rows to assert on; 8 files matched, so this exemption is live and a rename fails the gate"
        }
      ],
      "baseline": { "files": 3, "matches": 3 },
      "floor": 800
    },
    {
      "id": "model-output-persisted-without-preview-positive-control",
      "goldenPath": "docs/concepts/golden-paths/ai-draft-preview-apply.md",
      "title": "POSITIVE CONTROL - a model invocation whose output is RETURNED to a caller instead of persisted, so a preview seam exists",
      "roots": ["src-tauri"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\b(?:run_claude_prompt(?:_tracked|_text_inner)?|spawn_claude_and_collect|cli_text_with_usage|call_claude_text)\\s*\\((?!(?:(?!\\n\\})[\\s\\S]){0,6000}?(?:\\b(?!llm_spend|audit_log|spend)[a-z_]+::(?:create|update|save|upsert)\\s*\\(|INSERT\\s+INTO\\s+(?!dev_llm_spend)[a-z_]+|UPDATE\\s+(?!dev_llm_spend)[a-z_]+\\s+SET))",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "CONTROL, not a gate. The IDENTICAL model-invocation anchors as model-output-persisted-without-preview, with that rule's durable-write span moved into a NEGATIVE LOOKAHEAD, so it matches the COMPLIANT form: a model call whose parsed output is RETURNED to a caller, leaving a seam where a human can be shown a proposal before anything is committed. Exists to prove the gate discriminates on WHERE THE MODEL'S OUTPUT GOES rather than on the presence of a model call: measured 2026-08-17 at 64b1aa5c3 it matches 35 times across 25 files against the gate's 3 across 3, and THE TWO PARTITION THE ANCHOR EXACTLY - 3 violating + 35 compliant = 38, which is the total number of model-invocation sites in 963 .rs files, independently confirmed by a structural counter that brace-matches all 14,710 fn bodies. So 8% of this repo's model call sites write their own output and 92% hand it back. The 35 are the shared helpers (commands/credentials/ai_artifact_flow.rs:230,448,626,633,646,655 - the six-site spine every AI-artifact flow goes through, which by construction returns text and emits progress events and never writes an artifact), the job runners (design/n8n_transform/cli_runner.rs:491,581,664,676; recipes/crud.rs; commands/tools/automation_design.rs), the one-shot generators (infrastructure/scraper.rs:231 scraper_generate_rules, which returns a parsed JSON ruleset the client previews in LlmRuleBuilder.tsx and the user edits per-field before ScrapeEditorModal saves it; commands/teams/teams.rs:488 suggest_topology_llm, whose blueprint useAutoTeam.ts lets the user edit at :240,:257 before any write), and the brain's oneshots (companion/brain/{briefing,consolidation,recall_synthesis,reflection,sleep_cycle}.rs, companion/night_shift/{planner,unattended}.rs, companion/tours.rs). A MATCH HERE IS NOT A CERTIFICATE, AND ONE OF THE 35 IS A KNOWN FALSE POSITIVE, stated rather than hidden: commands/credentials/auto_cred_browser.rs:877 IS a violating site - its model call at :877 is followed by playwright_procedures::save at :1359 - and it lands here because the span is 23,835 characters and contains a `\\n}` inside a raw string literal that the shared temper reads as a function boundary. A structural counter over brace-matched fn bodies puts it in the violating set; hand-verification agrees with the counter. Two further caveats on what a match means: (a) RETURNING IS NOT PREVIEWING - companion/tours.rs:362 returns to commands/companion/tours.rs:24, which persists, so a two-function split reads as compliant here while having the condition; (b) the seam existing does not mean the seam is USED - commands/design/template_adopt.rs:1634 (run_template_generate_job) is compliant and its consumer, useCreateTemplateActions.ts:89, saves `state.designResultJson || JSON.stringify({...state.draft...})` so on the snapshot-recovery path the user's edits to the preview are silently discarded. Carries NO baseline BY CONSTRUCTION: a ratchet is monotone-downward and a rule counting compliant code would fail the build every time adoption improved (scripts/census/lib/engine.mjs exempts a -positive-control id from the baseline requirement; merge-published-rules.mjs skips it; verified by deliberately adding one, which exits 1). THE TWO COUNTS MUST MOVE IN OPPOSITE DIRECTIONS: if model-output-persisted-without-preview falls while this stays flat, a model call was DELETED rather than given a preview seam, and the ratchet would otherwise have recorded that as progress. If this control's count ever collapses toward the gate's, the shared anchors have broken and BOTH numbers are meaningless - that is the failure this control exists to make visible."
      },
      "exclude": [],
      "floor": 800
    }
  ]
}
```

Validated standalone via `node scripts/census/run-census.mjs --rules <a composer-private scratch
registry, filename unique to this composer because siblings share the scratchpad>`, never against
the shared `rules.json`, and **the full registry was not run** (doctrine §4). The runner reports
**3 matches / 3 files** for the gate and **35 / 25** for the control over **963** `.rs` files
walked against a floor of **800**, in **1.8 s**, and `--check` exits **0** at the declared
baseline. Exclude hit count: 8 — no stale exemption. **Re-extracted from this finished document
and re-run, with identical counts.**

### The type, alongside the ratchet

The gate counts a **shape in one language**. Four things it cannot reach, in descending
importance:

- **The provenance column is not a type at all.** Whether the applied row can say a model wrote it
  is a schema fact, and no signal in either language sees it. **This is the fix that matters** and
  §2 leads with it: 78 personas, 351 triggers and 210 tools on this install are permanently
  unattributable, and the two tables that added one column are at 100% coverage over 1,540 rows.
- **The client type IS available and closes the largest family** — `applyX(ref: DraftRef, edits?)`
  in §4, which makes `apply(wholeArtifact)` fail to compile at 17 call sites and lets `origin` be
  a fact the server computes rather than a string the client guesses. Propose the type as the fix;
  this rule is the ratchet that holds the server side until it lands.
- **Fix the reader before ratcheting the writers** (contract: *a gate on reaching a destination is
  only as good as the destination's defaults*). `goal_summary()` strips the only provenance
  `dev_goals` has, on the exact surface where a human accepts the artifact, 16 of 16. Adding
  provenance elsewhere while that stands routes people to a field a summariser deletes.
- **A second, different instrument is owed for P6.** *"Does anything notice the draft went stale
  between preview and apply"* is an absence over a pair of call sites, which the census cannot
  express. The right shape is a test, not a count: seed a draft, render the preview, mutate the
  draft row, apply, and assert the apply refuses. No such test exists anywhere in this repo, and
  one sibling's `documents.rs:761-766` is the only implementation of the behaviour in six
  codebases.

## 12. Corrections to the brief

Recorded per [doctrine §7](../golden-path-doctrine.md#7-corrections-are-the-deliverable), because a
brief is a hypothesis and refuting it is part of the job.

### 12.1 — `sides: "client"` is wrong, and the spine contradicts it in the same node

The leaf carries `twoSided: true`. The measurement is decisive in both directions: **the census
rule that survived is server-side** (3 matches, all in `src-tauri`), **the exemplar apply door is
server-side** (`companion_apply_consolidation_item`), **the best transaction in the fleet is
server-side** (`promote_build_draft_inner`), and the largest defect population — 17 hand-back
surfaces, 20 with no provenance — is client-side. A client-only sweep would have found the
population and missed every answer. **Recommend flipping `sides` to `both`.** I swept both halves.

**This is the fourth leaf to report `sides: "client"` contradicted by its own measurement**
([`selective-per-item-verdicts`](./selective-per-item-verdicts.md) §12.1,
[`audit-trail-view`](./audit-trail-view.md) §12.1, and one earlier). At four for four, the field is
not a weak signal — it is **anti-correlated with where the answer lives**, and the pattern is
consistent: `client` is assigned from where the *situation is noticed*, and the fix is where the
*artifact is written*. Recommend the orchestrator stop treating `sides` as scoping guidance at all.

### 12.2 — `convergence: mixed` HELD, and it is the first spine convergence label this corpus has confirmed

Doctrine §5 records eleven `converged` labels tested and eleven failed. This one is `mixed`, and
measured against the effective cohort of 3 it is exactly right, for a reason the label could not
have encoded: **two clauses are physics at 3 of 3 (provenance on the artifact; withhold the
artifact and apply by id) and one is a silence at 1 of 6 (noticing the draft went stale).** The
leaf genuinely mixes an adopted practice Personas is behind on with a frontier nobody has reached.

Report this as loudly as a failure, per doctrine. It also carries a caveat that makes it weaker
than it looks: **the cohort is 3, not 5** — `personas-web` has no LLM call in `src` at all and
`personas-cloud` has no drafted artifact, so both score a structural zero on every clause — and
one of the three, `brainiac`, shares this repo's operator and states its doctrine nearly verbatim
without sharing any code. That is a shared author, not a port: weaker than independent
reinvention, stronger than nothing. The 3-of-3 results survive at 2-of-2 independent if you
discount it.

### 12.3 — "`apply_persona_memory_review_proposal` is all-or-nothing, flips status before the loop, and a crash halfway is unrecoverable. Ask whether other apply paths share that shape." — asked, and the answer is NO, emphatically

I checked every apply door this leaf owns. **`promote_build_draft_inner` is the exact inverse**:
one `conn.transaction()` covering tools → triggers → subscriptions → assertions → persona →
version snapshot, with the build session's own status flipped **inside** it and last
(`build_sessions.rs:2869-2921`), under two comment banners naming the boundary.
`companion_apply_consolidation_item` writes the fact and flips the item's status after
(`consolidation.rs:390`). `dev_tools_apply_triage_verdicts` writes the ideas first and the
approval last. **The memory-proposal door is not representative — it is the outlier**, and the
correct pattern for it already exists in this repo, in a file that predates it.

The brief's implicit model (one bad apply shape spreading) is wrong here. The thing that *has*
spread is the opposite: **six of six apply paths I read are transactional or ordered correctly,
and zero of them record who authored what they applied.** The repo is disciplined about atomicity
and blind about attribution — and one of those is a solved problem with a canonical answer in-tree
while the other has no primitive at all.

### 12.4 — "168 of 194 review decisions were machine-made and every surface renders them as a human's. Check for it here." — found, in a second store, with a second mechanism

`companion_approval`: 120 rows, **no actor column of any kind**, `human_review_id` NULL on all
120, and **65 of the 106 resolved rows were resolved within 2 seconds** of creation (median 0 s).
The neighbouring leaf's defect was an *inference* — a reader regexing a free-text notes field. This
one is more basic: **there is no field to infer from.** The `auto-triaged` / `auto_triage` spelling
mismatch that neighbour found is a bug in a workaround; here the workaround was never built.

Two stores, two teams of one, same omission, different failure mode. That is stronger evidence
than either finding alone that **the actor is the field everyone forgets**, and it is why P5 is
stated as physics rather than as ergonomics.

### 12.5 — "the corpus's rule for this family: withholding beats requiring. Look for apply paths that hand the caller a freedom they should not have." — confirmed at 17 of 24, with a Q6 correction the brief did not anticipate

The freedom is *sending the artifact*, and 17 surfaces have it. **But withholding it entirely is
also wrong here, and four surfaces prove it**: `promoteBuildDraft(sessionId, personaId, excluded)`,
`decidePolicyProposalRow(id, 'apply')`, `labAcceptDraft(runId)` and
`applyPersonaMemoryReviewProposal(id)` withhold the artifact *and the human's edits with it*. The
correct split is Q6 exactly — **withhold the artifact, keep the delta** — and this repo has already
built it three times (`companionApplyConsolidationItem(item.id, edits)`,
`applyTriageVerdicts(approvalId, overrides)`, `acceptAutomationSuggestion(s.id, created.id)`).

So the prescription is not "withhold more". It is **withhold the artifact and *add* the delta**,
and the reason is not ergonomics — it is that a delta is the only channel through which the server
can learn which fields a human changed, which is the only way an `origin` stamp can ever be
honest. The brief framed withholding as a safety property; measured, it is an **attribution**
property, and that reframing is what makes P2 and P3 one clause instead of two.

### 12.6 — "is the draft re-generated on apply? re-fetched? mutated in between?" — all three occur, and *mutated in between* is the one that hurts

The brief offered three failure modes as alternatives. Measured, they are not equally dangerous
and the cohort explains why:

- **Re-generated on apply** happens in two sibling repos and is *safe in both*, because their
  regeneration is deterministic and explicitly model-free (`ascent/src/lib/practice-artifact.ts:6`:
  *"Deterministic and pure (no LLM, no I/O)… it never invents architecture it can't know"*).
- **Re-fetched on apply** is the shape 4 surfaces here use and is fine when the row is immutable
  between the two reads.
- **Mutated in between** is the one that produces §0, and it is the *combination* of the other two:
  the apply re-fetches (safe) a row that a model rewrote (unsafe).

**The discriminator is not which of the three, it is whether a model runs between the render and
the write.** That question would not have been asked from the brief's framing, and it is what P1
and §2(c) are written around.

### 12.7 — a correction to my own instrument, offered because the doctrine asks for it

My structural counter's first version blanked comments **and string literals** before testing for a
durable write. In Rust the SQL *is* a string literal, so that deleted every `INSERT INTO` and
`UPDATE … SET` in 963 files and moved `derive_goal_from_kpi` — a true positive — into the compliant
bucket. It reported a confident 3/35 that happened to match the census by coincidence, for the
wrong reason. The fix is two blanked views of the same source, both length-preserving so offsets
still align: strings blanked for brace-matching and model-call detection, strings **preserved** for
write detection.

Two lessons, both already in the doctrine and both re-earned: **a stripper that eats the thing it
was meant to preserve** (the CSP checker's comment stripper ate every URL; this one ate every SQL
statement), and **agreement between two implementations is not soundness** — mine agreed with the
census on 3/35 while being wrong about which three, and only disagreed *after* it was fixed. The
disagreement was the useful signal; the agreement was the bug.

### 12.8 — a correction offered upward to a neighbouring path

[`audit-trail-view`](./audit-trail-view.md) §0 frames its finding as a **read** defect: a view
inferring an audit fact from a field that is not the one recording it. Measured from this side it
is upstream of that. `persona_manual_reviews` has no `resolved_by` **because no apply path in this
repo has ever stamped an actor** — and `companion_approval`, written by a different subsystem years
apart, has the same hole. The reader is not a second unversioned writer by choice; it is a reader
with nothing to read. Its P1 (*a view may only render what the record contains*) is correct and
strictly weaker than the clause it needs: **an apply must write the actor, or every view over it is
guessing by construction.** Offered as a strengthening of that path's §8, not a contradiction of it.
