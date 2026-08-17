# Golden path — Partial update semantics

> Situation node: `data-persistence/repository-access/partial-update-semantics` ·
> [situation spine](../situation-spine.md) · recurrence **149** · risk high ·
> dimensions **function · code-quality · resilience** · **two-sided** (the wire shape and the SQL shape
> are one decision seen from two ends).
> Composed 2026-08-14 from a ground-truth sweep against `master`.
>
> **Sweep size.** Every `.rs` file under `src-tauri/` (**963**, `target/` and `.claude/worktrees/`
> excluded) parsed with a brace-matching scanner. **All 238 `Option<Option<T>>` occurrences across 30
> files were classified by syntactic position** — none left as "other" — and the classification
> reconciles **exactly** with an independent regex census (§9). Plus: all 109 `COALESCE(?N, …)` sites
> re-measured and narrowed to the 97 that are the partial-update idiom; the `double_option`
> deserializer and its 42 field uses; both `crud_update!` invocations and all 66 `push_field_param!`
> calls that carry a nested option; the ts-rs bindings the 10 patch structs generate; and Tauri
> 2.11.2's own `CommandItem` deserializer, read from the vendored crate source. Shared numbers are
> cited from [`shared-facts.json`](../shared-facts.json), not re-derived. **No `cargo` was run** — every
> claim below is static and traceable to a file read during composition.
>
> **A convergence sweep** ran read-only against `brainiac` (Rust · sqlx · Postgres), `vibeman`
> (TS · better-sqlite3) and `personas-cloud` (TS · better-sqlite3). It **split this path's subject in
> two**: the three-state *requirement* was independently reinvented in two of three siblings and the
> *trap* was independently fallen into by three of three — but the `Option<Option<T>>` *spelling* has
> **zero trace anywhere**. Every load-bearing sibling claim was re-read by hand (§6).
>
> **This document corrects a premise it was handed.** See the box below §1.
>
> The **Deviations** section is a fix backlog and contains two live, shipped data-loss defects.

## 1 Trigger

- "How do I let the user *clear* this field?" / "the X button doesn't unset it"
- "I only changed one field and it wiped the others"
- "Should this be `Option<T>` or `Option<Option<T>>`?"
- "Does `null` mean skip or clear here?" / "what do I send for 'don't touch this'?"
- "I set it to null and it came back on reload"
- "Switching the mode was supposed to unlink the old one and it's still there"

If you are about to type `field: Option<Option<T>>`, `COALESCE(?1, column)`, `#[serde(default,
deserialize_with = "double_option")]`, `push_field_param!(input.x, …)`, or a TypeScript
`x?: string | null` that feeds an update command — you are in this situation.

### Scope — what this path owns, and the correction to the seam

[repository-crud-surface](./repository-crud-surface.md) drew the seam and it holds: that path owns a
repo function's **exterior** (verb, handle, error type, return type); this one owns **how each field
of a partial update spells leave-alone versus set-to-NULL**, and how that spelling survives the IPC
boundary and the type generator.

> **⚠ The evidence cited for the seam is false, and it was handed to me as a premise. Correcting it
> prominently, because it changes what the gap actually is.**
>
> `repository-crud-surface` §1 and Gap 3 state that `push_field!` / `push_field_param!` **"cannot
> express set-to-NULL at all"** because they key on `Option::is_some`, and that `crud_update!`
> "still cannot express 'clear this column', which is the sibling's whole subject." **Measured: they
> can, and they do, in production, today.**
>
> `push_field_param!(… , clone)` expands to `if let Some(ref v) = $field { … params.push(Box::new(v.clone())) }`
> (`db/src/macros.rs:45-51`). When `$field` is `Option<Option<String>>`, `v` binds to
> `&Option<String>`, and `Option<String>` implements `ToSql` — so `Some(None)` pushes the column into
> the `SET` list **and binds SQL NULL**. **66 call sites do exactly this** (64 `clone`, 2 `copy`).
> `crud_update!` has two invocations and **both** drive nested options through it:
> `resources/teams.rs:47-64` maps all **8** of `UpdateTeamInput`'s `Option<Option<T>>` fields as
> `clone`/`copy`, and `resources/credentials.rs:317-328` maps `metadata: clone`.
>
> The real gap is narrower and more useful: **the kind vocabulary decides whether a column gets a
> clear lane, and nothing connects that choice to the column's nullability.** `clone` and `copy`
> carry the inner `Option` through; `bool` (`*v as i32`) and `as_str` (`v.as_str()`) **do not
> compile** through it. So in `teams.rs` the author had to type `enabled: bool`, and `enabled`
> therefore has no clear lane — correct here, because the column is `NOT NULL`, but arrived at by a
> macro-expansion constraint rather than by reading the schema. See Gap 2.
>
> **The seam itself survives, on the test that path stated empirically**: `teams.rs` gets the whole
> exterior right *and* the interior right, while the IPC layer above it and the UI above that get the
> interior catastrophically wrong (§7). The interior is genuinely a separate procedure.

**Not this path:** whether the write reports that the row existed is
[repository-crud-surface](./repository-crud-surface.md). Whether a column is nullable *at all* is
[schema-change](./schema-change.md); whether the read struct's field type honours that nullability is
[persisted-model-struct](./persisted-model-struct.md). **Those two are upstream of this one and the
dependency is real**: a partial update cannot have a clear lane for a `NOT NULL` column, so
`persisted-model-struct`'s `Option<T>`-iff-nullable rule is the input to every decision here. Whether
the whole update is atomic with the next write is [transaction-boundary](./transaction-boundary.md).

## 2 The one way

**Decide, per field, whether the column can legitimately be NULL. If it cannot, the field is
`Option<T>` and there is no clear lane. If it can, the field is `Option<Option<T>>`, it lives on a
named patch struct — never on a bare command argument — and it carries
`#[serde(default, deserialize_with = "double_option")]` plus `#[ts(optional)]`.** Those two
attributes are not decoration; they are the only thing that makes the three states reachable at the
two boundaries the value must cross. `double_option`
(`core/src/models/serde_util.rs:24-30`) restores the distinction serde erases — **absent → `None`
(leave alone), `null` → `Some(None)` (clear), value → `Some(Some(v))` (set)** — and `#[ts(optional)]`
makes ts-rs emit `field?: T | null`, the only TypeScript type that can express all three. Then let
`push_field_param!(input.field, "column", sets, idx, params, clone)` build the `SET` clause: the
outer `Option` gates whether the column is touched, the inner one becomes the bound value, and
`Option<T>`'s `ToSql` binds NULL. **Never spell "leave alone" as `COALESCE(?N, column)` on a nullable
column** — that construction makes the column permanently unclearable, and it is the one mistake all
three sibling repos also made (§6). **Never spell "clear" as `Some("")`** — an empty string is a
legitimate value for most text columns and the sentinel is unrecoverable once a user types one.
Then stop: one spelling per field, chosen from the column's nullability, stated once.

### The two-sided contract

The three states must survive **two** serialisation boundaries, and this repo loses them at a
different one on each side. Read this table before choosing a shape.

| Where the field lives | What reaches Rust | Can it clear? |
|---|---|---|
| **bare `Option<Option<T>>` command argument** | Tauri's `deserialize_option` returns `visit_none()` for an **absent** key *and* delegates an explicit `null` to serde_json, which also visits none — **both become the outer `None`** | **No.** `Some(None)` is unreachable from any JSON payload. The clear branch below it is dead code. **69 arguments** |
| **patch-struct field, no `double_option`** | plain serde: `null` and absent both → outer `None` | **No.** Same collapse, one layer in. **14 fields** on `Deserialize` structs |
| **patch-struct field with `double_option`** | absent → `None`; `null` → `Some(None)`; value → `Some(Some(v))` | **Yes** — and now `null` is *dangerous*, because it is no longer a synonym for "skip" |
| …and its **ts-rs binding**, without `#[ts(optional)]` | `field: T \| null \| null`, which TypeScript collapses to a **required** `T \| null` | The generated type makes "leave alone" **unrepresentable** and invites `null` for every unmentioned field — i.e. it invites erasing the row. **42 fields / 9 structs** |

