# Golden path — Dry-run preview

> Situation node: `product-surfaces` › `authoring-and-catalogs` › `dry-run-preview` ·
> [situation spine](../situation-spine.md) · recurrence 6 · risk **HIGH** ·
> sides: **client** (the spine also carries `twoSided: true` — both labels are wrong, see §12.1) ·
> convergence: **mixed** · dimensions: **ui · function · resilience**
> Composed 2026-08-17 against `master` @ `2a874e692`.
>
> **Sweep size.** All **1,111** `.rs` files under `src-tauri/` (**564** under `src-tauri/src`, the
> command tree and the census root) and all **4,829** `.ts`/`.tsx` under `src/`. Every one of the
> **1,585** registered command names in `src/lib/commandNames.generated.ts` classified by verb;
> every `#[tauri::command]` in the tree matched to its declared return type by **two independent
> scanners entering the declaration from opposite ends**. Every `dry_run` / `apply_changes` /
> preview-flag parameter in the tree enumerated (**12**) and every `preview_*` / `*_preview` /
> `dry_run_*` / `simulate_*` / `validate_*` command enumerated (**19**). Every confirmation string
> in `src/` that interpolates a quantity found by regex over all 4,829 files (**69** sites).
> `storage.rs`, `context_consolidate.rs` (1,300 lines), `skill_files.rs`, `bundle.rs`,
> `data_portability.rs` `export_*`, `director_memory.rs`, `platforms/github.rs`,
> `executions.rs:520-900`, `MemoriesPageDense.tsx`, `StorageUsageSection.tsx`,
> `SkillInstallModal.tsx`, `ContextMapHealth.tsx`, `PersonaOverviewActions.tsx` read in full.
>
> **Measured by execution, not by reading.** Read-only **copies** of the operator's live
> `personas.db` (347 MB) and `personas_data.db` (17.5 MB) were taken 2026-08-17 01:32 UTC with the
> app running (`engine-leader.lock` live); the live files were never opened for write. Every
> preview predicate and every action predicate below was replayed against the copy. The two largest
> findings were then **executed twice**: once by counting children through `IN (<the victim
> subquery>)`, and once by actually running the `DELETE` on a *throwaway copy of the copy* with
> `PRAGMA foreign_keys = ON` (`db/src/lib.rs:201`) and diffing every table before and after. The
> two agreed exactly, per table. **No action was run against any live file, and no live command was
> invoked.** All copies were deleted afterwards.
>
> **`cargo` was not run.** Every Rust claim is static or replayed in SQL.
>
> Convergence oracle run against **`personas-web`, `brainiac`, `personas-cloud`, `vibeman`,
> `ascent`** — all five present, all five opened. It produced this document's strongest external
> result (§6 clause 1), independently reproduced this leaf's hypothesis in a sibling (§6 clause 3),
> **inverted the brief's `convergence: mixed` on one axis** (§6 clause 6), and returned **two full
> silences**. Lineage checked: **no textual overlap** — none of `dry_run.rs`'s identifiers,
> comments or the `UnattendedMode` vocabulary appears in any sibling, so nothing here is a port
> agreeing with its original.
>
> **Settles:** whether the number a preview shows and the effect the action has are computed by the
> same thing — and what is true of the ones that are.

---

## 0. The headline

**The brief asked whether the preview and the action share a code path. The best-engineered preview
in this repo shares the *literal SQL string* with its action — one `where_clause` variable, used by
the `SELECT COUNT(*)` and by the `DELETE` — and it is still wrong by 3.29×, because a foreign key
does work that no predicate can see.**

`src-tauri/src/commands/infrastructure/system/storage.rs:109-127`:

```rust
let where_clause = format!(
    "status IN ({TERMINAL_STATES}) AND completed_at IS NOT NULL AND completed_at < ?1"
);
let pruned_executions: u64 = conn.query_row(
    &format!("SELECT COUNT(*) FROM persona_executions WHERE {where_clause}"), …)?;
if !dry_run && pruned_executions > 0 {
    conn.execute(&format!("DELETE FROM persona_executions WHERE {where_clause}"), …)?;
}
```

That is the shape everyone reaches for and it is genuinely good: **one predicate, two statements,
no second implementation to drift.** Replayed:

| | rows | table |
|---|---:|---|
| what `Settings → Storage` renders as **Removable** and puts in the confirm sentence | **2,188** | `persona_executions` |
| what the `DELETE` removes from `persona_executions` | **2,188** ✓ | — |
| `ON DELETE CASCADE` — `persona_tool_usage` | **4,740** | never named |
| `ON DELETE CASCADE` — `persona_manual_reviews` | **194** | never named |
| `ON DELETE CASCADE` — `assertion_results` | **56** | never named |
| `ON DELETE CASCADE` — `policy_events` | **25** | never named |
| FTS shadow tables rewritten by three triggers | **2,188** + 2,188 | never named |
| `ON DELETE SET NULL` — `team_assignment_steps` blanked | **944** | never named |
| **total rows destroyed** | **7,203** | **3.29×** the number in the sentence |

`en.json` → `settings.portability.storage_confirm` = *"Remove {count} finished runs older than 24
hours?"* On this install `{count}` is **2,188 — every execution in the database** — and answering
yes also erases the entire manual-review history the Overview renders.

### Then the same mechanism, one surface over, at 207×

`PersonaOverviewActions.tsx:113-114` — *"Delete {count} agents"* / the body with the same `{count}`.
Replayed by running the delete on a throwaway copy with FK enforcement on:

```
DELETE FROM personas WHERE trust_origin != 'system'   → changes(): 77
```

| table | rows destroyed |
|---|---:|
| `personas` | 77 ← **the only number the dialog says** |
| `persona_memories` | **6,535** |
| `persona_tool_usage` | 5,720 |
| `persona_executions` | 2,188 |
| `persona_triggers` | 351 |
| `persona_tools` 210 · `persona_healing_issues` 205 · `persona_manual_reviews` 194 · `persona_event_subscriptions` 102 · `assertion_results` 106 · `persona_team_connections` 70 · `persona_team_members` 63 · `lab_arena_results` 58 · `prompt_versions` 25 · `policy_events` 25 · `build_sessions` 12 · `output_assertions` 11 · `lab_arena_runs` 4 · `memory_claims` 2 | 1,087 |
| **rows in tables the confirmation never names** | **15,881** |

**"Delete 77 agents" destroys 15,958 rows across 20 tables.** The confirmation is arithmetically
correct about the noun it names and wrong by **207×** about what happens.

### And the number is not the only thing a preview can get wrong

| surface | the pixel says | the action does | |
|---|---|---|---|
| Settings → Storage → *Remove {n} finished runs* | **2,188** | 7,203 rows in 5 tables + 944 nulled | **3.29×** |
| Agents → *Delete {n} agents* | **77** | 15,958 rows in 20 tables | **207×** |
| Memories → *deletes all {n} memories* | **100** | 6,535 | **65×** — [`aggregate-count-display` §0](./aggregate-count-display.md), cited not restated |
| Fleet → Skills → *{changed} changed · {added} added · **{removed} removed*** | 16 files "removed" across 8 skills | **0 — `copy_dir_recursive` cannot delete** | a claim the action is structurally incapable of |
| Settings → *Export Credentials* → **"Exported!"** | `Ok(true)` | **0 of 25** credentials written to the file | — |
| Overview → Reviews → *deletes all {n} reviews* | **194** | 194 ✓ | correct |
| Dev Tools → *rewrites references in {n} contexts* | `plan.contextsTouched` | exactly that plan ✓ | **the one to copy** |

`export_credentials` (`data_portability.rs:9556-9600`) skips any credential whose `service_type`
matches a built-in connector. Replayed: **all 134 `connector_definitions` rows are
`is_builtin = 1`**, and **all 25 `persona_credentials` rows** have a `service_type` in that set —
`github`, `notion`, `sentry`, `supabase`, `gmail`, `linear`, … So the loop appends **zero** entries,
encrypts an empty array, writes the file, and returns `Ok(true)`.
`useDataPortability.ts:232-233` does `setCredExportStatus(saved ? 'success' : 'idle')` and
`CredentialPortability.tsx:92` renders **"Exported!"**.

### The denominator

| | count |
|---|---:|
| registered Tauri commands | **1,585** |
| …destructively named (`delete_*`, `prune_*`, `purge_*`, `clear_*`, `revoke_*`, `sweep_*`, …) | **69** |
| …applying (`apply_*`, `import_*`, `migrate_*`, `consolidate_*`, `bulk_*`, `restore_*`, …) | **35** |
| **mutating doors, total** | **104** |
| preview-shaped doors (`preview_*`, `*_preview`, `dry_run_*`, `simulate_*`, `validate_*`) | **19** (18%) |
| …that pair with an apply sibling under a matching name | **5** |
| Rust functions taking a `dry_run` / `apply_changes` flag at all | **12** |
| …whose default is the **safe** one | **2** (`prune_storage`, `repair_cross_refs`) |
| previews that carry a **token binding them to the state they were computed from** | **1** (`apply_bundle_import`) |
| set-scoped mutations whose return type **cannot carry a quantity** | **5** — all exports (§9) |
| …that can | **21** (§9) |
| destructive confirmations in `src/` that interpolate a quantity | **69** across 43 files |
| …of those, ones that name a **cascade or knock-on effect** | **0** |

**Zero.** Not one confirmation string in 19,000+ `en.json` leaves says what else goes. A sibling
repo with no dry-run machinery at all writes that sentence into its shared confirm primitive and
tests it by name (§6 clause 5).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md) the head carries no file path,
primitive name or count. Each clause names its warrant.

> **P1 — physics, and the leaf's centre.** **A preview that is computed by different code than the
> action is a second implementation of the action, and the rule about two implementations applies:
> agreement is not soundness, disagreement is only the failure you happen to notice.** The preview
> must not *model* the effect; it must be the effect, computed and then stopped.
> *Warrant: reproduced independently in a sibling repo where the preview and the apply are two
> functions over the same rules, their counted populations provably differ (the apply counts only
> writes that succeeded, the preview counts matches), and the number on screen comes from the one
> that is not the action.*
>
> **P2 — physics, and the sharpest clause here.** **Sharing the predicate is not sharing the
> effect.** The predicate selects rows; the effect includes everything the storage layer does
> *below* it — cascading deletes, nulled references, index and full-text shadows, files, external
> calls. A preview built from the predicate is exact about the noun it names and silent about the
> blast radius, and the silence grows with the schema, not with the code.
> *Warrant: executed twice by independent methods — 3.29× on a preview that shares its SQL string
> verbatim with its action, and 207× on a delete confirmation whose count is correct.*
>
> **P3 — physics.** **A preview and its apply are two moments. Without something binding them, the
> apply acts on a state the preview never saw.** The plan must travel with a token — a hash, a
> snapshot id, a version — and the apply must refuse when it does not match. Recomputing "the same
> way" is not the same as computing over the same thing.
> *Warrant: 0 of 5 sibling repos has any such token, and the two that have real preview→apply pairs
> both discard the previewed plan and re-derive it; one does so explicitly on the line above the
> apply call. This repo has exactly one, and it is opt-in.*
>
> **P4 — physics.** **The default of the flag is the safety property; the flag is decoration.** A
> door that previews unless told otherwise is safe for every caller that has not thought about it,
> which is all of them eventually. A door that acts unless told otherwise has a preview mode that
> only the author will ever use.
> *Warrant: measured here as three doors with three different defaults — preview, required, and
> act — in one codebase; and in the sibling with the most dry-run machinery, 1 of 8 flags defaults
> safe.*
>
> **P5 — ergonomics, and the one a count cannot satisfy.** **When the operation changes values
> rather than merely removing rows, preview the resulting values.** A count answers "how many"; the
> question a repair, a backfill, a normalisation or a rename raises is "what will they *become*",
> and a count is definitionally unable to reach it.
> *Warrant: a live backfill in this repo whose naive repair would silently collapse two legal
> statuses into a third — a preview that counted the affected rows would have shown the same number
> for the correct repair and the destructive one. And the one sibling preview that shows raw
> statements rather than a total is the one its own audit asked to be put in front of the button.*
>
> **P6 — ergonomics.** **An operation whose scope the caller did not enumerate must report its
> scale.** A boolean is a report that cannot be wrong and therefore cannot be right; a bare success
> is indistinguishable from a no-op. Before is a preview and after is a receipt; they are the same
> obligation at two times, and a door that cannot answer afterwards was never able to answer
> before.
> *Warrant: executed as a successful export of 0 of 25 credentials reporting `true`, and named
> independently in a sibling as "success theater" with the instruction to report the server's
> authoritative changed-count rather than the selection size.*
>
> **P7 — resilience.** **A preview that could not be computed must block the action, not decorate
> it.** An absent preview is not an empty preview.
> *Warrant: 5 of 5 sibling repos, plus this one, will proceed with the destructive action after the
> preview fails; the single counterexample in the cohort is a shell precondition, not a preview
> gate. Perfect agreement on an omission — see the doctrine's warning about converging on the
> disease.*
>
> **Scale condition.** P1, P4, P6 and P7 are correctness on day one at any size. P2 grows with the
> schema — it is invisible while the table has no children and unbounded once it does. P3 bites the
> first time two people (or a background tick and a person) act at once. P5 bites the first time the
> column being repaired has more than two legal values.

---

## 1. Trigger

- "Show them what it'll do before it does it." / "add a confirmation with the count"
- "Give it a `--dry-run`." / "let them preview the migration first"
- "This will delete N items — are you sure?"
- "Preview the import before applying it." / "diff the install against what's there"
- "Estimate the cost before we run it."
- "It said it worked but nothing happened."

**If you are about to write** a second function whose job is to *describe* what a first function
does — a `preview_x` beside an `x`, a `SELECT COUNT(*)` beside a `DELETE`, a client-side filter
that predicts which items the server will accept — **you are in this situation.** Likewise if you
are about to add a `dry_run: bool` parameter, or interpolate a number into a confirmation sentence,
or return `Ok(true)` from something that wrote to more than one row.

### Boundaries with the adjacent leaves

The seam test: **is the question what the number IS, whether the user AGREED, or whether the
description MATCHES the deed?** Only the third is this path.

| Territory | Owner | Do not restate |
|---|---|---|
| Where a displayed count comes from; page-vs-source; `?? 0`; `N of M` | [`aggregate-count-display`](./aggregate-count-display.md) | It owns **the number**. This path owns **the number's relationship to the deed**. Its §0 (100 vs 6,535) is the canonical instance of both and is cited here, not re-derived — what is new is that the same 6,535 memories also die inside "Delete 77 agents", and *that* dialog's count is not wrong at all. |
| Whether a destructive action is gated, the modal, the typed-name ceremony, irreversibility copy | [`informed-consent-gate`](./informed-consent-gate.md) | It owns **the gate**. Every dialog in §0 passes it. This path owns whether the sentence inside the gate is true. Its census rule `unconsented-irreversible-door` is `src/features/**/*.tsx`; mine is `src-tauri/src/**/*.rs` — **0% file overlap by construction**. |
| What a plural command does that its singular sibling doesn't; per-item outcomes; partial success | [`bulk-command-variant`](./bulk-command-variant.md) | It owns **the shape of the answer after the fact** for a caller-supplied id list. I would have counted `-> u32` as compliant; **its §0 shows that same `u32` is the defect at its leaf** — see the composition note in §6. Different question, adjacent answer. |
| Whether the rows on disk are right; backfill guards; `DEFAULT` outliving its backfill | [`data-normalization-migration`](./data-normalization-migration.md) | It owns **the migration**. It measured the 26 contradicting `persona_triggers` rows; this path owns **why a count-shaped preview of the repair would not have been enough** (§7 D6) — and corrects the brief's claim about what would have been flattened. |
| What deletes actually mean — soft vs hard, tombstones, orphan sweeps | [`delete-semantics`](./delete-semantics.md) | It owns the **semantics** of removal. This path owns the **description** shown beforehand. |
| Whether retention deletes anything, allow-lists, count caps | [`retention-and-pruning`](./retention-and-pruning.md) | It owns the sweeps and measured that they delete **zero** rows today. This path owns the fact that **none of them has ever shown a preview and none reports what it did** (§7 D7). |
| Whether a client-side rule agrees with the server rule it mirrors | [`client-rule-mirroring`](./client-rule-mirroring.md) | Every confirmation count computed by a client-side filter over a server rule is one of its mirrors. §7 D5 hands it a live pair and a cleared one. |
| A draft **authored by a model**, shown, then applied; what a partial apply leaves; where the draft lives | [`ai-draft-preview-apply`](./ai-draft-preview-apply.md) | The nearest neighbour, composed in the same batch. The seam: it owns previews of an **artifact a model wrote** — is the thing written the thing that was shown. This path owns previews of an **effect a predicate will cause** — is the number shown the number touched. Its subject can be diffed against what applies; §0's cascades cannot, because there is no artifact, only a consequence. |
| The bytes on the wire between preview and apply | [`bridge-type-contract`](./bridge-type-contract.md) · [`idempotent-invocation`](./idempotent-invocation.md) | The second is the closest cousin: a preview token is an idempotency key pointed backwards in time. |

---

## 2. The one way

**Compute the plan once, inside the function that will execute it, hand the caller a token for that
exact plan, and let the flag guard only the write.** Concretely: (a) **one function, one flag** —
`fn do_the_thing(…, apply: bool)` that builds the complete plan and then does
`if !apply { return Ok(plan) }` immediately before the write, so the plan the caller saw is the
object the caller will apply; never a `preview_x` sitting beside an `x`, because that is two
implementations of one effect and they will diverge on the parameters before they diverge on the
logic. (b) **Default the flag to preview** — `dry_run: Option<bool>` → `unwrap_or(true)`, or a
required `bool` so nobody can forget to choose; a flag defaulting to *act* is a preview mode with
one user. (c) **Compute the blast radius, not the predicate's row count** — walk the declared
foreign keys of every table you touch and report the cascade totals beside the headline; if you
cannot enumerate them, say the number is a lower bound. (d) **Return the plan as data, not prose**
— typed per-effect counts plus, where values change, the resulting values themselves. (e) **Stamp
the plan** with a hash or snapshot id of the inputs it was computed from, require it on the apply,
and **fail the apply when it does not match** — this repo has exactly one implementation of that
handshake and it is the model. (f) **Report the scale afterwards too** — the same numbers, measured
rather than projected; never `bool`, never `()`. (g) **Refuse to act when the preview failed** —
`null` is not "nothing will happen". (h) **Never let the client predict what the server will
refuse**; ask the server for the plan and render it. Then stop: do not add a second command, do not
recompute the plan in the apply, and do not report a count for an operation that changes values.

If you must get one right first: **(a)**. (b) is the cheapest and (e) is the one nobody in the
fleet has — but every other defect in §7 is downstream of the preview being a second program.

---

## 3. Mandated primitives

Every one of these exists today. The adopter counts are the finding.