**Rows 1 and 4 are opposite failures of one cause and both are live.** Row 1 makes clear impossible;
row 4 makes clear the *default a caller is typed into*. The repo has been bitten by both — row 1 in
the workspace-knowledge pilot, row 4 in the persona editor — and fixed each exactly once (§6).

Verified against `tauri-2.11.2/src/ipc/command.rs:133-144`, read from the vendored crate:

```rust
fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Self::Error> {
  match &self.message.payload {
    InvokeBody::Json(v) => match v.get(self.key) {
      Some(value) => value.deserialize_option(visitor),   // null -> visit_none
      None => visitor.visit_none(),                       // absent -> visit_none
    },
    …
  }
}
```

`#[serde(deserialize_with = …)]` is a **field** attribute with no argument-position equivalent, so
there is no way to fix row 1 in place. The patch struct is not a style preference; it is the only
place the hook can be attached.

### Which clauses are physics, which are this house

Per the [contract](../golden-path-contract.md) and the
[portability test](../research/portability-test.md), a clause travels only if something else
reinvented it. Measured 2026-08-14 against three siblings; detail and citations in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **A nullable column needs three states, and they must be modelled explicitly** | **physics — independently reinvented twice** | `personas-cloud` encodes it per field in Zod as `.nullable().optional()` (79 optional / 39 nullable, and the split tracks the DDL's nullability field-for-field, `schemas.ts:124-141`); `vibeman` filters `value !== undefined` at one chokepoint so `null` reaches the column and `undefined` does not (`repository.utils.ts:158`). **`personas-cloud` reached the same conclusion about the same entity**: its `PersonaUpdateSchema` marks `description`, `icon`, `color`, `modelProfile`, `maxBudgetUsd`, `maxTurns`, `designContext`, `groupId` three-state — nearly field-for-field the same set Personas marks `double_option` |
| **Presence, not value, is the discriminator** | **physics — and `personas-cloud` has the strongest form** | `db.ts:572` / `:1178` iterate an allowlist and probe `if (key in updates)`. `in` is strictly stronger than `!== undefined`: it survives an explicitly-passed `undefined`, and it maps JSON's exactly-two states onto the DB's exactly-two semantics with nothing left over. **`double_option` is the Rust transcription of that same idea** — it is the only mechanism in either language that asks "was the key there?" rather than "what was the value?" |
| **`COALESCE(?N, col)` on a NULLABLE column makes it permanently unclearable** | **physics — a convergent TRAP, 3 of 3 siblings** | `brainiac`: `console.rs:795` `resolution_note = COALESCE($3, resolution_note)` on a nullable column, plus `standards.rs:358-359` `.or_else(|| before.rationale)`. `vibeman`: 3 sites (`scanQueue.core.repository.ts:305-306`, `schema-intelligence.repository.ts:281`) — **documented as intentional** at `:288-289` and **inverting that repo's own chokepoint convention**. `personas-cloud`: `db.ts:841` `payload = CASE WHEN ? IS NOT NULL THEN ? ELSE payload END`. **Nobody escapes this. It is the single most reinvented mistake in the sweep** |
| **More than one meaning for `null` inside one data layer is a defect** | **physics — every sibling has ≥2, Personas has 3** | `vibeman` has exactly two, in contradiction: `null` clears everywhere `buildUpdateQuery` runs and preserves in its 3 COALESCE sites. `personas-cloud` has two: `key in updates` (correct) in 2 updaters, `??` / null-as-absent (6 sites) in the other 2. Personas has **three** and they are not ranked anywhere |
| **`Option<Option<T>>` as the spelling** | **house convention — ZERO trace in any sibling** | `brainiac` (Rust, the only same-language oracle): **0 occurrences** of `Option<Option<`, **0** uses of `serde_with`, **0** tri-state enums. It reached the *problem* and simply never built a mechanism. Mark this clause as local calibration: what travels is "model the three states", not "nest the options" |
| **A tri-state sentinel enum (`Patch::{Leave,Clear,Set}`)** | **nobody built it — do not invent it** | 0 in all three siblings and 0 here. Three codebases independently decided the language's own absent/null distinction was the right carrier. A bespoke enum would be the first of its kind, which is evidence against it |
| **One chokepoint that owns the predicate** | **ergonomics — and the sibling's structural win** | `vibeman`'s `buildUpdateQuery` is **one** `value !== undefined` serving **19 of 54** repository files through the factory. Personas re-decides the predicate per module across **107** repo modules, which is why it has three spellings. This is the same root cause `repository-crud-surface` found from its side |
| **`Some("")` means clear** | **house convention — a one-off, and wrong** | 1 function, 3 call sites (`notification_subscriptions.rs:158-167`). No sibling uses an in-band sentinel of any kind. An empty string is a legal value for a text column, so the sentinel is lossy by construction |

## 3 Mandated primitives

**Exist today — use them:**

- **`core/src/models/serde_util.rs:24` `double_option`** — the three-state deserializer, with the
  contract in its own doc comment and a unit test at `:36-48` proving all three states. Pair it with
  `#[serde(default, …)]`; **all 42 uses correctly carry `default`**, and without it an absent key is
  a deserialization *error* rather than "leave alone". This is the primitive; it is not optional.
- **`db/src/macros.rs:44` `push_field_param!(field, "col", sets, idx, params, clone|copy)`** —
  builds the `SET` fragment and binds the parameter in one call. **On an `Option<Option<T>>` it emits
  set-to-NULL correctly** (see the correction box in §1). 66 sites rely on this. `bool` and `as_str`
  do **not** compile through a nested option — that is the constraint, not a bug.
- **`db/src/macros.rs:250` `crud_update!`** — generates the whole update function including the
  partial `SET` and the refreshed-row return, and handles nested options through its `clone`/`copy`
  kinds. Two invocations (`teams.rs:47`, `credentials.rs:317`), and `teams.rs` drives 8 nullable
  fields through it. Reach for this before hand-writing.
- **`#[ts(optional)]`** (ts-rs 10.1.0) — emits `field?: T` instead of `field: T | null`
  (`ts-rs-10.1.0/src/lib.rs:314-317`; the implementation strips exactly one `Option` layer,
  `ts-rs-macros/src/types/named.rs:107-119`). On an `Option<Option<T>>` field it therefore emits
  **`field?: T | null`** — the correct three-state TypeScript type. **The repo uses it 30+ times
  elsewhere and on ZERO of the 42 fields that need it** (§7).
- **`src/commands/infrastructure/dev_workspaces.rs:330-370` `KnowledgeStructurePatch`** — the
  reference implementation of the whole backend half, whose doc comment names this exact defect.
  **Copy this shape.** See §6.
- **`src/api/agents/personas.ts:362-460`** — the reference implementation of the frontend half:
  the nullable-field list, the payload type that reintroduces optionality, and the builder that
  **omits** rather than nulls. See §6.

**Do not exist — this path names them:**

- **A shared TypeScript patch type.** `PersonaUpdatePayload` (`personas.ts:393-395`) is
  `Omit<T, Nullable> & Partial<Pick<T, Nullable>>` — exactly right, hand-written once, for one of ten
  structs, and only after a data-loss incident. Nine structs pass the raw ts-rs binding to `invoke`.
- **Any link between a column's nullability and its patch field's shape.** Nothing checks that a
  `double_option` field sits over a nullable column, or that a `NOT NULL` column's field is a plain
  `Option`. Both directions are silent (Gap 2).

## 4 Steps

1. **Read the column's DDL first.** `grep -n "<column>" src-tauri/db/src/migrations/`. If it is
   `NOT NULL`, stop — the field is `Option<T>`, there is no clear lane, and adding one is a runtime
   constraint violation waiting to happen. If it is nullable, continue.
   [persisted-model-struct](./persisted-model-struct.md) owns this determination; you are consuming it.
2. **Ask the type-over-gate question here, before writing the signature.** Three of them:

   | Instead of | Write | What it removes permanently |
   |---|---|---|
   | `#[tauri::command] fn update_x(…, field: Option<Option<T>>)` | a `struct XPatch` argument whose field carries `#[serde(default, deserialize_with = "double_option")]` | the IPC collapse — a bare argument physically cannot carry the hook, a struct field always can |
   | `pub field: Option<Option<T>>` on a `#[derive(TS)]` struct | the same field plus **`#[ts(optional)]`** | the `T \| null \| null` binding, and with it the hand-written `PersonaUpdatePayload` adapter |
   | `SET col = COALESCE(?1, col)` on a nullable column | `push_field_param!(input.col, "col", …, clone)` | a permanently unclearable column, and the second, contradictory meaning of `null` in the same layer |

   **This is the highest-leverage step in the document.** Steps 1–2 done right make §9's rule
   ratchet to zero; §9 only counts what step 2 was skipped for.
3. **Write the patch struct**, one per update command, in `core/src/models/<entity>.rs` next to the
   entity. `UpdateTeamInput` (`core/src/models/team.rs:45-71`) is the shape: plain `Option<T>` for
   `NOT NULL` columns, `#[serde(default, deserialize_with = "double_option")] Option<Option<T>>` for
   nullable ones, and the two classes visibly interleaved so a reader can see the distinction.
4. **Take it as ONE argument** on the command: `pub fn update_x(state: …, id: String, patch: XPatch)`.
   Do not spread its fields back out — that is the defect, re-created.
5. **Build the `SET` clause with `push_field_param!`**, kind `clone` for anything heap-allocated and
   `copy` for scalars. If you reach for `bool` or `as_str` on a nullable field it will not compile;
   that is the macro telling you the kind vocabulary has no nested form — convert to `clone` on an
   owned value rather than flattening the field.
6. **Regenerate the binding and read it.** `cargo test -p personas-core export_bindings`, then open
   `src/lib/bindings/XPatch.ts`. **If you see `| null | null`, you forgot `#[ts(optional)]`** and the
   frontend has just been handed a type that invites erasing the row.
7. **On the frontend, omit — never null — the fields the caller did not name.** Type the payload so
   omission is legal (`Partial<Pick<…>>`), and build it with `if (key in partial)`, not with
   `partial.x ?? null`. `personas.ts:437-448` is the loop to copy. `personas-cloud`'s `key in updates`
   (`db.ts:572`) is the same idea in the same position in a different codebase (§6).
8. **Write the test that fails today.** Three assertions, on the struct, in one function:
   absent → `None`, `null` → `Some(None)`, value → `Some(Some(v))`.
   `db/src/repos/core/personas.rs:2671-2791` is the model and its comment block is the best
   documentation in the repo. **Put it where it runs**: `npm run test:rust` passes `--lib` against the
   root manifest, so a test in `personas-db` or `personas-core` is written, merged and never executed
   locally — which is precisely how that test sat failing unnoticed (`personas.rs:2684-2686`). Use
   `npm run test:rust:crates`; `ci.yml:275` runs `--workspace`.
9. **Stop.** One spelling per field. Do not add a `COALESCE` "for safety", do not accept `""` as a
   clear, and do not leave a second update path for the same table.

## 5 Anti-patterns

- **A bare `Option<Option<T>>` on a `#[tauri::command]` — 69 arguments across 14 commands.** The
  clear branch beneath it is unreachable and therefore dead. The most legible instance is
  `src/commands/infrastructure/dev_tools/goals.rs:69-71`, which *documents the affordance it cannot
  deliver*:
  ```rust
  // Manual goal↔KPI link (UAT F-MAJOR-15). Some(Some) links, Some(None)
  // unlinks, None leaves untouched.
  kpi_id: Option<Option<String>>,
  ```
  `Some(None)` cannot arrive. **The KPI cannot be unlinked from the UI.** All 14 commands forward to
  repository functions that implement the clear correctly — the backend half is already right and
  has been all along.
- **Nulling every field you did not mean to change — the inverse defect, and it destroys data.**
  `src/features/agents/sub_connectors/components/automation/AutomationsSection.tsx:61-80` pauses an
  automation like this:
  ```ts
  // Origin's UpdateAutomationInput requires every field nullable. We only
  // want to flip deploymentStatus — null everything else to "do not change".
  name: null, description: null, useCaseId: null, platformWorkflowId: null,
  platformUrl: null, webhookUrl: null, platformCredentialId: null,
  credentialMapping: null, inputSchema: null, outputSchema: null, …
  ```
  Nine of those are `double_option` fields, so `null` means **clear**. Pausing an automation erases
  its webhook URL, its credential binding, its credential mapping, its input and output schemas and
  its platform ids. The comment is wrong, and it is wrong *because the generated type said so* — see
  the next entry.
- **Letting ts-rs flatten the patch type — 42 fields, 9 structs, 9 binding files.** ts-rs emits
  `description: string | null | null` for `Option<Option<String>>`, which TypeScript normalises to a
  **required** `string | null`. The type therefore says: *you must supply this key, and `null` is the
  way to not supply a value* — the exact opposite of the wire contract. Worse, a three-state field
  and a two-state one become **visually identical** after normalisation, so no reader can tell
  `UpdateTeamInput`'s `color: string | null` (plain, `null` = skip) from its
  `icon: string | null | null` (three-state, `null` = clear). Both live defects in this section trace
  to a developer reading that type and believing it.
- **Explaining the semantics in a comment that is false.** `src/api/devTools/devTools.ts:96-112`
  states the contract **four separate times** — *"`null` clears, `undefined` leaves untouched"*,
  *"a string SETS … `null` CLEARS"*, *"String SETS, null CLEARS, undefined leaves"* — for a command
  whose arguments are bare and therefore cannot clear.
  `src/features/teams/.../TeamWorkspacePane.tsx:20-22, :124-126` asserts the opposite falsehood:
  *"description lacks the double_option deserializer, so an emptied field is treated as 'unchanged'"*
  — `UpdateTeamInput.description` carries it (`core/src/models/team.rs:52-53`). **Two comments, two
  directions, both wrong, because in both cases the type could not be consulted.**
- **`COALESCE(?N, column)` as the leave-alone mechanism — 97 sites, 68 of them in the repo layer.**
  It is compact and it is a one-way door: once a column's only update path routes through
  `COALESCE`, no value exists that sets it back to NULL. Legitimate over a `NOT NULL` column,
  silently lossy over a nullable one, and **the SQL string alone cannot tell you which** (§9
  refusal 3). Every sibling repo made this mistake independently (§6).
- **An in-band sentinel — `Some("")` means clear.** `notification_subscriptions.rs:154-167`'s
  `merge_clearable` is the repo's third spelling, used 3 times in 1 module. It is unique, it is
  undiscoverable, and it cannot round-trip: a user who legitimately enters an empty template body
  gets a NULL, and a caller that wants to clear a numeric column has no sentinel at all. This is in
  the module `repository-crud-surface` §6 names as the whole-repo reference implementation — the
  exterior is exemplary and the interior is the worst of the three.
- **Three spellings in one data layer, unranked.** `Option<Option<T>>` (238 occurrences),
  `COALESCE(?N, col)` (97), `merge_clearable` (1×3). Nothing in `CLAUDE.md`,
  `.claude/conventions.json`, or `db/src/repos/mod.rs` says which to reach for. Every sibling has at
  most two and at least one of them documented (§6).
- **Spreading a patch struct back into positional arguments.** `dev_tools.rs` `update_project` takes
  **18** parameters, 13 of them `Option<Option<&str>>`, and every adjacent pair is swappable at the
  call site while still compiling. The command above it takes the same 18. `crud_update!` takes an
  input struct precisely to close this, and `teams.rs:47` proves it works.

## 6 Evidence

**Distribution — all 238 `Option<Option<T>>` occurrences, classified by syntactic position.** A
brace-matching parser assigned every one; the sum is exact, with nothing in a residual bucket.

| Position | Count | Verdict |
|---|---:|---|
| `#[tauri::command]` parameter (14 commands, 6 files) | **69** | **broken — clear unreachable** |
| repository / helper fn parameter (18 fns, 5 files) | **74** | correct — downstream of the commands above |
| patch-struct field **with** `double_option` (10 structs) | **44** | correct in Rust; **all 42 exported ones lie in TypeScript** |
| patch-struct field **without** `double_option` (5 structs) | **28** | 14 on `Deserialize` structs → same collapse; 14 internal |
| local binding, return type, static | 12 | n/a |
| comment line | 11 | n/a |
| **total** | **238** | |

Other spellings: `COALESCE(?` = **109** across 29 files, of which **97 across 24 files** are the
partial-update form `COALESCE(?N, <column>)` over 65 distinct columns — **68 in `db/src/repos`**, 22
in `src/commands`. `merge_clearable` = **1** function, **3** call sites. ts-rs bindings containing
`| null | null` = **9** across **8** files. Fields carrying `#[ts(optional)]` anywhere: 30+; fields
carrying it **and** `double_option`: **0**.

- **`src/commands/infrastructure/dev_workspaces.rs:330-370` — copy this for the backend half.**
  Its doc comment is the clearest statement of the defect anywhere in the repo, written by whoever
  hit it:
  ```rust
  /// Patch body for `set_structure`. A bare `Option<Option<T>>` command arg
  /// CANNOT express "clear" over IPC: serde matches an explicit JSON `null`
  /// at the OUTER option first, collapsing it to "leave alone" — the P2 pilot
  /// hit exactly this (5 promoted principles silently kept their governors).
  /// The `double_option` deserializer restores the three states: field absent
  /// = leave alone, `null` = clear, value = set.
  #[derive(serde::Deserialize)]
  #[serde(rename_all = "camelCase")]
  pub struct KnowledgeStructurePatch {
      #[serde(default, deserialize_with = "double_option")]
      layer: Option<Option<String>>,
      #[serde(default, deserialize_with = "double_option")]
      governing_id: Option<Option<String>>,
  }
  ```
  **Two things make this the most important citation in the document.** First, the fix was applied to
  exactly **one** command. Second, **the same file contains five unfixed bare arguments** —
  `dev_tools_workspace_update` (`:52-57`) and `dev_tools_workspace_knowledge_update` (`:177-186`) —
  so the defect, its diagnosis, its fix, and five live instances of it coexist within 300 lines.
  A third blemish: it declares a **private local copy** of `double_option` at `:345-351`, while
  `core/src/models/serde_util.rs` exists and its module doc says the helper was created because the
  function *"was previously duplicated per-module … That's the exact drift a shared helper exists to
  prevent."* The drift recurred in the file that documents the bug.
- **`src/api/agents/personas.ts:362-460` — copy this for the frontend half**, and read its comment
  block as the incident report it is. It names the ts-rs limitation exactly — *"the generated binding
  cannot express that, because ts-rs flattens `Option<Option<T>>` to `T | null | null`"* — and then
  reconstructs the missing type by hand:
  ```ts
  export type PersonaUpdatePayload =
    Omit<UpdatePersonaInput, PersonaNullableField> &
    Partial<Pick<UpdatePersonaInput, PersonaNullableField>>;
  ```
  The rationale at `:404-413` is the fullest account of the failure the repo has: the builder *"used
  to write `field: partial.field !== undefined ? partial.field : null` for every nullable column …
  That was correct before `double_option` existed … Once `double_option` was added … the meaning of
  every one of those nulls silently inverted to `Some(None)`, and any caller passing a genuinely
  partial update … **wiped the other twelve columns**."*
- **`db/src/repos/core/personas.rs:2671-2791` — the only test of this contract in the tree**, and
  its header records the second-order failure: *"When that attribute was added the test began failing
  and was not noticed, because `personas-db` unit tests are not in the documented gate."* It asserts
  all three states (`:2718`, `:2755`, `:2770-2788`) and names the consequence in the assertion
  message — *"absent `{field}` must deserialize to None (skip), or a partial update silently clears
  the column"*. **557 `#[test]` functions exist in the repo layer and this is the one.**
- **`db/src/macros.rs:44-51` + `resources/automations.rs:182-189`** — the mechanism, and its use.
  `push_field_param!(input.use_case_id, "use_case_id", sets, param_idx, param_values, clone)` where
  `use_case_id: Option<Option<String>>`: `Some(None)` adds `use_case_id = ?N` and binds `None`, which
  rusqlite writes as SQL NULL. **This is both the correct primitive and the exact mechanism of the
  data loss in §7** — the backend does precisely what it was asked; the ask was wrong.
- **`resources/teams.rs:47-64`** — `crud_update!` driving 8 nullable fields, which is the evidence
  that refutes §1's inherited premise. Note `enabled: bool` sitting among them: the kind that cannot
  carry a nested option, on the one column in the struct that is `NOT NULL`. Correct, and correct by
  coincidence of the macro's constraint rather than by consulting the schema.

### Convergence — what three sibling repos did without reading this

Run 2026-08-14, read-only. Every load-bearing claim below was re-opened and re-read by hand after the
sweep reported it; all agree and are marked ✓. **The result splits this path's subject in two and I
did not expect it to.**

- **✓ The mechanism is NOT convergent — `brainiac` is a clean zero.** The only same-language sibling
  (Rust · sqlx · Postgres, 148 `.rs` files, 68,537 lines) has **0** occurrences of `Option<Option<`,
  **0** uses of `serde_with`, **0** `QueryBuilder`, **0** dynamically-built `SET` clauses, and **0**
  tri-state enums. Of its 43 production `UPDATE` statements, **43 have a fixed, compile-time-constant
  `SET` list**. It reached the problem and never built a mechanism: `StandardPatch`
  (`library/standards.rs:287-297`) is plain `Option<T>` fields merged in Rust with
  `unwrap_or_else(|| before.x)` for `NOT NULL` columns and **`.or_else(|| before.x)` for nullable
  ones** (`:349`, `:358-359`) into a fixed all-columns `UPDATE` (`:373-378`) — so `rationale` and
  `detail_md` **cannot be cleared through the API at all**, and the HTTP layer collapses the question
  before it can be asked (`server/src/library.rs:968-984`, bare `Option<String>`).
  **Per the contract, mark `Option<Option<T>>` as local calibration, not doctrine.**
- **✓ …but the REQUIREMENT is convergent, and one sibling reached it about the same entity.**
  `personas-cloud`'s `PersonaUpdateSchema` (`packages/orchestrator/src/schemas.ts:124-141`) marks
  `description`, `icon`, `color`, `modelProfile`, `maxBudgetUsd`, `maxTurns`, `designContext`,
  `groupId` as `.nullable().optional()` and everything else as bare `.optional()` — and cross-checked
  against its own DDL (`db.ts:233-252`), **the split tracks column nullability field for field**.
  That is Personas' `double_option` set, independently derived, in a different language, for the same
  domain object. `.nullish()` appears **0 times in either TS sibling** — both authors deliberately
  spelled the two modifiers separately rather than collapsing them.
- **✓ `personas-cloud` has the strongest predicate in the sweep, and it is `in`.**
  `packages/orchestrator/src/db.ts:572` and `:1178`:
  ```ts
  for (const [key, col] of Object.entries(columnMap)) {
    if (key in updates) { … fields.push(`${col} = ?`); values.push(val); }
  }
  ```
  `in` asks about **presence**, so it survives an explicitly-passed `undefined` where
  `!== undefined` does not. It is the JS analogue of `double_option`: both refuse to infer intent
  from the value. Applied in only 2 of its 4 partial updaters, though — the other two fall back to
  `??` and null-as-absent at 6 sites (`db.ts:985,988,989,990,1070,1072`).
- **✓ `vibeman` is the structural win, and the number is the finding.** `buildUpdateQuery`
  (`src/app/db/repositories/repository.utils.ts:150-168`) is **one** predicate —
  `if (!excludeFields.includes(key) && value !== undefined)` — reached by **19 of 54** repository
  files through `createGenericRepository`. Personas re-decides the same predicate in every one of
  **107** repo modules, which is the mechanical reason it has three spellings and `vibeman` has
  (nearly) one. **This is the same root cause `repository-crud-surface` §7 found from its own side:
  there is no primitive to adopt, only a directory.** One blemish worth not copying: line 163 is
  `values.push(value === undefined ? null : value)` — a dead branch, unreachable because line 158
  already excluded `undefined`, and it reads as though the function does the opposite of what it does.
- **✓ The TRAP is convergent — 3 of 3 siblings, 3 stacks, same mistake.** Every sibling has at least
  one nullable column that its own API cannot clear: `brainiac` `console.rs:795`
  (`resolution_note = COALESCE($3, resolution_note)`) and `standards.rs:358-359`; `vibeman`
  `scanQueue.core.repository.ts:305-306` and `schema-intelligence.repository.ts:281`;
  `personas-cloud` `db.ts:841` (`payload = CASE WHEN ? IS NOT NULL THEN ? ELSE payload END`).
  **`vibeman`'s is the sharpest, because it is documented as deliberate and it contradicts that
  repo's own convention** — `scanQueue.core.repository.ts:288-289`: *"`scanId`/`resultSummary` are
  COALESCE'd so passing null preserves any existing value rather than nulling it out"*, in a data
  layer where `null` clears everywhere else. **A convergent idiom can be a shared trap; this is one,
  and §2's prohibition on `COALESCE` over a nullable column is the best-warranted clause here.**
- **✓ "More than one meaning for `null` per layer" is convergent too, and Personas is worst.**
  `vibeman` 2 (in contradiction), `personas-cloud` 2 (correct in 2 updaters, conflating in 2),
  Personas **3**. No sibling has three.
- **Nobody documents it.** `brainiac`: 0 matches for "tri-state", "three-state", "explicit null",
  "leave alone" across 1,457 `.md` files; the closest is a doc comment at `standards.rs:284-286` —
  *"Every field is a patch: `None` means 'leave it alone'"* — which does not mention clearing.
  `vibeman`: exactly one piece of prose on the subject, and it documents the *inverted* convention.
  `personas-cloud`: one, and it says *"setting only the provided fields"* without ever defining
  "provided". **Personas is the only repo in the sweep with a written contract
  (`serde_util.rs:10-23`) — and the only one that then contradicts it in four call-site comments
  (§5).** Having the doctrine written down did not, on its own, hold the line.
- **Zod ratios, for the record.** `vibeman` 111 `.optional()` / 12 `.nullable()` / 0 `.nullish()`;
  `personas-cloud` 79 / 39 / 0. `vibeman`'s ~9:1 means its correct chokepoint is largely
  **unreachable from its HTTP boundary** — the data layer can clear, the schemas never let a `null`
  through. A capability nobody can invoke is the same as not having it, which is worth remembering
  before celebrating Personas' 44 correctly-attributed fields.

## 7 Deviations found

### P0 — shipped, user-visible, data-destroying

| Path | Defect |
|---|---|
| `src/features/agents/sub_connectors/components/automation/AutomationsSection.tsx:61-80` | Pausing or resuming an automation sends `null` for **9 `double_option` fields** — `useCaseId`, `platformWorkflowId`, `platformUrl`, `webhookUrl`, `platformCredentialId`, `credentialMapping`, `inputSchema`, `outputSchema`, `errorMessage`. `push_field_param!(…, clone)` (`resources/automations.rs:182-289`) binds each as SQL NULL. **Toggling an automation's status erases its entire wiring.** The in-code comment says the nulls mean "do not change"; it was written from the generated type, which says so. |
| `src/features/teams/sub_teamWorkspace/teamStudio/TeamWorkspacePane.tsx:123-139` | Saving the team workspace pane sends `canvas_data: null`, `team_config: null`, `icon: null`, and `description: null` whenever description is unchanged. All four are `double_option` (`core/src/models/team.rs:51-58`) routed through `crud_update!` (`resources/teams.rs:47-64`). **Saving workspace settings wipes the team's canvas layout, config, icon and description.** The file's own comments at `:20-22` and `:124-126` assert `description` "lacks the double_option deserializer" — it does not. |

### P0 — shipped, silently inert

| Path | Defect |
|---|---|
| **69 arguments / 14 commands / 6 files** (§9 baseline) | A `#[tauri::command]` takes a bare `Option<Option<T>>`, so `Some(None)` never arrives and every clear affordance behind it is dead. `dev_tools_update_project` (13), `dev_tools_update_kpi` (9), `dev_tools_update_context` (9), `dev_tools_update_goal` (6), `dev_tools_update_context_group` (5), `dev_tools_update_idea` (5), `dev_tools_update_task` (5), `twin_update_profile` (5), `dev_tools_workspace_knowledge_update` (3), `dev_tools_workspace_update` (2), `dev_tools_update_use_case` (2), `dev_tools_set_milestone_item` (2), `twin_update_channel` (2), `dev_tools_update_scan` (1). |
| `src/features/plugins/dev-tools/sub_projects/ProjectModal.tsx:166-176` | The live symptom of the row above. *"Mode is mutually exclusive at the data layer: team mode nulls the connector, standalone nulls the team binding"* — it computes `effectiveTeamId = sourceMode === 'team' ? teamId : null` and the mirror for `prCredentialId`, then submits both through `dev_tools_update_project`'s bare arguments. **Neither null lands, so a project keeps its old team binding after switching to standalone and its old PR credential after switching to team. The two modes are not mutually exclusive at the data layer, and the UI says they are.** |
| `src/api/devTools/devTools.ts:96-112` | States the clear contract four times in comments for a command that cannot honour it, and types the parameters `string \| null` accordingly. **The frontend half of this path is written correctly against a backend that cannot receive it.** |

### Structural

- **42 `double_option` fields across 9 exported structs carry no `#[ts(optional)]`**, so every one
  generates `T | null | null` — 9 occurrences across 8 files in `src/lib/bindings/`. **9 of the 10
  patch structs pass that raw binding straight to `invoke`** (`api/pipeline/teams.ts:28`,
  `api/vault/credentials.ts:26`, `api/pipeline/triggers.ts:26`, `api/agents/automations.ts:35`,
  `api/auth/connectors.ts:22`, `api/agents/tools.ts:28`, `api/network/identity.ts:70`, plus
  `UpdateExposedResourceInput`). Only `UpdatePersonaInput` has an adapter, added after the incident.
  **This single missing attribute is upstream of both P0 data-loss defects.**
- **14 `Option<Option<T>>` fields on `Deserialize` structs with no `double_option`** —
  `UpdateN8nSessionInput` (`core/src/models/n8n_session.rs:182-189`, 7) and its command-side twin
  `UpdateN8nSessionParams` (`src/commands/design/n8n_sessions.rs:75-82`, 7). Same collapse as a bare
  argument, one layer in: the nesting is written, the hook is not, so the type promises three states
  and delivers two. `UpdateBuildSession` (`core/src/models/build_session.rs:480-494`, 12 fields) is
  internal-only and unaffected.
- **A private copy of `double_option`** at `src/commands/infrastructure/dev_workspaces.rs:345-351`,
  duplicating `core/src/models/serde_util.rs:24` — in the file whose doc comment explains the bug the
  shared helper exists to prevent.
- **97 `COALESCE(?N, column)` sites over 65 distinct columns**, 68 of them in `db/src/repos`. No
  audit exists of which target a nullable column; each one that does is an unclearable column.
- **One test.** `personas.rs:2671` is the only assertion of the three-state contract in 557 repo-layer
  `#[test]` functions, it covers one of ten structs, and it sat failing unnoticed because its crate
  is outside `npm run test:rust`'s `--lib` scope.
- **No entry in `.claude/conventions.json`** for `double_option`, `Option<Option`, `COALESCE`, or
  partial-update semantics — and the machine-readable gate file is what a subagent reads
  ([`feedback_machine_readable_repo_gates`](../../../CLAUDE.md)). The rule exists only as prose in
  `serde_util.rs`'s doc comment, which is exactly where the four contradicting comments in §5 prove
  it does not reach.

### Second pass — what is upstream of all of it

Re-reading the deviations together: 69 bare arguments, 42 flattened bindings, 14 hookless fields,
two data-loss defects and four mutually contradictory comments are not independent mistakes.

> **The three states are decided in Rust and consumed in TypeScript, and the generator between them
> cannot carry the decision.**

`double_option` is applied correctly 42 times. `push_field_param!` writes NULL correctly 66 times.
The backend is, on this axis, **right**. Then ts-rs erases the distinction on the way out — `T | null
| null` — and every consumer is left to reconstruct it from prose. One consumer did, once, after
losing data (`personas.ts`). Two did not and lose data now. Fourteen commands never had the
distinction to begin with, and their frontends wrote the correct three-state TypeScript against a
backend that cannot receive it — **the two halves of this repo are each correct and they do not
meet**. That is why *Prefer a type over a gate* below argues for one attribute rather than for more
rules: the missing gate is not a missing check, it is a missing character in a generated file.

## 8 Gaps in the primitive

1. **`#[ts(optional)]` and `double_option` are two unrelated attributes that must always co-occur,
   and nothing says so.** They live in different systems (ts-rs vs serde), are written on different
   lines, and omitting either silently produces a type or a deserializer that disagrees with the
   other. 42 of 42 fields have the serde half; 0 of 42 have the ts half. A single derive macro —
   `#[nullable_patch]` expanding to both — would make the pair unforgettable; it does not exist.
2. **Nothing connects a patch field's shape to its column's nullability, in either direction.** A
   `double_option` field over a `NOT NULL` column produces a runtime constraint violation reachable
   from the UI; a plain `Option<T>` over a nullable column silently removes a clear lane the product
   needs. Both are invisible to `cargo check`, and the join that would detect them — `CREATE TABLE`
   text to struct field — is the same cross-tree relation `persisted-model-struct` and
   `schema-change` each own one half of. **This is the highest-value unbuilt instrument in this
   document** and it is nobody's leaf today.
3. **`push_field_param!`'s kind vocabulary silently decides whether a column has a clear lane.**
   `clone` and `copy` carry a nested option; `bool` (`*v as i32`) and `as_str` (`v.as_str()`) do not
   compile through one. So a nullable `BOOLEAN` column cannot be cleared through the macro at all,
   and the author discovers this as a type error with no explanation. Two missing arms
   (`clone_opt` / `bool_opt`) would close it.
4. **A bare command argument cannot carry a serde attribute, and nothing warns.**
   `#[serde(deserialize_with = …)]` is a field attribute; Rust accepts the argument, Tauri accepts
   the argument, `cargo clippy -D warnings` accepts the argument, and the clear lane is simply gone.
   **69 arguments shipped through every gate this repo has.**
5. **ts-rs has no notion of a "patch" type.** `#[ts(optional)]` is the closest primitive and it is a
   per-field opt-in that happens to do the right thing on a nested option — it was not designed for
   this, its doc says *"may be applied on a struct field of type `Option<T>`"*, and nothing marks the
   nested case as the intended use. The generated `T | null | null` is not even a warning; it is a
   valid TypeScript type that means something different from what it says.
6. **`npm run test:rust` cannot run the only test that covers this.** It passes `--lib` against the
   root manifest, so `personas-core` and `personas-db` tests are written, merged, and never executed
   locally. `personas.rs:2684-2686` records the consequence in its own comment: the test failed for
   an unknown period and nobody saw. `npm run test:rust:crates` and `ci.yml:275` do run it — the gap
   is that the documented command does not.
7. **No shared TypeScript patch type.** `Omit<T, Nullable> & Partial<Pick<T, Nullable>>` is the right
   shape and exists once, hand-maintained, with a hand-maintained field list
   (`PERSONA_NULLABLE_FIELDS`) that no tool checks against the Rust struct. If `#[ts(optional)]`
   lands, this type and its list both become deletable — which is the argument for doing it that way
   rather than writing eight more adapters.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md), answered explicitly before §9 is written.