| Primitive | What it gives you | Adopters |
|---|---|---|
| **`src-tauri/src/commands/infrastructure/context_consolidate.rs:811` — `repair_cross_refs(pool, project_id, apply_changes: bool)`** | **The reference shape.** One function. Builds `writes: Vec<(String, String)>`, a complete plan; `dry_run: !apply_changes` is a *field of the returned plan*, not a mode; the write pass applies exactly `writes`. `contexts_written` is documented as *"Zero on a dry run, by construction"* and `dangling_after` is documented as *"Equals `unresolved`"* — the plan states its own postcondition. Its doc comment says **why** dry-run is the default, which is the part to copy: *"`dev_contexts` has no version column, no soft-delete and no `absorbed_from`, consolidation hard-deletes … so a bad repair cannot be rolled back from inside the app."* | 1 command, 1 UI |
| **`context_consolidate.rs:362` — `consolidate_contexts(pool, project_id, dry_run: bool)`** | Same shape at a bigger scale: `ops: Vec<MergeOp>` built once, `if dry_run { return Ok(summary) }` at `:508`, then `apply(pool, project_id, &ops)`. **And it computes a knock-on effect before acting** — `project_cross_ref_effect(&ctxs, &ops)` with the comment *"Say what the merge would do to the reference layer BEFORE it applies — this is the number that went unreported for two days."* That is P2, written down, by this repo, from an incident. | 1 |
| **`src-tauri/src/commands/network/bundle.rs:61-110` — `apply_bundle_import`** | **The only preview→apply handshake in this repo or any of the five siblings.** `options.preview_id` retrieves the exact bytes the preview read (`take_cached_preview_bytes`); `expected_bundle_hash` is **mandatory once a preview happened**; a mismatch is a hard `AppError::Validation` — *"the file has changed since it was previewed. Please re-preview the bundle before importing."* Read §8 Gap 3 before copying: both fields are `Option`, so the whole guard is opt-in. | 1 pair (+ its clipboard twin) |
| **`src-tauri/src/engine/platforms/github.rs:545-630` — `create_patch_release(…, dry_run: bool)`** | **The preview and the action return the same struct.** `PatchReleaseOutcome { created, previous_tag, new_tag, commits_since, release_url, dry_run, reason }` — so the dry run names the **resulting value** (`new_tag: Some("v1.2.4")`) and not a count, which is P5. `dry_run` is a **required** `bool`: the caller cannot forget to decide. | 1 |
| **`src-tauri/src/commands/infrastructure/system/storage.rs:99-132` — `prune_storage`** | **Dry-run by default** (`dry_run.unwrap_or(true)`), a 24 h floor that a caller cannot argue below (`.max(MIN_PRUNE_AGE_HOURS)`), and a deliberate allow-list with the reason on the line: *"Deliberately an allow-list (never `NOT IN ('running', …)`) so an unknown/active state is never deleted."* One `where_clause` string feeds both statements. **Copy all of that. Then read §0 and §7 D1 for what it still misses.** | 1 UI, which passes `false` |
| **`src/features/plugins/dev-tools/sub_context/ContextMapHealth.tsx:275-282`** | **The client half done right.** The confirmation body is `tx(t.ctx_repair_confirm_body, { contexts: plan.contextsTouched })` — a number produced by the dry run **of the function that is about to be applied**, held in state, never recomputed locally. And the copy states the irreversibility *and its cause*: *"Contexts are not versioned, so it cannot be undone from inside Personas."* | 1 |
| **`src/features/schedules/libs/useCronPreview.ts:12-22`** | **A comment that is doctrine.** The former seedless preview hook was **deleted rather than repaired**: *"`useCronPreview` called `preview_cron_schedule` WITHOUT a seed, so it modelled a fire minute the engine … would never actually use. … Keeping a seedless preview hook around only invited a future consumer to render a lie, so it's gone rather than 'aligned'."* Copy the reasoning. See §7 D4 for the call site that survived it. | — |
| **`src-tauri/src/commands/tools/triggers.rs:826-836` — `preview_cron_schedule`'s doc comment** | The rare case of a preview door that **documents its own divergence**: *"When omitted, `H` tokens collapse to the range minimum — fine for syntax-only previews but misleading for 'where will this trigger actually fire'; pass the trigger id from the editor so the preview matches runtime."* | 2 callers, 1 compliant |
| **`db/src/repos/core/memories.rs:1046-1058` — `delete_all`** | Not a preview, but the **scope statement** a preview must read: the doc comment explains the `tier != 'core'` carve-out and what would happen without it. A confirmation dialog for a destructive door should quote this, not the list it is standing next to. | — |

**Explicitly NOT primitives:**

- **`skill_files_install_preview` (`skill_files.rs:1054`).** A second implementation of an install
  that does not exist — §7 D2.
- **`preview_execution` (`executions.rs:851`).** Shares `assemble_prompt` with the runner and
  passes different arguments — §7 D3.
- **`ConfirmDialog` / `feedback/ConfirmDialog`.** A correct consent gate with no opinion about
  whether its `body` is true. `body: string` is the type that permits every defect in §0.
- **`PruneResult`, `SkillInstallPreview`, `CronPreview`, `ExecutionPreview`, `MemoryCleanupReport`,
  `CrossRefRepairPlan`.** Six ts-rs preview structs; **one** (`CrossRefRepairPlan`) states a
  postcondition, **zero** carry a token identifying the state they were computed from.

---

## 4. Steps

1. **Write one function, not two.** If you have typed `pub fn preview_` and the thing it previews
   already exists, stop and add a flag to the existing one instead. Two commands means two call
   graphs, two parameter lists, and two people maintaining an agreement nothing checks.
2. **Build the whole plan before you branch.** Every id, every new value, every derived name. The
   plan is a value, not a side effect of walking.
3. **Return on the flag, immediately above the write.** `if !apply { return Ok(plan) }`. Anything
   between that line and the write is code the preview did not run and cannot describe.
4. **Default the flag to preview** — `Option<bool>` → `unwrap_or(true)` — or make it a required
   `bool` so the caller must decide. `unwrap_or(false)` is a door that acts when a caller forgets,
   and there is one in this tree (§7 D8).
5. **Enumerate the blast radius from the schema, not from the predicate.** For each table you
   write, query `sqlite_master` (or your migration source) for inbound foreign keys and their
   `ON DELETE` action, and count the rows each will take. Report them as named lines, not a total.
   If you cannot enumerate them, label the headline a lower bound — that is honest and a wrong
   number is not.
6. **Where values change, put the values in the plan.** A repair reports `old → new` per distinct
   pair; a release reports the tag; an import reports the names it will overwrite. `create_patch_release`
   is nine lines of this.
7. **Hash the inputs and stamp the plan.** Then require the stamp on the apply and **fail** on a
   mismatch — `apply_bundle_import:88-110` is the whole implementation, twenty lines.
8. **Give the plan a postcondition it asserts about itself.** `CrossRefRepairPlan.contexts_written`
   is documented as zero on a dry run *by construction*; a preview that can accidentally write is
   not a preview.
9. **Report the same numbers afterwards, measured.** Same struct, same fields, `dry_run: false`.
   Never `bool`, never `()` — §9.
10. **On the client, render the plan and nothing else.** Never a `.length`, never a local filter
    that predicts a server refusal. If the plan failed to load, disable the button.
11. **And then stop.** Do not add a "quick" second preview for a cheaper path; do not recompute the
    plan inside the apply "to be safe" — that is exactly the recomputation the token exists to
    detect.

### Can the type make the wrong call impossible? — asked before §9

**Three answers, and they are not the same answer.**

**T1 — YES, and it is one line, for the flag's default.** The bad state is
`dry_run: Option<bool>` interpreted as `unwrap_or(false)`. Held against the seven qualifications:

- **Q3 (a type nobody constructs constrains nothing).** **This is the qualification that decides
  it.** There are **12** flag-taking functions in 963 Rust files. Twelve is reachable; the edit
  lands. A general `Plan<T>` wrapper across all 104 mutating doors does not meet Q3 and is a
  refactor, not a type.
- **Q5/Q6 (withhold the dangerous freedom, not the answer).** The dangerous freedom is *omitting
  the decision*, so withhold the `Option`: `dry_run: bool`, required.
  `github_create_patch_release` already does this and is the only one of the twelve where a caller
  cannot forget. **Measured, this repo has run the experiment itself:** three doors, three defaults
  — required (`create_patch_release`), safe (`prune_storage`), unsafe
  (`run_director_memory_cleanup`, `unwrap_or(false)`) — and the unsafe one is the one whose UI
  path was never built.
- **Q7 (relaxing a requirement is inert where the caller supplies the bad value voluntarily).**
  Nothing forces `unwrap_or(false)`; the author volunteered it. So the type must *remove the
  option*, not widen it.

**T2 — YES, and stronger, for the token, because the defect is an `Option`.**
`BundleImportOptions { preview_id: Option<String>, expected_bundle_hash: Option<String> }` makes
the entire TOCTOU guard opt-in: a caller that passes neither gets the old, unguarded path with no
diagnostic. The closed form is a two-variant input —
`enum ImportSource { Fresh(PathBuf), Previewed { preview_id: PreviewId, hash: BundleHash } }` —
under which "previewed but unverified" is **unspellable**, which is precisely the state the twenty
lines at `:88-110` exist to detect at runtime. Q1 applies and is worth stating: this closes
*whether the plan was verified*; it encodes nothing about whether the plan was **right**, which is
P1/P2 and needs T3.

**T3 — NO for "is this preview the same computation as the action", and the reason is the leaf's
own finding.** No signature distinguishes `assemble_prompt(p, tools, input, None, None, None,
None)` from `assemble_prompt(p, tools, input, hints, ws, connectors, ambient)`. They are the same
function, the same types, and a different computation — **calling the same function is where the
type system stops and the divergence starts.** The reachable approximations are structural, not
nominal: (i) delete the second entry point so there is nothing to call differently; (ii) do what
the strongest external result in this sweep does and compute the preview *through the enforcement
path itself*, so a divergence cannot be expressed (§6 clause 1). **The residue — a preview door
that still exists as its own function — is what §9 cannot see and §8 Gap 1 owns.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **A `preview_x` command beside an `x` command** | Two implementations of one effect. They diverge on parameters first (a `None` where the runner passes a value, a default window, a discarded argument) and on logic later. Executed: `preview_execution` vs the runner, `skill_files_install_preview` vs `install_skill_copy`. §7 D2, D3. |
| **A preview whose count comes from the predicate** | Correct about the noun, silent about the cascade. Executed at **3.29×** on a preview that shares its SQL string with the action, and **207×** on a delete confirmation whose count is right. §0, §7 D1. |
| **A confirmation that names one table** | `"Delete {n} agents"` while 20 tables empty. The sentence is not wrong; it is incomplete in a way the reader cannot detect, which is worse. §0. |
| **`dry_run: Option<bool>` → `unwrap_or(false)`** | The safety property is the default, not the flag. A caller who has not thought about it gets the destructive branch. `director.rs:58`. §7 D8. |
| **The only UI caller passing `dry_run: false`** | `StorageUsageSection.tsx:38` — the backend's dry-run mode has **zero** call sites in the app, so the safe path is dead code and the confirm number comes from a *different command* (`storage_usage`) run at a *different time*. §7 D1. |
| **The apply recomputes the plan** | Two invocations, two plans, no diff. Any change in between — another session, a background tick, the clock crossing a threshold — silently changes what happens. Only `apply_bundle_import` detects it. §7 D9. |
| **A preview that predicts what the server will refuse** | The client filters `trust_origin !== 'system'` to build the count the server will independently protect against. They agree today; nothing checks that they still will. §7 D5, and [`client-rule-mirroring`](./client-rule-mirroring.md). |
| **A preview reporting an effect the action cannot perform** | `skill_files_install_preview` reports `removedCount`, rendered in a warning banner as *"{n} removed"*. `copy_dir_recursive` only creates and overwrites. Replayed over the real skills tree: **8 of 14 shared skills** would claim **16 files** will be removed; **0** will. §7 D2. |
| **Comparing by size to decide "unchanged"** | The same preview keys its diff on `BTreeMap<String, u64>` of byte lengths. Two files of equal size and different content are reported unchanged and then overwritten. §7 D2. |
| **A preview that ignores a parameter it accepts** | `preview_execution(persona_id, input_data, _use_case_id)` — the third argument is typed, exposed over IPC, passed by the caller (`ExecutionPreviewPanel.tsx:28`) and bound to `_`. The runner scopes memory injection by use case (`runner/mod.rs:852-853`); the preview does not. **971 of 3,132** injectable memories are use-case-scoped. §7 D3. |
| **`Ok(true)` from a set-scoped write** | A report that cannot be wrong. Executed: 0 of 25 credentials exported, `true`, UI renders "Exported!". **5 doors**, all exports — already ratcheted by [`portable-export-bundle`](./portable-export-bundle.md)'s `opaque-artifact-outcome` (§9). |
| **Discarding the count the action returned** | `await deleteAllMemories();` — the command returns `usize` (6,535) and the call site throws it away, then refetches. The truth existed on **both** sides of the action and was rendered on neither. `MemoriesPageDense.tsx:392`. |
| **A count-shaped preview for a value-shaped change** | A repair that would rewrite `status` reports "26 rows". The same 26 is reported by the correct repair and by one that collapses distinct statuses. §7 D6, P5. |
| **A retention sweep with no preview at all** | Five sweeps run on a background tick, silently, and log only when the count is non-zero. There is no surface, no estimate, no receipt — and they currently delete **0** rows for five different reasons. §7 D7, and [`retention-and-pruning`](./retention-and-pruning.md). |
| **Proceeding when the preview failed** | `null` preview renders as no banner, and the install/mint/apply button stays live. 6 of 6 repos in the cohort. §8 Gap 4. |

---

## 6. Evidence

**The ONE site to copy: `src-tauri/src/commands/infrastructure/context_consolidate.rs:798-880`,
`repair_cross_refs`** — and copy the doc comment as much as the function.

```rust
/// **Dry run by default** — `apply_changes` must be `true` to write, mirroring
/// [`consolidate_contexts`]'s own `dry_run`. That is not politeness: `dev_contexts`
/// has no version column, no soft-delete and no `absorbed_from`, consolidation
/// hard-deletes, and context scans are never recorded in `dev_scans` — so a bad
/// repair cannot be rolled back from inside the app. It reports a plan; applying
/// is a separate explicit act, and it is never wired into a scan hook.
```

Six things to copy: (1) **one function**, so the plan the caller sees is the plan the caller
applies; (2) the flag is `apply_changes`, so the *unsafe* thing needs the word, not the safe one;
(3) the plan **states its own postcondition** — `contexts_written` documented *"Zero on a dry run,
by construction"*, `dangling_after` documented *"Equals `unresolved`"*; (4) it reports what it
**will not** fix (`unresolved_names`, `ambiguous`) rather than silently doing nothing about it;
(5) the doc comment names **why** the default is safe, in terms of what the schema cannot undo;
(6) `rewrites` carries the resulting values and `rewrites_omitted` admits the display truncation
without truncating the counts. Its client half is `ContextMapHealth.tsx:275-282`, which renders
`plan.contextsTouched` and nothing of its own.

**Secondary exemplars, each for one property:**

| Site | What to copy |
|---|---|
| `commands/network/bundle.rs:67-110` | **The preview→apply token.** `preview_id` retrieves the exact bytes; `expected_bundle_hash` is mandatory once a preview happened; a mismatch is a refusal with a copy-ready message. Unique in this repo **and in all five siblings.** |
| `engine/platforms/github.rs:598-612` | **The dry run returns the same struct as the action**, so it names the resulting value (`new_tag`) rather than a count — and the flag is a required `bool`. |
| `context_consolidate.rs:500-508` | **`project_cross_ref_effect(&ctxs, &ops)` computed before the branch**, with *"this is the number that went unreported for two days"* on the line. P2, earned from an incident, in this tree. |
| `commands/infrastructure/system/storage.rs:109-127` | **One `where_clause`, two statements** — the correct treatment of the predicate half — plus a safe default, an un-arguable floor, and an allow-list with its reasoning. |
| `src/features/schedules/libs/useCronPreview.ts:12-22` | **Delete a preview you cannot make honest.** The seedless hook was removed rather than aligned, with the reason recorded. |
| `commands/tools/triggers.rs:826-836` | **A preview door documenting its own divergence** from runtime, in the doc comment, with the fix (`pass the trigger id as the seed`). |
| `db/src/repos/core/memories.rs:1046-1051` | **The operation's scope, written down** — the `tier != 'core'` carve-out and what removing it would destroy. This is what a destructive confirmation must quote. |

### Convergence — 5 sibling repos