**Yes — and the primary answer is one attribute on 42 fields, which is the cheapest fix proposed in
any golden path so far.**

1. **`#[ts(optional)]` on all 42 `double_option` fields.** ts-rs strips exactly one `Option` layer for
   this attribute (`ts-rs-macros/src/types/named.rs:107-119`; documented at
   `ts-rs-10.1.0/src/lib.rs:314-317`), so an `Option<Option<T>>` field becomes **`field?: T | null`**
   — the only TypeScript type that expresses absent / null / value. This makes "leave alone"
   representable, makes the three-state and two-state fields **visually distinct** in the generated
   file, and makes `AutomationsSection.tsx`'s object literal a **type error** rather than a data-loss
   bug, because the nine keys it nulls would no longer be required. It also deletes
   `PersonaUpdatePayload`, `PERSONA_NULLABLE_FIELDS` and their hand-maintained drift. **One attribute,
   42 lines, one binding regeneration, and both P0s in §7 become uncompilable.**
2. **A patch struct per update command makes the IPC collapse unrepresentable.** A bare argument
   cannot carry the deserializer; a struct field always can. `KnowledgeStructurePatch`
   (`dev_workspaces.rs:330-343`) is the working precedent *in this repo*, and it also fixes the
   18-positional-argument problem `repository-crud-surface` §5 counts from its side — **one change,
   two paths' deviations**. This is the migration §9 ratchets.
3. **The chokepoint is the structural version, and a sibling has run the experiment.** `vibeman`'s
   `buildUpdateQuery` owns the predicate **once** for 19 of 54 repositories; Personas re-decides it in
   107 modules and consequently has three spellings. A Personas-shaped version is
   `push_field_param!` — which already exists and already handles nested options correctly — plus the
   two missing kind arms from Gap 3, made the *only* documented way to build a `SET` clause. That
   converts the 97 `COALESCE` sites from an idiom into a migration.
4. **Where a type cannot reach.** Nothing in the type system relates a field's shape to its column's
   nullability (Gap 2) — that needs the schema, and it is the one instrument this document wants and
   cannot build from a signature. And no type can stop a `COALESCE(?N, col)` string; that is text,
   and §9 refuses to gate it for a reason it can show.

## 9 The missing gate

### The semantic condition, stated first

> **An update carries "leave this field alone" and "set this column to NULL" on the same wire slot,
> with no mechanism that distinguishes an absent key from an explicit null — so one of the two states
> is silently unreachable, and which one is invisible at the call site.**

Stack-free: every stack that transmits a partial update has exactly two encodings available (absent,
null) for three intents, and must therefore choose a discriminator. Per the
[portability test](../research/portability-test.md) the *proxy* below does **not** travel — an
adopting repo re-derives its own signal against its own idiom: a Zod `.optional()` that should be
`.nullable().optional()`, an `Object.entries(patch).filter(v => v != null)`, a
`COALESCE($n, nullable_col)`, an ORM patch type that drops undefined keys. All three siblings have
this condition; none of them would score above zero against this pattern (§6).