Swept read-only against `../personas-web`, `../brainiac`, `../personas-cloud`, `../vibeman`,
`../ascent`. **All five exist and all five were opened.** Lineage: **no textual overlap** on this
topic — none of `engine/dry_run.rs`'s identifiers, none of the `UnattendedMode = "auto" | "dry_run"
| "approval"` vocabulary, and none of the doc-comment prose quoted above appears in any sibling, so
nothing below is a port agreeing with its original. Per the doctrine's standing correction,
`personas-cloud` and `personas-web` are one system, so **the effective independent cohort is 4**;
on this leaf both are silent regardless, so every ratio below is reported over 5 and would be
reported the same over 4.

Flag inventory: **11 preview/dry-run flags across the five** — vibeman **8**, brainiac **2**,
personas-cloud **1** (and it is a config linter, not a plan), personas-web **0**, ascent **0**.

| # | clause | verdict | evidence |
|---|---|---|---|
| 1 | **The structural answer is to compute the preview *through the enforcement path*, not to model it** | **THE STRONGEST EXTERNAL RESULT — `brainiac` ALONE (1/5), and it is ahead of us** | `brainiac/crates/brainiac-server/src/console.rs:4759-4761`: *"Blast radius: exactly what a key principal could read, computed by opening a transaction AS that principal — the same RLS path the runtime uses, so **the preview can't drift from enforcement**."* It opens `state.store.scoped_tx(&candidate)` (`:4822`) — the identical mechanism used at **299** call sites across its crates. **Class-B divergence is not disciplined away, it is made unrepresentable.** This is P1's answer and no Personas preview implements it. |
| 2 | **A preview and its action computed by different code will diverge** | **PHYSICS — independently reproduced, with the divergence measured** | `vibeman/src/lib/triage/triageRulesEngine.ts:115` (`evaluateTriageRules`, applies) and `:179` (`previewTriageRules`, docstring *"Dry-run: preview which ideas would be affected without applying changes"*). Each loops rules × ideas independently; they share only the leaf predicate. **The counted populations provably differ**: preview pushes on match (`:200-202`), apply pushes only *if the write succeeded* (`:142-146`), so a failed write drops the idea from the count **and** frees a lower-priority rule to claim it in apply but never in preview. Plus an `age_days` predicate reading `Date.now()` across two HTTP calls, and `applyAction` (`:97-107`) collapsing `reject` and `archive` to one status the preview reports separately. The user-facing number (`route.ts:80` → `TriageRulesPanel.tsx:158`) comes from the **preview** implementation; the run button calls the other one. **This leaf's hypothesis, confirmed by a different team in a different language with no shared document.** |
| 3 | **Nobody binds a plan to the state it was computed from** | **PHYSICS AS AN ABSENCE (5/5) — and PERSONAS IS ALONE IN HAVING ONE (1/6)** | Zero occurrences of `plan_id`, `snapshotId`, `computedAt`, or a preview-scoped `etag`/`version` in any of the five. Where a preview→apply pair exists the plan is discarded and re-derived — `vibeman/MigrationTimeline.tsx:103` does `setRollbackPreview(null)` on the line that starts the apply, and the server re-runs `getAppliedMigrations` to rebuild the DDL. `brainiac`'s `TokenPreviewResponse` (`console.rs:4751-4757`) carries nothing, and `mintKey(name, userId, scopes)` is unrelated. **`apply_bundle_import`'s `preview_id` + mandatory hash check is the only implementation in six repos** — and §8 Gap 3 is that it is opt-in. |
| 4 | **Nothing refuses to act when the preview failed** | **THE FLEET CONVERGED ON THE DISEASE (6/6)** | `brainiac/console/app/console/modules/keys/KeyShared.tsx:112` swallows a preview failure into `setPreview(null)`; `mint` at `:121-132` is gated only on name/scopes/live — **you can mint a key whose blast radius failed to compute.** Same shape here (§8 Gap 4). The single counterexample in the cohort is a shell precondition, not a preview gate (`brainiac/scripts/install-backup-cron.sh:98-103`, refusing in *both* modes when the log dir is unwritable). Per the doctrine: perfect agreement on an omission is evidence the situation is universal and evidence **against** an answer existing to adopt. |
| 5 | **A confirmation must state the collateral damage, not just the noun** | **`ascent` ALONE (1/5) — and Personas is BEHIND it, 0 of 69** | `ascent/src/components/ConfirmAction.tsx:19-20`: *"The copy each caller passes must state WHAT happens and HOW MANY things it affects."* `:31` on the `body` field: *"What will happen and how many things it affects — never 'Are you sure?'"*. `segmentDeleteConfirm` (`:139`) renders *"This permanently deletes the segment{tags}. **Those tags also drive the Overview filter and segment comparison.** This can't be undone."* — the child count **plus the two downstream surfaces that break** — and `ConfirmAction.test.tsx:20` pins it by name: *"The tags also drive the Overview filter + comparison — the collateral damage must be stated."* `retestConfirm` (`:186`) prices the *economic* blast radius. **The repo with zero dry-run machinery has the best-communicated destructive actions.** |
| 6 | **Preview *plumbing* predicts preview *honesty*** | **REFUTED — and this inverts the spine's `mixed` on the axis that matters** | The repo with the most machinery (vibeman, 8 flags) owns the cohort's only provably-divergent preview (clause 2) and 1 safe default out of 8; the repos with **none** (ascent, personas-web) contain the cohort's best destructive-action communication (clause 5). Adding a flag and telling the truth are independent variables. |
| 7 | **Preview the resulting values, not a count** | **MINORITY (2/5), and both are better than a count** | `vibeman/src/app/api/migrations/route.ts:164-172` returns the **actual rollback DDL statements** (`RollbackResult.ddl: string[]`), and vibeman's own audit asks for more — `docs/harness/…/database-schema.md:62`: *"gate the destructive `dryRun:false` call behind a modal that renders the returned `ddl[]`, highlights `DROP TABLE` lines in red … keep dry-run as the default one-click 'preview.'"* `brainiac` returns a tiered breakdown (`total/org/team/private/canonical`) computed in one statement with `count(*) FILTER`, rendered under the label *"blast radius — computed by the same RLS the runtime enforces"*. Ours: `create_patch_release` names the tag. |
| 8 | **Report the server's authoritative changed-count, not the input size** | **`ascent` ALONE (1/5), and it names the failure mode** | `ascent/src/components/org/repositories/RepoLeaderboard.tsx:93-95`: *"`bulkTagRepos` returns the server's authoritative `changed` count (createMany skips repos already tagged). Report THAT, not `selected.size` — telling the user 'Added 10' when 7 were already tagged and only 3 changed is **success theater**."* That is P6, named, by a sibling — and it is exactly what `Ok(true)` from `export_credentials` and the discarded `usize` from `deleteAllMemories()` both are. |
| 9 | **Cascades are declared and never reported** | **PHYSICS (4/5 of the repos that have a schema)** | `personas-cloud/packages/orchestrator/src/db.ts:270,271,292,293,316,328,389` — **six** `ON DELETE CASCADE` FKs hang off `personas` (tool defs, credentials, triggers, subscriptions); nothing counts or names them, and `db.ts:791` returns `result.changes` *after* the write — a receipt, not a preview. vibeman states three cascades **qualitatively with no N** (`CG_modal.tsx:71` *"This will delete all contexts in this group"*; `ShortcutsBar.tsx:119` / `WorkspaceManager.tsx:54` *"Projects inside will become unassigned (not deleted)"* — good, it states the effect **and its bound**). Only `ascent` and `brainiac` put a number on it. |
| 10 | **Where the confirm's number comes from** | **PHYSICS — client-sourced (4 of 5 counted confirms in the cohort)** | personas-web `ReviewsSplitPaneToasts.tsx:66,70` (selection size); vibeman `AcceptAllButton.tsx:35` (`remainingCount` as a client prop, while the POST sends only `{projectId, projectPathMap}` and the **server re-derives "all remaining" itself** — the stated quantity and the acted-upon set never touch); ascent `batchPrConfirm` (selection, capped by a **mirrored** `MAX_BATCH = 25` literal whose server twin lives in another file). The one server-sourced confirm in the cohort, ascent's `segmentDeleteConfirm`, is a server count maintained optimistically on the client with explicit anti-drift reconciliation (`RepoSegmentsPanel.tsx:224-226`) — and it is still **not re-read at confirm time.** |

**Physics — keep as doctrine:** clauses 2, 3 (as an absence), 4 (as a converged *disease*, per the
doctrine's warning), 9, 10.
**Reported as MINORITY / this-repo-alone / that-repo-alone:** clauses 1, 5, 7, 8.
**Refuted:** clause 6.
**Silences, reported as silences:** `personas-web` and `ascent` have **no dry-run, preview-before-mutate,
or plan/apply split anywhere**; `personas-cloud`'s single hit is a config validator. Three of five
siblings have no preview machinery at all.
**Personas is ahead** on exactly one thing and it is worth defending: **the preview→apply token**
(`apply_bundle_import`), which no sibling has. Personas is **behind** `brainiac` on computing the
preview through the enforcement path, and behind `ascent` on saying what else goes.

### The composition defects with the neighbouring paths — offered upward

**(i) with [`bulk-command-variant`](./bulk-command-variant.md).** P6 as stated counts
`bulk_assign_tools -> u32` as *compliant* — it can carry a quantity. That path's §0 measures the
same `u32` as **the defect**: `bulk_assign_tools` answers `3` where the singular sibling would have
said `created, existing, created, created`, and answers `Err("FOREIGN KEY constraint failed")` with
all four writes rolled back where exactly one should have been refused. **Both are right and they
compose into a trap:** satisfying this path's floor (report a quantity) can look like satisfying
that path's ceiling (report per-item outcomes) and does not. The one-line clause both paths need:
**a scalar is the minimum a set-scoped operation may report and the maximum it may report only when
every item's outcome is identical by construction.**

**(ii) with [`informed-consent-gate`](./informed-consent-gate.md) and
[`aggregate-count-display`](./aggregate-count-display.md).** Those two already share the finding
that §0's memories dialog is a *correct* consent gate containing a false number. This path adds the
third leg and it is the uncomfortable one: **the agents dialog's number is not false.** "Delete 77
agents" is exactly right, passes the consent gate, and passes any count-provenance rule — and it
destroys 15,958 rows. A count sourced correctly from the correct table is still not consent, so
neither of those paths' prescriptions reaches it. **The quantity a consent gate must state is the
effect, not the noun.**

**(iii) with [`client-rule-mirroring`](./client-rule-mirroring.md).** Every confirmation count
computed by a client-side filter over a server rule is one of its mirrors, and it inherits its
whole failure mode: `PersonaOverviewActions.tsx:105-107` filters `trust_origin !== 'system'` and
`personas.rs:1853` refuses `PersonaTrustOrigin::System`. They agree today (verified: 1 system
persona, 77 others) and **nothing anywhere asserts they still will** — no shared constant, no
generated type, no test spanning both. Its §9 rule cannot see this pair because the mirror is a
filter predicate rather than a ladder.

**(iv) with [`retention-and-pruning`](./retention-and-pruning.md).** Its finding is that five
retention controls delete zero rows. Its natural fix — correct the allow-lists — is the one thing
the campaign's standing rule forbids applying, because the first correct run deletes **4,941**
`persona_events` rows (replayed). **That is precisely the situation this leaf exists for**, and
neither path's prescription currently supplies it: there is no preview surface for any sweep, so
the fix cannot be shipped safely without first building the thing this document describes.
**Sequence matters: the preview lands before the allow-list is corrected, not after.**

---

## 7. Deviations

Every entry is live on `master` @ `2a874e692`, verified by reading the file and — where a number is
quoted — by replay against a read-only copy of the operator's databases. **Nothing here was
applied.** Per the campaign's standing rule, a leaf whose first run deletes rows is a note.

### D1 — `prune_storage`: three separate defects behind one good pattern · **executed, twice**

`storage.rs:99-132` + `StorageUsageSection.tsx`.

1. **The blast radius is 3.29× the reported number** (§0). The `where_clause` is shared; the
   cascade is not in the predicate. Verified by two methods that agreed per table.
2. **The number on screen does not come from `prune_storage` at all.** The confirm renders
   `report.prunableExecutions` from **`storage_usage`** (`StorageUsageSection.tsx:81`), a different
   command with a *separately computed* cutoff — `cutoff_rfc3339(MIN_PRUNE_AGE_HOURS)` at
   `storage.rs:74` vs `cutoff_rfc3339(age_hours)` at `:107`. They coincide only while
   `older_than_hours` is `None`, which is true of the only caller today. **The dry-run mode that
   would give the correct number is never used**: `StorageUsageSection.tsx:38` is
   `pruneStorage(undefined, false)` — the app's sole call site, passing `false`, so the backend's
   *"dry-run by default"* contract has **zero** consumers.
3. **The preview is cached and the cutoff is not.** `refresh()` runs in `useEffect(…, [])`; the
   cutoff is `Utc::now()` at each call. A panel opened at 09:00 and confirmed at 17:00 deletes
   everything that became terminal in between. On this install the exposure is **0 rows** (newest
   `completed_at` is 2026-06-26, 52 days ago) — **latent, not benign**: it is zero because the app
   has not run an execution in two months, not because anything prevents it.

**Fix (note):** compute the confirm number from `prune_storage(dry_run: true)` — the command that
will act — and add per-child-table counts to `PruneResult`. Three fields and one call-site change.

### D2 — `skill_files_install_preview` reports an effect the installer cannot perform · **replayed over the real skills tree**

`skill_files.rs:1054-1140` vs `install_skill_copy` at `:773-843`. Four divergences, all from being
a second implementation:

| the preview says | the install does |
|---|---|
| `removed_count` — files at the target absent from the source, rendered by `SkillInstallModal.tsx:143-152` as *"{n} removed"* in a warning banner with `−` markers | **`copy_dir_recursive` (`:327-345`) only creates and copies. Nothing is ever deleted.** Replayed over `~/.claude/skills` (15 dirs) × `.claude/skills` (35 dirs): of the **14** skills present in both, **8** would claim files will be removed — **16 files** total, `ship-loop` alone claiming 9 — and **0** will be. |
| `changed` / unchanged, keyed on `BTreeMap<String, u64>` of **byte sizes** (`collect_skill_files:350`) | copies every source file regardless. Two files of equal size and different content are reported unchanged and silently overwritten. (Measured on the current tree: **0** such pairs — the defect is latent, and it is latent because file sizes happen to differ.) |
| both sides **exclude** `PROVENANCE_FILE` and `LESSONS.md` (`:361-366`) | `write_provenance(&target_dir, …)` (`:806`) **writes** the provenance file, and `refresh_skill_registry_file` rewrites the registry. Two writes the preview does not mention. |
| the same counts whether or not `overwrite` is set | with `overwrite = false` and an existing target the install does **nothing** and returns `reason: "exists"`. The preview has no `overwrite` parameter, so the banner describes an install that will not happen. |

**Fix (note):** delete the preview command; give `install_skill_copy` a `dry_run: bool` that
returns the same `SkillInstallResult` shape, computed by the same walk that copies. That removes
all four divergences at once and is smaller than repairing any one of them.

### D3 — `preview_execution` shares the function and diverges in the arguments · **the leaf's subtlest case**

`executions.rs:851-905`. It calls `prompt::assemble_prompt` — the runner's own assembler — and
annotates its own divergence in four inline comments:

```rust
let prompt_text = prompt::assemble_prompt(
    &persona, &tools, input_json.as_ref(),
    None, // no credential hints in preview
    None, // no workspace instructions in preview
    None, // no connector usage hints in preview
    #[cfg(feature = "desktop")]
    None, // no ambient context in preview
);
```

The returned `ExecutionPreview` is a **token count and a cost estimate** built from that prompt, so
both are systematically low by whatever those four contexts weigh. Two further divergences:

- **`_use_case_id` is accepted and discarded.** The IPC signature takes it, `executions.ts:144`
  passes it, `ExecutionPreviewPanel.tsx:28` supplies the user's selection — and the parameter is
  bound to `_`. The runner scopes memory injection by use case
  (`runner/mod.rs:852-853`, `.with_use_case(execution_use_case_id.as_deref())`); the preview does
  not. Live: **971 of 3,132** injectable memories carry a `use_case_id`, across **17** use cases,
  so the preview's `memory_count` and prompt are over a strictly different set than the run's.
- **The tool surface differs.** `prepare_persona_execution` (`executions.rs:541-548`) pushes every
  runnable automation into `tools` via `automation_to_virtual_tool`; `preview_execution` does not.
  (Live: **0** automations exist, so this one is **latent**.)

**Cleared while measuring, and worth recording:** I expected `preview_execution`'s
`get_for_injection` to be a stale v1 diverging from the runner's `get_for_injection_v2`. It is
not — `memories.rs:1367-1373` forwards to v2 with the same scope constructor. And I expected its
`core.len() + active.len()` to under-count against the runner; it does not —
`prepared_run_cache::append_memories` (`:93-99`) appends **only** core and active. **Two hypotheses
raised and refuted; the real divergence was the discarded parameter, which is not a count problem
at all.**

**Fix (note):** thread `use_case_id` through and resolve the four contexts, or return
`ExecutionPreview` with an explicit `omits: Vec<&str>` naming what the estimate excludes. The
second is smaller and honest; the first is correct.

### D4 — a preview whose seedless call site outlived the hook that was deleted for being seedless

`useCronPreview.ts:12-22` records that the old `useCronPreview` was **removed** — not fixed —
because it called `preview_cron_schedule` without a seed and *"modelled a fire minute the engine …
would never actually use"*. Two call sites remain:

| call site | seed | verdict |
|---|---|---|
| `useScheduleActions.ts:254` — `previewCronSchedule(expression, 5, timezone, seed)` | ✅ | the fix that motivated the deletion |
| `TriggerAddForm.tsx:85` — `previewCronSchedule(expr.trim(), 5, tz)` | ❌ | the defect the deletion was for |

And it is **structural, not an oversight**: the add form previews a trigger that does not exist
yet, so there is no `trigger_id` to seed with. The preview it can compute is not the preview the
user needs. Live exposure: **1** cron trigger, **0** `H` tokens — **latent**, and it is the leaf's
clearest case of a preview that is *architecturally* unable to model the action.

**Fix (note):** mint the trigger id client-side before the preview and pass it to both the preview
and the create; then the seed is stable across the boundary. This is the same shape as the
preview-token fix in §2 (e), arriving from a different direction.

### D5 — the confirmation count is a client mirror of a server refusal rule · **agrees today**

`PersonaOverviewActions.tsx:105-107` filters `trust_origin !== 'system'` before rendering
`{count}`; `personas.rs:1853` answers `status: "protected"` for `PersonaTrustOrigin::System`.
Replayed: **1** system persona, **77** others — the mirror is exact. There is no shared constant,
no generated union, and no test spanning both. The post-hoc toast (`:87`) *does* report the truth
(`{ deleted, skipped: protectedCount + failed }`), so the receipt is honest and only the preview is
a prediction. Recorded as a **live mirror, currently agreeing**, for
[`client-rule-mirroring`](./client-rule-mirroring.md); the count's real defect is D-zero (§0):
77 is right about personas and 207× wrong about rows.

### D6 — a repair with no preview, where a count-shaped preview would not have been enough

[`data-normalization-migration` §0](./data-normalization-migration.md) measured
`persona_triggers.status` added `NOT NULL DEFAULT 'active'`, backfilled from `enabled`, with 5 of
10 production `INSERT` sites omitting the column. Replayed today, the drift is unchanged:

```
enabled=1  status='active'   325
enabled=0  status='active'    26   ← the drift
```

A repair has no preview surface at all — there is no command, no dry run, no dialog. If one were
built as a row count it would report **26** for the correct repair *and* for a destructive one,
because the two differ in the **values** they write, not the rows they touch. **P5's warrant, and a
correction to the brief:** the brief asserted the naive repair would flatten `paused` and `errored`
into `active`. Measured, `status NOT IN ('active','disabled')` returns **0** — those values are
legal in the vocabulary and **no live row holds one**, so the flattening is real and **latent**,
not live. The argument survives and is *stronger* stated correctly: a value-flattening repair is
invisible to a count preview *and* invisible to the data until the day someone pauses a trigger.

**Fix (note):** any repair here ships with a preview that groups by `(enabled, status) → new
status` and shows the resulting pairs, not a total.

### D7 — five retention sweeps, no preview, no receipt, no surface

`background.rs:2967-3140` runs `events::cleanup`, `enforce_count_cap`, `cleanup_old_executions`,
`cleanup_old_messages`, `sweep_stale_drafts` on a tick. Each logs **only when the count is
non-zero** (`Ok(n) if n > 0 => info!`, `Ok(_) => {}`), so "deleted nothing" and "never ran" produce
identical output. **Zero** of the four wired retention keys has a UI: `execution_retention_days`,
`event_retention_days`, `event_retention_max_count` and `draft_retention_days` appear **0** times
across all 4,829 `.ts`/`.tsx` files, so they can only be changed through a generic settings door
with no estimate of what changing them will remove. The **one** retention control that does exist
makes the point better: `PersonaSettingsTab.tsx:220-234` renders a per-persona *"Execution
Retention"* picker writing `execution_retention_months:<personaId>` (`:73`) — and
[`retention-and-pruning`](./retention-and-pruning.md) measured that **no Rust reader for that key
exists**. A control with a label, a value, a persisted setting, no preview, and no consumer.

Replayed today: all five delete **0** rows ([`retention-and-pruning`](./retention-and-pruning.md)
owns why, five separate reasons). Replayed with the events allow-list corrected —
`status IN (…, 'delivered')` — `cleanup(30)` removes **4,941** rows, 99.4% of the table, on the
first tick after the fix. **A control with no preview, no receipt, and no UI, whose first correct
execution is its largest.**

**Fix (note):** a `retention_preview` door returning per-sweep would-delete counts, rendered in
Settings beside each key, before any allow-list is corrected. Explicitly sequenced ahead of that
path's fix (§6 composition (iv)).

### D8 — three dry-run doors, three different defaults

| door | signature | default | consequence |
|---|---|---|---|
| `prune_storage` (`storage.rs:104`) | `dry_run: Option<bool>` | **preview** (`unwrap_or(true)`) | safe — and its only caller opts out |
| `github_create_patch_release` (`github_platform.rs:43`) | `dry_run: bool` | **required** | the caller cannot forget |
| `run_director_memory_cleanup` (`director.rs:51`) | `dry_run: Option<bool>` | **act** (`unwrap_or(false)`) | a caller who omits it archives memories |

The third's own doc comment says *"`dry_run` reports the proposed counts without mutating"* while
its default is to mutate. `director_memory.rs:197-204` is otherwise correct — one function,
`if dry_run || all_ids.is_empty()` skips the archive, `if !dry_run && !archived_ids.is_empty()`
guards the write — so the *architecture* is right and only the default is wrong. It is also the
one of the three with **no UI caller**, which is why nobody has met it.

**Fix (note):** `unwrap_or(true)`, or make it a required `bool` per §4 T1.

### D9 — the preview→apply handshake exists once, and is opt-in

`apply_bundle_import` (`bundle.rs:67-110`) is the best mechanism in six repos (§6 clause 3). Both
its fields are `Option`: a caller that passes neither `preview_id` nor `expected_bundle_hash` gets
the unguarded path silently. The check is only mandatory *conditionally* — `preview_id.is_some() &&
expected_bundle_hash.is_none()` is refused, but `preview_id.is_none()` skips the whole guard. And a
preview-cache miss falls back to re-reading the file with a `warn!` (`:73-76`), which is the right
recovery only because the hash check follows it.

**Fix (note):** the closed two-variant input from §4 T2, which makes "previewed but unverified"
unspellable. **And then adopt the mechanism at the other four preview→apply pairs**, which is the
larger half of the work.

### D10 — set-scoped writes that answer with a boolean · **5 doors, and one is measurably a no-op**

The §9 population, and it is **already gated** by [`portable-export-bundle`](./portable-export-bundle.md)'s
`opaque-artifact-outcome` at these exact five sites — see the decline in §9. `export_credentials`
returns `Ok(true)` having written **0 of 25** credentials
(§0), and `export_full` / `export_selective` / `export_selective_to_path` / `export_persona`
(`data_portability.rs:1800,1833,2128`; `import_export.rs:241`) all write bundles whose contents —
memories, triggers, credentials, `export_warnings` — the caller never enumerated and can never
learn the size of. The warnings machinery makes this sharper: `export_full`'s doc comment says
*"The omission is recorded in `export_warnings` rather than being silent"* — and the return type is
`bool`, so the warnings do not reach the caller through it.

**Fix (note):** an `ExportOutcome { file_path, personas, memories, credentials, skipped, warnings }`.
This is the one deviation in the list that is a pure widening — no behaviour changes, `true` becomes
a struct whose truthiness is the same — but it is a public IPC signature, so it is still a note.

### D11 — cleared claims, recorded because a cleared claim is worth as much as a confirmed one

- **"`preview_digest` and `send_digest_now` use different windows."** They do — the preview takes
  `days: Option<i64>` clamped 1..30 (default 7) while `deliver_digest` derives `period_days` from
  `config.cadence` (1 or 7) — but both call the same `generate_digest`, and on this install both
  return an empty digest (**0** executions in the last 1, 7 or 30 days). A **latent** parameter
  divergence, not a live one. What *is* live at that pair: `send_digest_now` returns `Result<(),
  AppError>` and `deliver_digest` returns early when `!config.enabled` or when
  `total_executions == 0`, so the command reports success for a delivery that did not happen — D10's
  shape under a name my §9 signal does not match (`send_*`).
- **"The preview undercounts memories because it uses v1 injection."** Refuted twice — see D3.
- **"`consolidate_contexts` merges across projects."** No. `list_contexts_by_project(pool,
  project_id)` scopes it; the largest project holds 49 of 408 contexts, so a merge is bounded by
  ~12% of the table. And **0** contexts currently carry a `[Consolidated` marker, meaning the merge
  has never run on this install, so `repair_cross_refs` has 385 cross-ref-bearing contexts and
  nothing to repair. **The best-designed preview in the repo has never been used** — which is why
  its quality is a design decision rather than a scar.
- **"The Reviews and Messages delete-all confirmations have the memories defect."** They do not.
  `ManualReviewList.tsx:509` reads `reviewQueue.counts?.total ?? 0` — a server `GROUP BY` — and
  matches `DELETE FROM persona_manual_reviews` exactly (194 : 194). `MessageList.tsx:404` reads
  `messagesTotal`, a real count (0 : 0). **Three sibling dialogs, same week, same copy; the one
  that reads the page is the outlier, not the pattern** — which contradicts the intuition that the
  defect is systemic and localises it to one file.
- **"`Ok(true)` from `export_credentials` is a bug in the export."** It is not — the skip rule is
  deliberate and documented (*"built-in connector credentials are re-provisioned on import"*). The
  bug is that a deliberate skip of **100%** of the corpus is indistinguishable from a successful
  export, because the return type cannot hold the number. **The predicate is right and the report
  is the defect** — which is the same relationship §0 found between `prune_storage`'s predicate and
  its cascade.

---

## 8. Gaps

**Gap 1 — Nothing can tell whether a preview is the same computation as its action, and no gate
will ever see it.** D3 is the sharpest deviation here and it is *one function called twice with
different arguments*. There is no type, no lint, and no census signal that distinguishes
`assemble_prompt(p, t, i, None, None, None, None)` from the runner's call — they are the same
symbol with the same types. The only reachable answers are structural: **delete the second entry
point** (§4 T3 (i)) or **compute the preview through the enforcement path** the way §6 clause 1's
sibling does. This is upstream of D2, D3 and D4, and it is why the only machine-visible condition in
this leaf is about the *report* rather than the *preview* — and why even that one turned out to
belong to a neighbour (§9).

**Gap 2 — The blast radius is computable and nothing computes it.** Every fact needed for §0's
tables is in `sqlite_master`: the inbound foreign keys, their `ON DELETE` action, the triggers. A
`blast_radius(conn, table, where_clause) -> Vec<(table, action, rows)>` helper is perhaps 40 lines
and would serve `prune_storage`, `bulk_delete_personas`, `delete_all_*`, every retention sweep and
every future one. **It does not exist**, so every confirmation in the app names one table because
naming more is work nobody has done once. `personas.rs:1826-1876` deletes personas one at a time in
a loop and never asks what goes with each.

**Gap 3 — The preview token exists once and is `Option`-shaped.** D9. Four other preview→apply
pairs (`preview_bundle_from_clipboard`, `preview_competitive_import`, `healthcheck_credential_preview`,
`skill_files_install_preview`) have nothing, and the two flag-based pairs — `consolidate_contexts`
and `repair_cross_refs` — recompute the plan on the apply invocation with no way to notice that
`dev_contexts` moved in between. **The mechanism is written, tested by its own error strings, and
adopted at 1 of 6 sites.**

**Gap 4 — A failed preview does not disable anything.** `SkillInstallModal.tsx:143` renders the
diff banner under `{preview?.targetExists && …}`, so a **failed** preview and a **clean** preview
are the same pixels — no banner — and the install button is live in both. `ContextMapHealth`
renders its confirm under `confirming && plan`, which is better by accident (the button is only
reachable once a plan exists). There is no shared affordance for "we could not compute this", which
is the same absence [`aggregate-count-display` §8 Gap 1](./aggregate-count-display.md) found for
counts, one layer up. **6 of 6 repos in the cohort (§6 clause 4).**

**Gap 5 — The census cannot express any of the four gaps above.** It ratchets a count of something
present. "This preview and this action are different computations" is a relation; "this confirm
does not name the cascade" is an absence; "this plan carries no token" is an absence; "nothing
disables the button" is an absence. The one *present* thing in the leaf — a return type that cannot
carry a quantity — is already ratcheted from a neighbouring leaf, so §9 is a measured decline. The instrument the
other four need is not a regex: it is `blast_radius()` from Gap 2 plus a test per preview→apply
pair asserting the two receive the same inputs — the shape `repair_cross_refs` achieves by
construction, having only one.

**Gap 6 — There is no shared confirmation primitive that can hold a plan.** `ConfirmDialog` takes
`body: string`. Every number in §0 is interpolated into prose by the call site, so nothing can
require that the number came from a plan, and nothing can render a per-table breakdown even where
one exists. `ascent`'s `ConfirmAction` (§6 clause 5) is the cohort's answer: five pure copy
builders, a doctrine on the `body` field, and a test that pins the collateral-damage sentence by
name. **Adopting that shape is the cheapest fix in this document and reaches all 69 confirmation
sites.**

---

## 9. The missing gate — **a reasoned DECLINE, with the measurement that forced it**

**Nothing here should be merged into `scripts/census/rules.json`.** The one condition in this leaf
that is countable in local syntax is **already gated**, and I proved it by running the neighbour's
own pattern rather than by reading its title.

### What I built, and why it must not ship

**The condition:** *an operation whose scope the caller did not enumerate answers with a value that
cannot carry a quantity — `bool` or unit — so neither before the act nor after it can anyone learn
how many things it touched* (P6). The candidate signal was a `#[tauri::command]` whose name declares
a set-scoped mutation (`export|import|purge|prune|cleanup|sweep|consolidate|migrate|backfill|rebuild|restore|reindex|resync|revoke_all|bulk_|delete_all|remove_all|clear_all|discard_all|archive_all|reset_all|apply_`)
returning `Result<bool, AppError>` or `Result<(), AppError>`.

It validated cleanly. **5 matches in 2 files**, precision **5/5** hand-read; a positive control on
the same verb family returning a quantity at **21 in 13**; two independent implementations entering
the declaration from opposite ends agreeing exactly on membership; all **13** induced faults exiting
1. Then the overlap check killed it:

| neighbour rule | its files | **file** overlap with my 2 | **site** overlap with my 5 |
|---|---:|---:|---:|
| **`opaque-artifact-outcome`** ([`portable-export-bundle`](./portable-export-bundle.md)) | **2** | **2/2 (100%)** | **5/5 (100%)** |
| `unreportable-bulk-outcome` ([`bulk-command-variant`](./bulk-command-variant.md)) | 10 | 1/2 (50%) | **2/5**, both `export_selective*` |
| `outcomeless-tick` · `untyped-command-payload` · `discarded-guard-verdict` · `privately-reclassified-failure` · `unconsented-irreversible-door` · `retention-delete-by-status-allowlist` · `default-contradicted-by-backfill` | 8 / 40 / 7 / 15 / 12 / 3 / 1 | **0/2 each** | 0/5 each |

`opaque-artifact-outcome` carries **`baseline: { files: 2, matches: 5 }`** — the identical numbers —
and its five sites are `export_full`, `export_selective`, `export_selective_to_path`,
`export_credentials`, `export_persona`: mine, exactly. Its earning case is
`export_credentials`, measured on 2026-08-16 against a read-only copy of the same database, at the
same 0-of-25. **My rule is that rule with a longer verb list.** The doctrine records a gate correctly
declined at 83% file overlap; this is 100% site overlap with a matching baseline. Shipping it would
double-count five sites and give the registry two ratchets that can never disagree.

### The decline is itself the finding, three ways

**(1) Two composers reached the same five sites from different leaves, by different reasoning, and
independently measured the same defect at the same magnitude.** That is corroboration of
`opaque-artifact-outcome` of a kind a single author cannot manufacture — its §9 argues from *data
movement* (a bundle crosses the process boundary opaquely), mine from *unenumerated scope* (nobody
chose what went in), and both land on `Ok(true)` over an empty array. Recorded here rather than
re-gated.

**(2) The broader verb family found ZERO additional sites, and that is a positive result about this
codebase.** My pattern extended the neighbour's `export|import|backup|restore|dump` prefix with
`purge`, `prune`, `cleanup`, `sweep`, `consolidate`, `migrate`, `backfill`, `rebuild`, `reindex`,
`resync`, `bulk_`, `delete_all`, `remove_all`, `clear_all`, `discard_all`, `archive_all`,
`reset_all`, `revoke_all` and `apply_` — **19 additional verbs, 0 additional violations.** Measured
over the same 564 files:

> **Of the 26 set-scoped mutation doors in the command tree, every single destructive and applying
> one reports a quantity** — `prune_storage → PruneResult`, `delete_all_memories → usize`,
> `delete_all_messages → usize`, `delete_all_manual_reviews → usize`,
> `bulk_delete_personas → Vec<BulkDeleteOutcome>`, `bulk_retry_dead_letter_events → BulkDeadLetterOutcome`,
> `backfill_schedule → BackfillResult`, `cleanup_dead_trigger_events → TriggerCleanupResult`,
> `apply_bundle_import → BundleImportResult`, and twelve more. **All 5 that cannot are exports.**

So P6 is not a diffuse habit in this repo; it is a **localised property of the export family**, and
the neighbour that owns exports already owns the ratchet. A composer arriving at this leaf later
should not re-derive it a third time.

**(3) The way I nearly got this wrong is the reportable part.** My first overlap table — published
in the draft of this document — read **0% for both `opaque-artifact-outcome` and
`unreportable-bulk-outcome`**. It was measured against the file set of an *intermediate* candidate
signal (a broader `Result<bool>` scan that matched 7 files) rather than against the final rule's
2 files, and reported at the **file** level, which is a coarse metric when a rule touches two files.
The doctrine tells you to verify the *count* through a second implementation; I did, twice, and both
implementations were right. **Nobody told me to verify the overlap through a second implementation,
and the overlap was the number that decided whether the rule should exist at all.** Offered upward
as a doctrine addition: *measure overlap at the site level, against the final rule, after the
pattern stops changing — a rule can be perfectly measured and still be a duplicate.*

### The instrument this leaf actually needs, specified rather than pretended

The four conditions that remain (§8 Gaps 1–4) are **a relation and three absences**, and the census
can express none of them by construction. Do not write a regex for them; build these:

1. **`blast_radius(conn, table, where_clause) -> Vec<(child_table, on_delete, rows)>`** — Gap 2.
   Reads `sqlite_master` for inbound foreign keys and their `ON DELETE` action and counts the rows
   each will take. Roughly 40 lines. `prune_storage`, `bulk_delete_personas`, the three `delete_all_*`
   doors, all five retention sweeps and every future destructive door become one call each. This is
   the single artifact that turns §0's 3.29× and 207× into numbers the product can render, and its
   absence is why every confirmation in the app names exactly one table.
2. **A test per preview→apply pair asserting both receive the same inputs** — Gap 1. Five pairs
   exist. `repair_cross_refs` needs no such test because it is one function, which is the point:
   **the test is only necessary where the merge did not happen.** Note the trap
   [`client-rule-mirroring`](./client-rule-mirroring.md) documents — a test that lives beside one
   side of the pair is a third copy, not a check; this test must construct one input and drive both
   entry points with it.
3. **A `PreviewToken` newtype and the closed two-variant apply input** (§4 T2) — Gap 3. Not a gate;
   a type that makes "previewed but unverified" unspellable, which is what the twenty runtime lines
   at `bundle.rs:88-110` currently detect.
4. **A shared confirm primitive that takes a plan, not a string** — Gap 6. `ascent`'s
   `ConfirmAction` (§6 clause 5) is the cohort's proven shape: pure copy builders, a doctrine on the
   body field, and a test pinning the collateral-damage sentence by name. This reaches all **69**
   confirmation sites and is the cheapest fix in this document.

**Where a gate would execute, when one is written.** `npm run census:check` runs inside
`npm run check` **and** as the `golden-path-census` **pre-push** job in `lefthook.yml`. That matters:
`ci.yml` is red on 10 pre-existing failures, so a gate that only runs in CI runs nowhere.

### Three further conditions refused, with the measurement behind each

1. **A destructive confirmation whose count comes from a client array.** The leaf's most *visible*
   defect and I could not discriminate it. Measured: **69** confirmation-copy sites interpolating a
   quantity across 43 files. Hand-classified, the count-bearing subset splits roughly **2 bad : 6
   legitimate** — `memories.length` and `drive.entries.length` against `removableIds.length`,
   `ids.length`, `draftIds.length`, `selected.size`, `referenceBoard.length`, `stale.length`, every
   one of which is the user's own selection or a fully-owned client collection where `.length` is
   the *correct* source. ~25% precision, against a corpus standard that correctly declined 22% and
   44%. **The discriminator is whether the array is the operation's scope, and that is not in the
   local syntax.** [`aggregate-count-display` §9](./aggregate-count-display.md) declined the same
   family at ~20% from the other direction; two independent refusals is the finding, and Gap 6's
   primitive is the instrument that reaches it instead.
2. **A command whose IPC signature accepts a parameter its body discards** — D3's exact mechanism.
   Built and run: **15 matches in 6 files**, of which **14 are `_app`, `_state` or `_window`** —
   Tauri-injected handles the *caller never supplies*, which is not the condition. Precision on "a
   caller-supplied input is silently dropped" is **1/15 = 6.7%**, and the one true positive is
   `preview_execution`'s `_use_case_id`. A population of one is not a ratchet and a 6.7% gate fires
   almost entirely on correct code.
3. **A preview whose plan carries no token** (Gap 3) is an **absence**, which the census cannot
   assert by construction. Matching the six preview struct declarations would then require a bounded
   negative lookahead over each multi-line struct body to prove no `*_id`/`hash`/`as_of` field
   exists — the nested-quantifier backtracking hazard the doctrine names — for a population of six.
   Item 3 of the specification above is the honest instrument.

---

## 12. Corrections to the brief

1. **`sides: "client"` is wrong, and so is the way `twoSided: true` sits beside it.** Every load-bearing
   finding is on the server: the 3.29× cascade is a foreign key, the 207× cascade is a foreign key,
   `export_credentials`'s 0-of-25 is a Rust loop, the twelve dry-run flags are Rust parameters, all
   five sites of the §9 condition are Rust return types, and the exemplar to copy (`repair_cross_refs`) and the
   unique mechanism worth defending (`apply_bundle_import`'s token) are both Rust. The client half
   is real but derivative — it renders numbers the server hands it, and its own best instance
   (`ContextMapHealth.tsx`) is good precisely because it renders a server plan and computes
   nothing. **Recommend `sides: "both"`.** This is the **fourth** leaf to report `sides: "client"`
   contradicted by its own measurement, which by the doctrine's own standard is now a pattern in
   the spine rather than four accidents — and the **fifth** is being written in the same batch:
   [`ai-draft-preview-apply`](./ai-draft-preview-apply.md), a different domain and a different
   subdomain, reports the identical contradiction in its own §12.1. Two composers finding the same
   label wrong on the same day, on unrelated leaves, is not two accidents.
2. **The brief's central hypothesis is confirmed and is not the strongest thing here.** *"A preview
   computed by different code than the action is a second implementation"* — confirmed at
   `skill_files_install_preview` (four divergences, one of them an effect the installer is
   structurally incapable of), and independently reproduced in a sibling repo where the two
   implementations' populations provably differ (§6 clause 2). But the sharper finding is the
   opposite case: **`prune_storage` shares the literal SQL string between its count and its delete —
   the strongest form of "same code path" available — and is still wrong by 3.29×.** Sharing the
   predicate is not sharing the effect. The generalisation to carry forward is P2, not P1, because
   P1 tells you to merge two functions and P2 tells you that merging them was not enough.
3. **"A delete confirmation says 100 and deletes 6,535 — cite it, extend it."** Cited, verified
   still live, and **extended in a direction that partly inverts it**: its two sibling dialogs, in
   the same product, with byte-identical copy, are **correct** (Reviews 194:194 from a server
   `GROUP BY`; Messages 0:0 from a real count). So the memories dialog is an outlier, not a
   pattern — and the *pattern* is elsewhere: the agents dialog, whose count is **right**, destroys
   15,958 rows. **The corpus's canonical instance of this leaf is a count-provenance bug that
   [`aggregate-count-display`](./aggregate-count-display.md) already owns; this leaf's own defect
   class is the one where the count is correct.**
4. **"`export_credentials` exports zero and returns `Ok(true)`" — confirmed, quantified, and its
   cause is not what it sounds like.** 0 of 25, because 134 of 134 connector definitions are
   `is_builtin` and every credential's `service_type` is one of them. The skip is **deliberate and
   documented**. The defect is that a 100% skip and a full export are the same return value, and
   that generalises to **5 doors** — of which the four `export_*` siblings write bundles whose
   contents nobody enumerated. **The predicate is right; the report is the defect** — the same
   relationship as correction 2.
5. **"A retention sweep deletes nothing today, and enabling it removes ~6,700 rows."** The
   direction is right; the number is **4,941**, and it belongs to
   [`retention-and-pruning`](./retention-and-pruning.md), which measured it first. What this leaf
   adds is not another count: it is that **there is no preview surface for any of the five sweeps,
   no settings UI for any retention key (0 references in `src/features/settings/**` and 0 in
   `en.json`), and a log line that fires only when the count is non-zero** — so "deleted nothing"
   and "never ran" are the same output. And a composition consequence neither path had stated: the
   allow-list fix must land **after** the preview, not before (§6 (iv)).
6. **"The naive repair would silently flatten `paused` and `errored` into `active`" — the argument
   survives; the fact does not, and correcting it makes the argument stronger.** Replayed:
   `status NOT IN ('active','disabled')` returns **0** on this install, so nothing would be
   flattened *today*. Those values are legal and unpopulated — the flattening is **latent**, and it
   is latent in the worst way: a count preview shows **26** for the correct repair and **26** for
   the destructive one, so the day someone pauses a trigger is the day the preview starts lying
   without changing. That is exactly P5's warrant and I would not have stated it as sharply if the
   brief's version had been true.
7. **"`optimize-assets.mjs --dry-run` and the backfill's dry-run default are the *good*
   instances — measure what they do differently."** Measured, and the answer is that neither is
   this leaf's best instance and one of them is barely an instance. `optimize-assets.mjs` is a
   report-only script with no apply path in the same process (`:69` — *"To convert, install sharp
   and run without --dry-run"*), so it cannot diverge because there is nothing to diverge from.
   `backfill-prose.mjs`'s `DRY` is opt-in, not default. **The repo's real good instances are
   `repair_cross_refs` (one function, safe default, self-asserting postcondition, and a doc comment
   that says why) and `apply_bundle_import` (the only preview→apply token in six repos)** — and
   neither was in the brief.
8. **A methodological correction to my own first pass, in the doctrine's own terms.** My first
   census pattern and my first verifier both used a permissive line window between
   `#[tauri::command]` and `fn`, and both therefore skipped past one declaration into the next —
   producing a match count that looked reasonable while naming the wrong function *and* the wrong
   line. The two agreed on the count and were both wrong, because I wrote both from the same mental
   template of "a command is an attribute followed by a function". The disagreement that exposed it
   appeared only after I rewrote the verifier to **enter from the return type and walk left**.
   Confirming the doctrine's rule from a second leaf: **two implementations are independent only if
   they enter the construct from different ends.** The restricted window — and the fact that the two
   implementations still reported *different line numbers* for the same five sites — is what remains
   of that lesson.
9. **A second methodological correction, and the more important one: my §9 rule was a duplicate, and
   my first overlap table said it was not.** The draft of this document published a table reading
   **0% overlap** against `opaque-artifact-outcome` and `unreportable-bulk-outcome`. Both figures
   were wrong. The rule I validated matches **the same five declarations, in the same two files,
   with the same `baseline: { files: 2, matches: 5 }`** as
   [`portable-export-bundle`](./portable-export-bundle.md)'s `opaque-artifact-outcome` — 100% site
   overlap — and it is now declined (§9). The cause was procedural and is worth naming precisely:
   **I measured overlap against the file set of an *intermediate* candidate signal, at the *file*
   level, before the pattern had stopped changing.** Every doctrine rule about verifying a *count*
   through a second implementation was followed and every one of them held; none of them is about
   the number that decides whether the rule should exist. **Offered upward as a doctrine addition:
   measure overlap at the SITE level, against the FINAL pattern, after it stops changing — a rule
   can be perfectly measured, hand-verified at 5/5 precision, survive all thirteen fault
   inductions, and still be a rule that already exists.**
10. **And the decline produced a better result than the rule would have.** Extending the neighbour's
   verb prefix by **19 verbs** (`purge`, `prune`, `cleanup`, `sweep`, `bulk_`, `delete_all`,
   `apply_`, …) found **zero** additional violations across 564 files. So the honest statement is
   not "this repo under-reports set-scoped mutations" but **"every destructive and applying door in
   this command tree already reports a quantity; the five that cannot are all exports"** — a
   sharper claim than the rule would have carried, reached only by refusing to ship it.