### Checked first: is this already gated?

All rules in `scripts/census/rules.json` were read (**41 at the start of composition, 42 at final
validation — a parallel composer merged one mid-session**). **None keys on `Option<Option<`,
`double_option`, `COALESCE`, or a command's argument *types* at all.** The four adjacent rules and
why each misses:

- `blind-identity-write` (35/82, same subdomain) — whether the write reported that the row **existed**.
  Orthogonal: a write can report the row perfectly and still have written NULL over data.
- `untimed-repo-query` (36/245) — a **missing timer**.
- `untyped-command-payload` (40/104) — a command's **return** type being `serde_json::Value`. This
  path's condition is on the **argument** side, and its rule's `[^{]{0,900}?` span terminates at the
  return arrow.
- `nullable-default-column` (4/27) — a **DDL** column carrying `DEFAULT` without `NOT NULL`
  (owner: [persisted-model-struct](./persisted-model-struct.md)). It is the *upstream* half — whether
  the column can be NULL — where this is *how you get it there*. Complementary, not overlapping.

**This condition is ungated.**

### The proxy, and what it keys on

A parameter of a `#[tauri::command]` function whose type is a bare `Option<Option<T>>`.

**Precision is 100% by construction, and the construction is the argument.** `#[serde(default,
deserialize_with = "double_option")]` is a **field** attribute; Rust has no argument-position
equivalent. Therefore every bare `Option<Option<T>>` argument is deserialized by serde's default impl,
and Tauri's own `deserialize_option` (`tauri-2.11.2/src/ipc/command.rs:133-144`, quoted in §2) returns
`visit_none()` for both an absent key and an explicit `null`. **`Some(None)` cannot arrive. There is
no exception, so there is no allowlist.**

**Shape of the match set:** 69 matches across 6 files, **one per parameter** (not per command), every
one a distinct `(file, line)` pair. **Zero** matches inside a `#[cfg(test)]` module.
`commentMatchesSkipped: 0`. The count reconciles **exactly** with the independent brace-matching
parser that produced §6's 238-site classification — two implementations, one number, which is the
only reason to trust either.

**How the pattern chains, and the three false-positive families it excludes by construction.** A
match begins either at the `#[tauri::command]` attribute (seeding that command's first nullable
parameter) or at a **preceding `Option<Option<`** (chaining to the next parameter in the same
signature), and ends via lookahead just before the next one — so consecutive parameters each count
rather than the whole command counting once. The tempered `[^{]` span cannot cross a brace, which is
what stops a chain entering a function body, entering a struct body, or escaping one signature into
another. The chaining branch alone over-matched by exactly 8 (77/8 vs 69/6); all three causes were
opened, read, and excluded by **guard tokens**, not by an allowlist:

- `src/commands/design/n8n_sessions.rs:75-82` — `UpdateN8nSessionParams`' 7 consecutive struct fields
  chained to each other (6 spurious matches). Excluded by the `\bpub\b` guard. *(These fields are a
  genuine defect of a different shape — §7 — and the rule deliberately does not claim them.)*
- `src/commands/infrastructure/dev_workspaces.rs:339-341` — **`KnowledgeStructurePatch`, the
  compliant construction**, chaining field to field (1 spurious match). Excluded by the
  `double_option` guard. **The rule must not count the fix as the bug**, and this is the guard that
  guarantees it.
- `src/commands/infrastructure/context_generation.rs:2066-2067` — two adjacent `let mut x:
  Option<Option<String>>` locals (1 spurious match). Excluded by the `;` and `\blet\b` guards.

**Known residual FP class, stated honestly:** two consecutive **private, attribute-free**
`Option<Option<T>>` struct fields would still chain. **Measured today: zero such structs exist under
`src-tauri/src`** — the only two candidates are `DispatchContext` (`src/engine/dispatch.rs:104`) and
`SkillMatrixRow` (`src/companion/knowledge_ops.rs:49`), each of which has exactly one such field and
so cannot chain. A ratchet tolerates a latent FP; it does not tolerate an undisclosed one.

**Precondition, stated so it can be checked before porting:** this repo declares IPC entry points as
free functions annotated `#[tauri::command]` whose arguments are deserialized one key at a time, and
spells the tri-state as a nested option. A repo that takes one request body per endpoint, or models
the tri-state as a Zod `.nullable().optional()` or a `key in patch` probe, has the **same condition
in markup this pattern cannot see** and scores zero — as all three siblings do.

### Mechanism — a census rule, not a script

Per the [contract](../golden-path-contract.md) §"Don't write a script", the ratcheting-baseline
mechanism already exists at [`scripts/census/`](../../../scripts/census/). This path publishes **one**
entry, merged by the orchestrator — never edited into `rules.json` here:

```json
{"rules":[
  {
    "id": "ipc-collapsed-nullable-patch",
    "goldenPath": "docs/concepts/golden-paths/partial-update-semantics.md",
    "title": "A #[tauri::command] takes a bare Option<Option<T>> argument, so \"clear this column\" collapses into \"leave it alone\" at the IPC boundary and can never be sent",
    "roots": ["src-tauri/src"],
    "extensions": [".rs"],
    "signal": {
      "pattern": "(?:#\\[tauri::command\\b[^{]{0,3000}?|Option\\s*<\\s*Option\\s*<(?:(?!\\bpub\\b|\\blet\\b|\\bfn\\b|\\bstruct\\b|double_option|;)[^{]){0,600}?)\\b[a-z_]\\w*\\s*:\\s*(?=Option\\s*<\\s*Option\\s*<)",
      "flags": "g",
      "ignoreCommentLines": true,
      "description": "a parameter of a #[tauri::command] function whose type is a bare Option<Option<T>>. PROXY FOR the stack-free condition: an update operation carries \"leave this field alone\" and \"set this column to NULL\" on the same wire slot with no mechanism that distinguishes an ABSENT key from an explicit null, so one of the two states is silently unreachable. The match starts at the #[tauri::command] attribute (seeding that command's first nullable parameter) or at a preceding Option<Option< (chaining to the next parameter in the same signature) and ends via lookahead just before the next one, so consecutive parameters each count. The tempered [^{] span cannot cross a brace, which is what guarantees a chain never enters a function body, never enters a struct body, and never escapes one command signature into another; the pub/let/fn/struct/double_option/; guard tokens exclude the three false-positive families found while refining it - consecutive struct fields (n8n_sessions.rs:75-82), the COMPLIANT double_option patch struct (dev_workspaces.rs:339-341), and adjacent let-bindings (context_generation.rs:2066-2067) - by construction rather than by allowlist. VERIFIED AGAINST tauri 2.11.2 SOURCE, not inferred: CommandItem's Deserializer::deserialize_option (tauri-2.11.2/src/ipc/command.rs:133-144) returns visitor.visit_none() when the argument key is ABSENT, and delegates an explicit null to serde_json's Value deserializer, which also visits none - so both collapse to the OUTER None and Some(None) is unreachable from any JSON payload. A bare fn argument cannot carry #[serde(default, deserialize_with = \"double_option\")] because that is a FIELD attribute with no argument-position equivalent, so precision is 100% by construction: every match is a site where the clear lane is dead code, and there is no legitimate exception and therefore no exclude list. Measured 2026-08-14 at HEAD: 69 parameters across 14 commands in 6 files, zero inside #[cfg(test)], commentMatchesSkipped 0, reconciled EXACTLY with an independent brace-matching Rust parser that classified all 238 Option<Option< occurrences in src-tauri by syntactic position. The dead affordance is documented at the call sites - src/commands/infrastructure/dev_tools/goals.rs:69-71 declares `kpi_id: Option<Option<String>>` with the comment \"Some(Some) links, Some(None) unlinks, None leaves untouched\", and Some(None) can never arrive, so a KPI cannot be unlinked; src/features/plugins/dev-tools/sub_projects/ProjectModal.tsx:166-176 nulls teamId or prCredentialId to make the two source modes mutually exclusive and neither null lands. All 14 commands forward to repository fns that DO implement the clear correctly via push_field_param!(.., clone) (db/src/macros.rs:45-51), which binds the inner Option as SQL NULL - so the defect is entirely at the IPC boundary and the backend half is already right. RESIDUAL FP CLASS, disclosed: two consecutive private attribute-free Option<Option<T>> struct fields would still chain; zero such structs exist under src-tauri/src today (DispatchContext and SkillMatrixRow each have exactly one field and cannot chain). PRECONDITION (must be re-derived per repo): this repo declares IPC entry points as free functions annotated #[tauri::command] whose arguments are deserialized one key at a time, and spells the tri-state as a nested option. A repo that takes one request body per endpoint, or that models the tri-state as a Zod .nullable().optional() (personas-cloud/packages/orchestrator/src/schemas.ts:124-141) or a `key in patch` probe (personas-cloud/packages/orchestrator/src/db.ts:572), has the SAME condition wearing markup this pattern cannot see and scores zero - as all three sibling repos in the convergence sweep do. LEGAL FIX: replace the bare arguments with ONE patch struct whose nullable fields carry #[serde(default, deserialize_with = \"double_option\")] AND #[ts(optional)] - src/commands/infrastructure/dev_workspaces.rs:330-370 (KnowledgeStructurePatch) is the shape to copy, and its own doc comment names this exact defect. Do NOT silence a match by flattening to a single Option<T> - that removes the clear lane on purpose instead of by accident."
    },
    "baseline": { "files": 6, "matches": 69 },
    "floor": 500
  }
]}
```

**Validated standalone before publishing** (`node scripts/census/run-census.mjs --rules
<scratch>/pus-rules-Vk7t.json --check`). Per the tooling note, the pattern was written to a **file**
by a script and never passed through bash argv, where MSYS mangles backslashes:

```
  rule                    files   base  matches   base  walked  floor
  OK   ipc-collapsed-nullable-patch      6      6       69     69     564    500

  census OK — 1 rule(s), 564 file-visits, 69 surviving violation(s) across 6 file(s).
```

`564 walked` is every `.rs` file under `src-tauri/src`; `floor: 500` matches
`untyped-command-payload` and `build-gated-ipc-entrypoint`, the other two rules rooted there, so the
three cannot hold different opinions about whether the command tree is intact. **Merged with the
live registry the run stays green at 43 rules / 114,087 file-visits, and this rule contributes
~1s of the 43s total.**

> **A performance finding worth recording, because it nearly shipped as a 73-second CI regression.**
> The first working version of this pattern used a variable-length **lookbehind**
> (`(?<=#\[tauri::command[^{]{0,3000})…`). It produced the correct 69/6 and took **73 seconds on one
> rule** — V8 re-evaluates a leading lookbehind at every index in every file, so the cost is
> O(filesize × bound). The chained-forward-anchor rewrite above returns the same 69/6 in **0.98s**.
> **If a census pattern must look backwards, restructure it to chain forwards instead.**

**Fault injection against the real tree**, because a gate that cannot fail is not a gate. Each row is
a single-field mutation of the validated rule, run with `--check`:

| Induced fault | Exit |
|---|---|
| baseline, unmutated | **0** |
| matcher matches nothing (`pattern` → `ZZZ_NEVER_MATCHES_ZZZ`) | **1** — `[structural] matched zero files anywhere` |
| floor above the walk (`floor: 5000` on a 564-file root) | **1** — `THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (baseline claims 400 where 69 exist) | **1** |
| count rises (baseline claims 40 where 69 exist) | **1** |
| file count rises (baseline claims 2 files where 6 exist) | **1** |
| renamed root (`src-tauri/src` → `src-tauri/src-x`) | **1** — walked 0, below floor |
| extension no longer describes the tree (`.rs` → `.zzz`) | **1** — walked 0, below floor |
| stale `exclude` entry (a path matching no file) | **1** — `the exemption is stale` |
| **POSITIVE CONTROL — pattern inverted to the COMPLIANT form** | **1** |

**The positive control, and the two populations.** Pointing the same rule, at the same root, at the
*correct* construction — an `Option<Option<T>>` that **does** carry
`#[serde(default, deserialize_with = "double_option")]` — moves the counts to **1 file / 2 matches**
and fails on both drift metrics (`files dropped 6 → 1`). Widened to the whole `src-tauri` tree the
compliant population is **44 matches across 10 files** over 963 files walked — which independently
reproduces the brace-matching parser's `structFieldDO = 44` from §6, a second exact reconciliation.

| | Violating (this rule) | Compliant (positive control) |
|---|---|---|
| at `src-tauri/src` | **69** matches / **6** files | **2** matches / **1** file |
| at `src-tauri` (tree-wide) | 69 / 6 | **44** matches / **10** files |
| **match-level overlap** | \_\_ | **zero** — disjoint by the `double_option` guard token |
| **file-level overlap** | \_\_ | **exactly one**: `src/commands/infrastructure/dev_workspaces.rs` |

The populations are disjoint, differently sized, and differently distributed (violating: all in
`src/commands/infrastructure`; compliant: 8 of 10 files in `core/src/models`), so the matcher is
**discriminating between the two constructions**, not merely matching anything shaped like a nested
option. A rule that matched both would have reported ~16 files / 113 matches and proved nothing. And
the single overlapping **file** is the finding in miniature: `dev_workspaces.rs` holds both the
canonical fix and five unfixed instances of the bug it fixes.

**No `exclude` entries.** There is no legitimate bare `Option<Option<T>>` command argument — the
construction cannot work — so an exemption could only ever be a violation in hiding.

### What this does NOT gate, and why — three refusals

1. **The ts-rs `T | null | null` binding (refused as a census rule; a different mechanism named).**
   The signal is trivially precise — 9 occurrences across 8 files in `src/lib/bindings/`, and ts-rs
   emits that string *only* for a nested option — and it is the condition upstream of **both P0
   data-loss defects**, so refusing it needs a real reason. Two:
   (a) the fix is one attribute on 42 fields (*Prefer a type over a gate* §1), after which the count
   is zero, the runner correctly fails on `zero-matches`, and the engine's own doctrine instructs you
   to **delete** the rule — *"a rule with a one-commit lifetime should never be added"*;
   (b) the right assertion is not a count but a **correctness claim about a generated artifact**, and
   this repo already has the host for exactly that: `src/__tests__/structural/`, where
   `ts-bindings-camelcase.test.ts` asserts a property of every file in `src/lib/bindings/`. **The
   owed work is one `it()` in that file** — *"no generated binding contains `| null | null`; a nested
   option must carry `#[ts(optional)]`"* — which runs under `npm run test`, a gate that actually
   fails, unlike a warn-level lint rule (see *On severity*). Naming the host is the deliverable, not
   a deferral.
2. **"Absence has three spellings" (not countable).** `Option<Option<T>>` (238), `COALESCE(?N, col)`
   (97) and `merge_clearable` (1×3) are each individually *correct in some context*; only their
   **coexistence** is the defect. That is a relational property — *the cardinality of the set of
   mechanisms used across the layer exceeds one* — and a census rule counts occurrences within one
   file. Same shape as `blind-identity-write`'s refusal 3, and the same conclusion.
3. **`COALESCE(?N, column)` over a nullable column (not decidable from the text — and this is the
   honest one).** 97 sites, 65 distinct target columns. Over a `NOT NULL` column the construction is
   **correct** and idiomatic; over a nullable one it makes the column permanently unclearable. **The
   SQL string cannot tell you which**, because the answer lives in a `CREATE TABLE` in a different
   tree — the same join Gap 2 names as the highest-value unbuilt instrument. A rule that flagged all
   97 would be ~70% noise against a baseline nobody could ratchet; a rule that flagged none would miss
   the trap **all three sibling repos fell into** (§6). **Refusing here is a finding, not a
   compromise**: the instrument this condition needs is a schema-joined check that does not exist in
   any of the four repos measured, and building it is worth more than approximating it.

**How the census rule fails loudly when its own precondition is absent** is inherited from the runner
and demonstrated in the fault table: a zero-match run fails structurally rather than reporting a clean
tree; a walk below `floor` fails with *"THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN"*; a drop
without a baseline update fails; and the surviving count prints on success, so a green build log
distinguishes a clean run from one that checked nothing.

**On severity:** the census is a ratchet, not a severity ladder — it fails a run when a count moves.
No argument is made anywhere in this document from warning volume, and none could be: `npm run check`
runs `eslint src/` with no `--max-warnings` and the pre-commit hook runs `--quiet`, so a warn-level
rule enforces nothing at either gate at any count. That is also why refusal 1 routes to a **vitest
assertion** rather than a lint rule — `npm run test` fails; ESLint warnings do not.

## See also

- [Repository CRUD surface](./repository-crud-surface.md) — the exterior of the function whose
  interior this path owns, and the source of the premise corrected in §1.
- [Persisted model struct](./persisted-model-struct.md) — the `Option<T>`-iff-nullable rule that is
  the **input** to every decision here; its `nullable-default-column` rule gates the upstream half.
- [Schema change](./schema-change.md) — where a column's nullability is decided in the first place.
- [Transaction boundary](./transaction-boundary.md) — whether the partial update lands atomically
  with the next write.
- [New IPC command](./new-ipc-command.md) — the argument shape this path constrains, from the wire side.
- [Typed error contract](./typed-error-contract.md) — what a rejected patch should say.
