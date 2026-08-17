# Golden path — Bridge type contract

> Situation node: `backend-runtime/contract-and-validation/bridge-type-contract` · [situation spine](../situation-spine.md)
> `sides: server` · `twoSided: true`, `fusedAcrossSides: false` · recurrence **456** · risk **medium** · convergence **mixed**.
> Merged from `ts-rs binding export` + `IPC payload field naming`.
> Dimensions: **code-quality · ui · function**.
> Composed 2026-08-14 against `master` @ `c90a7e731` from a ground-truth sweep of the **963** `.rs` files
> under `src-tauri/`, the **4,829** `.ts`/`.tsx` files under `src/`, all **1,033** generated binding files
> (plus `serde_json/JsonValue.ts` and the barrel), `ci.yml`, `knip.json`, and the two checkers that guard
> this surface. Every number was produced by a script run against the tree; the two headline signals were
> counted twice by independent implementations that agreed. `src-tauri/target/**` and `.claude/worktrees/**`
> excluded. A **convergence sweep** against `../brainiac`, `../personas-cloud` and `../personas-web`
> **inverted the brief's central hypothesis** — see §6.
> The **Deviations** section is a fix backlog.

> ### ⚠ Five corrections to the brief and to sibling paths — read these first
>
> 1. **The `bigint` gate already exists. Do not publish a second one.** `bigint-binding-field`
>    (`scripts/census/rules.json`, owned by [persisted-model-struct](./persisted-model-struct.md))
>    is baselined at **142 files / 294 matches** and reproduces exactly today. This path therefore
>    *characterises* the blast radius (§7 B) and *routes* to that rule rather than re-gating it.
> 2. **`usize` and `isize` do NOT map to `bigint`.** That rule's own `description` says ts-rs
>    "maps i64/u64/usize/isize to bigint". Measured empirically across the tree: `i64` → `bigint`
>    (`ArtistAsset.file_size`), `u64` → `bigint` (`ToolCallStep.started_at_ms`), but **`usize` → `number`**
>    (`LedgerAnomalyScore.sample_count`, `DbPerfSnapshot.buffer_capacity`), and `isize` does not occur
>    on any exported type. A reader acting on that sentence would rewrite fields that are already correct.
> 3. **"86 of 1,032 binding files are missing from `index.ts`" is true, current at 87 of 1,033 — and
>    harmless.** `grep` for any import resolving to the barrel returns **0 files**. All **853** files that
>    consume a binding import it by direct path. `knip.json:18` additionally excludes
>    `src/lib/bindings/**` from dead-code analysis, which is why nobody noticed. The barrel is a
>    950-line artefact with zero consumers; the defect is its *existence*, not its gaps, and two golden
>    paths currently carry "fix the barrel" as backlog. **Delete it instead** (§7 D1).
> 4. **The orphan import-site count is slightly different from the brief's.** 31 orphans and 28 still
>    referenced are **confirmed exactly**. The reference sites are **29 `import type` lines + 9
>    `export type … from` re-export lines = 38 lines across 16 files**, of which **26 import lines sit in
>    `src/api/**`** — not "30 sites, 27 in `src/api`". Both decompositions are defensible; state which one
>    you mean.
> 5. **The brief's list of un-generatable payloads is incomplete by 44%.** 104 commands returning
>    `serde_json::Value` is confirmed. But **83 more commands return a *named* Rust struct that never
>    derives `ts_rs::TS`**, so ts-rs emits nothing for them either — and **82 of those 83 are called from
>    frontend code**. Total un-generatable success surface: **187 of 1,661 commands (11.3%)**, not 104.
>    This class wears the markup of a properly-typed command and is invisible to the existing
>    `untyped-command-payload` census rule. It is the single largest finding in this sweep (§7 A).

## 1. Trigger

- "Where does the TypeScript type for this Rust struct come from?" / "why is there no binding for X?"
- "TypeScript says this is a `bigint` but the value is obviously a number"
- "I deleted the Rust struct and the app still compiles" / "what is `src/lib/bindings/VaultStatus.ts`?"
- "The backend sends `persona_id` but the type says `personaId`" / "why is this one snake_case?"
- "Should I import from `@/lib/bindings` or `@/lib/bindings/Thing`?"
- "There are two `CrewFitnessReport` types — which one is right?"
- "`cargo test export_bindings` ran clean and nothing changed"

If you are about to type `#[ts(export)]`, `#[ts(type = "…")]`, `#[serde(rename_all = …)]` on a type that
crosses IPC, `#[serde(flatten)]`, `import type { X } from "@/lib/bindings/X"`, `invoke<{ … }>(`, or an
`interface` in `src/api/**` — you are in this situation.

### Scope — the three leaves next to this one, settled in prose

**[`new-ipc-command`](./new-ipc-command.md) owns the procedure**: choosing the wire name, registering in
`generate_handler![]`, the wrapper in `src/api/`, the timeout. It states "return a named struct carrying
`#[derive(TS)] #[ts(export)]`" as a *step*. **This path owns what that step actually produces** — whether
the generated artefact exists, still describes the Rust, and is the thing the consumer imports. Where that
path asks *"which steps will I forget?"*, this one asks *"the file got written; is it still true?"*

**[`persisted-model-struct`](./persisted-model-struct.md) owns the *shape* of a persisted struct** —
`Option<T>` vs `T` against its column, `CHECK IN` vocabularies as enums, `i32` vs `i64` as a *modelling*
decision, and the `rename_all` attribute as one of a container triple. **This path owns the boundary the
shape crosses**: what makes a type crossable at all (a question that has nothing to do with tables — 83 of
the un-crossable types are computed payloads that mirror no row), what the generator emits, and which
declaration a consumer must believe. The two paths overlap on exactly two facts (`bigint`, `rename_all`);
both are already gated by that path's census rules and this one does not re-gate them.

**[`typed-error-contract`](./typed-error-contract.md) owns the *error* half of `Result<T, AppError>`** —
which variant, the serialised envelope, and how the frontend narrows it. **This path owns the `T` half and
nothing about `AppError`.** The seam is clean and worth naming: `AppError` crosses as a **hand-written
`Serialize` impl** (`core/src/error.rs:160-230`), not through ts-rs at all, which is why the error surface
has none of the defects catalogued here — no orphan, no `bigint`, no casing split. That is not luck. It is
what happens when one type owns its own wire format instead of delegating to a generator.

Also adjacent and deliberately not covered: `row-to-struct-mapping.md` (how the struct gets filled),
`schema-change.md` (where the DDL goes), `backend-to-frontend-events.md` (payloads that arrive as events
rather than returns — the same generator, a different transport).

## 2. The one way

**Make the Rust type crossable at the moment you declare it, and then let the generated file be the only
contract anyone reads.** A type crosses when it carries `#[derive(Serialize, TS)]` **and** `#[ts(export)]`
— `Serialize` alone puts it on the wire with nothing describing it, which is the largest defect class in
this leaf. Put `#[serde(rename_all = "camelCase")]` on the container so the emitted field names match the
other 594 exported structs, and know that **`rename_all` does not propagate through `#[serde(flatten)]`**
— a flattened field brings its own casing, which is how the tree's one internally-inconsistent wire type
was made. Keep 64-bit integers off the boundary: ts-rs maps `i64`/`u64` to `bigint` and **nothing that
crosses Tauri IPC can ever be a `bigint`**, so narrow to `i32`/`u32`/`f64` where the value fits (`usize`
is already safe — it emits `number`) or pin with `#[ts(type = "number")]` where it must not. Then run
`cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings` — **all
three flags are load-bearing; without `--workspace --features desktop` zero bindings regenerate and the
run still exits 0** — **open the emitted `.ts` and read it**, and commit it. On the frontend, `import type
{ X } from "@/lib/bindings/X"` by direct path (never the barrel, which nothing imports), and use it as the
`invoke<X>` type argument. Then stop: no local `interface` mirroring a generated type, no inline
`invoke<{…}>` literal, no coercion layer papering over a type you could have fixed in Rust. **And when you
delete or rename a Rust type, delete its binding in the same commit — ts-rs never will, and no gate in
this repo can tell you.**

### The two halves, and the contract between them

`sides: server` with `twoSided: true` means the decision is made in Rust and *paid for* in TypeScript. Three
properties define the contract; each is decided on one side and observed on the other.

| Property | Decided by (Rust) | Observed as (TS) | What breaks when it is wrong |
|---|---|---|---|
| **Existence** | `#[ts(export)]` present, and the type still exists | a file in `src/lib/bindings/` | absent → the consumer hand-authors (187 commands); *stale* → the consumer believes a file nothing produces any more (31 orphans) |
| **Naming** | `#[serde(rename_all)]`, plus every `flatten`ed type's own choice | the emitted field names | 333 of 1,033 bindings are snake_case, 608 camelCase, and 1 is both — so `import` alone does not tell you which convention a payload uses |
| **Value fidelity** | the Rust scalar | `number` vs `bigint` | `bigint` is never what arrives; the consumer coerces (162 sites), guards a dead branch (6 sites), or forks the contract |

**The authoritativeness rule, stated because the repo states it nowhere.**
`.claude/CLAUDE.md:119` says "**Single source of truth: `src/lib/bindings/`**" — but read the sentence: it
is about *where ts-rs writes files*, not about which declaration wins. Nothing in this repo tells a
consumer what to do when a generated type and a hand-written type both exist. So:

> **The generated binding is authoritative about the payload's *shape*. The Rust field type is
> authoritative about the payload's *value*. When the generated type disagrees with the transport, you fix
> Rust. You never fork the contract on the consumer side.**

That second sentence is not pedantry — it is the exact mistake `src/api/companion.ts:706-745` makes, and
the author was *right about the value and wrong about the mechanism*. `SensorySourceState.ts` declares
`totalSignalsCaptured: bigint`; the runtime sends a JSON number; the hand-written
`SensorySourceStateView` says `number` and is **correct**. Forking produced a second contract that will
now drift silently, when narrowing `pub total_signals_captured: u64` to `u32` in
`engine/src/ambient_context.rs` would have fixed it for everyone, permanently, in one word.

### Which clauses are physics, and which are this house

Per the [contract](../golden-path-contract.md) and the [portability test](../research/portability-test.md),
a prescription only travels if something else reinvented it. Read-only sweep of `brainiac` (Rust · utoipa →
`openapi-typescript` — the strong oracle, same problem shape), `personas-cloud` (FastAPI facade + Node
orchestrator) and `personas-web` (Next.js) run 2026-08-14. Details in §6.

| Clause | Warrant | Evidence |
|---|---|---|
| **The generated type is the only contract a consumer reads** | **physics** | `brainiac/console/src/lib/types.ts:1-11` states it explicitly and is the only such statement in the fleet. The counter-evidence is louder than the evidence: the two repos without a generator hand-mirror four links deep and **5 of 6 shared types have drifted** |
| **Every response is a named, generatable type** | **physics** | `brainiac`: **103 of 103** handler returns are a typed `Json<T>`; **0** are `Json<serde_json::Value>`. Personas: 1,474 of 1,661 (88.7%). `personas-cloud` is the counter-example that proves it — **48 FastAPI routes, 0 `response_model`** |
| **One casing, chosen once, applied everywhere** | **physics** | `brainiac` is snake_case end-to-end and no worse for it; `personas-cloud` makes it structural with a single `snakeToCamel()` at its one `mapRow` |
| …but **camelCase specifically** | **house convention** | the direction is arbitrary; what travels is the singularity |
| **64-bit integers must not reach the wire as a 64-bit type** | **physics, and Personas is the outlier** | **No sibling emits `bigint` at all.** `brainiac` maps `i64`/`u64` → `number` with a `/** Format: int64 */` JSDoc; both TS siblings are `number`. Two generators over the same problem chose the safe mapping. ts-rs's `bigint` is the local anomaly |
| …but the JSDoc-comment mitigation | **contradicted** | `brainiac`'s `/** Format: int64 */` carries **zero** enforcement; a value above 2^53 loses precision silently there too. Neither generator solves it; ts-rs at least makes it *visible* |
| **A deleted type must delete its generated artefact** | **physics — and structurally solved elsewhere** | `brainiac`: **0 orphans**, because `openapi-typescript` rewrites one file. See §6 for why this is not the whole story |
| **A single-file emission is therefore the cure** | **CONTRADICTED — see §6** | it cures orphans and creates a *staleness* blind spot Personas does not have |
| **An untyped escape hatch should stay untyped rather than be annotated** | **physics, discovered by the oracle failing** | `brainiac`'s `#[schema(value_type = Object)]` emits `Record<string, never>` — **uninhabitable**. Its *un*annotated `Value`s emit `unknown`, which is narrowable. ts-rs's `serde_json/JsonValue.ts` is a correct recursive JSON type and is the best of the three |
| **A barrel re-export layer for generated types** | **house convention, and a dead one** | no sibling has one; ours has **0 importers** |

## 3. Mandated primitives

**Rust — the crossing itself**

- **`#[derive(… ts_rs::TS …)]` + `#[ts(export)]`** — the pair that makes a type crossable. **990 derives,
  989 with `#[ts(export)]`.** The single deliberate exception is `DevMemory`
  (`core/src/models/dev_tools.rs:1163-1178`), which withholds export with five lines explaining why; it is
  exemplary and is the model for any backend-only type. **`Serialize` without `TS` is not a crossing — it
  is a hole** (§7 A).
- **`#[serde(rename_all = "camelCase")]`** — the casing decision. 594 of 898 exported structs carry it.
- **`#[ts(type = "number")]`** — the escape from `bigint`. **314 field-level pins already exist**;
  `core/src/models/execution.rs:36,38,43,46,55` is the densest cluster.
- **`src-tauri/build.rs:20`** (and `core/build.rs:20`, `db/build.rs:12`, `engine/build.rs:6`) —
  `cargo:rustc-env=TS_RS_EXPORT_DIR=…/src/lib/bindings`. Four crates, four `build.rs`, one destination.
  You inherit this; you do not configure it. The `.cargo/config.toml:14` `[env]` entry is a backstop that
  did **not** reliably reach proc-macro expansion, which is what produced the two-drifting-directories
  incident recorded in `.claude/CLAUDE.md`.
- **`src/lib/bindings/serde_json/JsonValue.ts`** — ts-rs's emission for `serde_json::Value`:
  `number | string | boolean | Array<JsonValue> | { [key in string]?: JsonValue } | null`. **30 binding
  files reference it, 113 field positions.** It is a correct, narrowable JSON type and is *better than
  both siblings' equivalents* (§6). Reach for it when a field genuinely is arbitrary JSON — it is not the
  same thing as returning `Value` from the command.

**The regeneration command — one string, three load-bearing parts**

```
cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings
```

`--workspace` because `--manifest-path` alone selects only `personas-desktop` and ~200 `#[ts(export)]`
types live in `personas-core`; `--features desktop` because without it the tauri build script aborts on a
missing updater permission and **zero** bindings regenerate — while the command still exits 0. Both
failure modes are written out at `.github/workflows/ci.yml:369-386`, which is the best gate documentation
in this repo. **`.claude/CLAUDE.md:116` still prescribes the broken two-flag form.**

**Gates that exist**

- **`.github/workflows/ci.yml:319` Job D `binding-drift`.** Regenerates, then `ci.yml:389-401` checks
  `git ls-files --others --exclude-standard src/lib/bindings/` for **new untracked** bindings, then
  `git diff --quiet` for **modified** ones. **The untracked half is confirmed present and correct today**
  — the brief's report that it was fixed is accurate; the comment at `:390-393` records the verification.
  It catches creation and modification. It cannot catch **deletion** (§8 Gap 1).
- **`scripts/check-unused-bindings.sh`** (`ci.yml:179`, `if: always()`, no `continue-on-error`) — asks
  whether a binding is *referenced*. Read `:17` before trusting it: the test is
  `grep -rw "$name" src/ --exclude-dir=bindings`, a **bare word match**. **It is failing at HEAD** with
  **98** unused bindings (§7 D2), so this step is red on `master` today. Its glob at `:12` is
  `"$BINDINGS_DIR"/*.ts` — non-recursive — so it checks **1,032** of the 1,033 files and has never once
  looked at `serde_json/JsonValue.ts`. See §7 C2 for the deeper problem.
- **`npm run census:check`** — inside `npm run check` (`package.json`). Hosts `bigint-binding-field`,
  `model-struct-without-rename-all`, `untyped-command-payload`, and (proposed here)
  `ipc-payload-typed-inline`.

**Frontend**

- **`import type { X } from "@/lib/bindings/X"`** — the direct path. **853 files do this; 610 distinct
  bindings are consumed this way.** This is the whole frontend API of this leaf.
- **`src/lib/bindings/index.ts`** — the barrel. **950 lines, 946 export specifiers, 0 importers.** Do not
  use it, do not fix it, do not gate it (§7 D1).

## 4. Steps

1. **Decide whether the type crosses at all.** If a frontend will read it, it crosses. If not, derive `TS`
   and withhold `#[ts(export)]` **with a comment saying why** — `dev_tools.rs:1163-1168` is the one
   instance and the right shape. There is no third option: a `Serialize`-only struct in a command return
   position is the hole, not a choice.
2. **Answer the type-over-gate question now** (see the section before §9). Two of the three defect classes
   in this leaf are removable by a signature, and both edits are one line each.
3. **Write the container attributes as one unit:** `#[derive(Debug, Clone, Serialize, Deserialize, TS)]`,
   `#[ts(export)]`, `#[serde(rename_all = "camelCase")]`.
4. **Check every `#[serde(flatten)]` field's own casing.** `rename_all` governs the fields *declared in
   this struct*; a flattened struct brings its own. `DuplicatePersonaResult`
   (`src/commands/core/personas.rs:466-477`) does everything right at the container and still emits **5
   camelCase fields beside 26 snake_case ones** because it flattens `Persona`, which declares no
   `rename_all`. It is the only internally-inconsistent wire type in 1,033 and it was produced by
   correct-looking code.
5. **Choose numeric widths against the transport, not against Rust.** `i32`/`u32`/`u16`/`f64`/`usize` all
   emit `number`. `i64`/`u64` emit `bigint`, which nothing can deliver. Narrow if the value fits; pin with
   `#[ts(type = "number")]` if it must stay 64-bit and stays under 2^53; use `String` if it genuinely
   exceeds it, because JSON has no other honest carrier.
6. **Regenerate with all three flags, and read the emitted file.** The `.ts` is the only place `bigint`,
   `field?:` and a snake_case field name become visible. A regeneration you did not read is a
   regeneration you did not do.
7. **`git status src/lib/bindings/`.** New files are untracked; `git diff --quiet` cannot see them
   locally even though CI now can. `git add` each one. Do **not** add a line to `index.ts` — see §7 D1.
8. **On the frontend, import by direct path and use it as the `invoke` type argument.** One import, one
   type, no local declaration. If there is no binding to import, **stop and go back to step 1** — the
   absence is the finding.
9. **When you delete or rename the Rust type, `git rm` its binding in the same commit.** Nothing else
   will, and no gate will tell you. This is the only step in this document that a machine cannot check
   today (§9 mechanism 2 proposes the one that could).

### Can the primitive make the wrong call impossible? — answered

The contract requires this before §9. **Three answers, and two of them are one-liners.**

- **Crossability → a wrapper derive. YES, and it is the highest-leverage fix in the leaf.** `Serialize`
  and `TS` are two independent decisions and 201 types in `src/commands/**` made the first without the
  second. A `#[derive(WireType)]` in `personas-core` expanding to
  `Serialize, Deserialize, TS, #[ts(export)], #[serde(rename_all = "camelCase")]` makes "on the wire but
  invisible to the generator" **unrepresentable**, and simultaneously deletes
  [persisted-model-struct](./persisted-model-struct.md)'s 298-struct `rename_all` class. It is the same
  shape as that path's proposed `#[derive(PersistedModel)]` — **they should be one macro**, because the
  two paths are describing the same missing primitive from two directions. ~30 lines.
- **`bigint` → a newtype, not 314 more pins.** `#[ts(type = "number")]` is a per-field remedy applied 314
  times and forgotten 294 times. A `personas_core::WireInt(i64)` whose `TS` impl emits `number` and whose
  `Serialize` emits a JSON number makes the wrong spelling impossible on any field that uses it — and,
  unlike the attribute, it is *contagious*: you cannot write the type without opting in. Convergence
  supports this strongly: **no sibling generator emits `bigint` at all**, so `number` is the ecosystem
  default and ts-rs is the outlier this repo must correct at the type level rather than the field level.
- **The orphan → no. A type cannot prevent a *file* from continuing to exist.** [persisted-model-struct
  §"Prefer a type over a gate"](./persisted-model-struct.md) reaches the same conclusion and it is
  correct. But the convergence sweep found the *emission shape* can — and then found what that costs
  (§6). This is genuinely a check, and §9 mechanism 2 is that check.

## 5. Anti-patterns

- **Deriving `Serialize` without `TS` on a command's return type — 83 commands, 75 distinct types, 82 of
  them called from the frontend.** This is the largest and least-visible defect in the leaf. It looks
  exactly like a correctly-typed command; the return type is named, documented, has a doc comment. But no
  binding is emitted, so the consumer hand-writes the contract, and `untyped-command-payload` — the rule
  that exists to catch this condition — scores **zero** on all 83 because they are not spelled `Value`.
  Concentrated in `commands/companion/**` (≈40), which never adopted ts-rs.
- **A hand-authored `interface` sharing a name with a generated binding — 130 in `src/api/**`, 273
  tree-wide across 112 files.** It compiles, it looks authoritative, and it makes the generated file
  *appear used* to the one gate that would otherwise flag it (§7 C2).
- **`invoke<{ … }>` — an inline object literal as the wire contract. 52 sites, 12 files.** Worse than a
  named local type: the contract has no name, so it cannot be shared, cannot be imported, cannot be
  compared to anything, and cannot even be *cited* in a bug report. 7 of the 52 shadow a command whose
  return type already has a generated binding.
- **Forking the contract to fix a leaky generated type.** `src/api/companion.ts:706-745` — a nine-field
  hand-written interface, an inline literal, and a `typeof … === 'bigint'` guard at `:745` that can never
  execute, all because one Rust field is `u64`. Three declarations of one wire shape, and they already
  disagree: the Rust struct marks `cli_session_enabled` `#[serde(default)]`, the generated type says
  `cliSessionEnabled: boolean`, the inline literal says `cliSessionEnabled?: boolean` with a `?? false`.
- **`Number(x.someField)` on a generated field — 162 sites across 40+ feature files.** Every one is a
  no-op at runtime (the value is already a number) that exists only to satisfy a type that is wrong. It
  is the `bigint` defect's real cost, and it is spread across the feature tree where nobody will ever
  connect it back to a Rust field width.
- **Writing test fixtures against `bigint`.** `src/features/overview/sub_health/libs/compositeHealthScore.test.ts:20-23`
  constructs `total_executions: 100n, successful: 95n, failed: 5n, cancelled: 0n` to satisfy
  `PersonaSlaStats`; `src/features/fleet/monitor/monitorModel.test.ts:32-33` calls `BigInt(...)` and casts
  `as PersonaHealth`. **The unit tests now certify the function against an input shape that can never
  arrive.** This is the deepest reach of the defect and the clearest illustration of why a wrong type is
  not a cosmetic problem — it propagates into the evidence.
- **Deleting the Rust type and leaving the binding. 31 orphans, 28 still referenced.**
  `src/lib/bindings/VaultStatus.ts` declares six snake_case keys; `vault_status`
  (`src/commands/credentials/crud.rs:427-443`) now returns `serde_json::Value` from a `json!` literal that
  emits exactly those six keys. **They agree today, by coincidence, and nothing anywhere compares them.**
- **Reaching for the barrel.** `import { X } from "@/lib/bindings"` works for 946 of 1,033 types and fails
  for 87 with no rule a reader can infer. Zero files do it. Do not be the first.
- **Trusting `check-unused-bindings.sh` to mean anything about correctness — or about its own subject.**
  It answers "is this word present in `src/`", takes 3-5 minutes doing 1,032 recursive greps, is satisfied
  by a hand-written duplicate of the type it is checking, and **is failing right now with 98 findings
  while 105 more hide behind those duplicates.** A gate can be simultaneously red and under-reporting.
- **Running the repo's own documented regen command.** `.claude/CLAUDE.md:116`'s two-flag form
  regenerates **nothing** and exits 0.

## 6. Evidence

**The base rate is good and saying so matters.** 990 `#[derive(TS)]` sites, 989 with `#[ts(export)]` —
crossability discipline is 99.9% adhered *where it is applied at all*. 1,474 of 1,661 commands (88.7%)
have a generatable success type. 853 files import bindings by direct path with no ceremony. 594 of 898
exported structs declare camelCase. The CI drift job now catches both new and modified bindings and
documents its own preconditions better than anything else in the repo. This is a well-built boundary with
three specific, bounded holes.

- **`src-tauri/core/src/models/dev_tools.rs:1163-1178` — the one deliberate non-crossing.** Derives `TS`,
  withholds `#[ts(export)]`, and spends five lines explaining that a binding no frontend imports "would
  only add drift surface to the binding-drift CI job", naming the condition under which to add it. One
  instance in 990. Copy this shape rather than silently omitting the derive.
- **`.github/workflows/ci.yml:369-407` — copy this gate's *documentation*, not just its code.** Two
  comment blocks record three separate occasions on which this gate ran green while checking nothing
  (missing `--workspace`, missing `--features desktop`, `git diff` blind to untracked files), each with
  the fix beside it. The untracked check at `:396-401` is the most recent and is live.
- **`src-tauri/core/src/error.rs:160-230` — the counter-example that proves the generator is optional.**
  `AppError` crosses via a hand-written `Serialize` impl, owns its own wire envelope, and has **zero**
  orphans, **zero** `bigint` fields and **zero** casing ambiguity. When a type is small, stable and
  central, hand-owning the wire format beats generating it. Do not generalise this — it is one type
  against 1,033.
- **`src/lib/bindings/serde_json/JsonValue.ts` — the honest untyped field.** A correct recursive JSON
  type, 30 consumers. Reach for `personas_core::models::Json<T>` or a `serde_json::Value` **field** when
  the payload genuinely is arbitrary; that is different from, and much better than, returning `Value` from
  the command.
- **`src/api/vault/credentials.ts:11-13, 85-95` — the counter-example to copy nothing from.** Three orphan
  bindings imported and re-exported as if they were a module's public contract, over three commands that
  return `serde_json::Value`.
- **`src/api/companion.ts:706-745` — the forked contract, in full.** Read all forty lines. The doc comment
  at `:723-727` correctly diagnoses the problem ("the ts-rs binding uses bigint") and then applies the
  wrong fix at the wrong layer.

### Convergence — the brief's central hypothesis, tested and inverted

Read-only sweep 2026-08-14 against `../brainiac` (Rust · utoipa → `openapi.json` → `openapi-typescript`),
`../personas-cloud` and `../personas-web`. **The brief asked whether single-file emission is the general
cure. It is not, and the reason is precise and useful.**

**Confirmed, exactly as briefed.** `brainiac` emits its entire frontend contract into **one** file —
`console/src/lib/api-schema.d.ts`, **6,624 lines, 187 schemas**, generated by `console/package.json:13`'s
`openapi-typescript ../openapi.json -o src/lib/api-schema.d.ts`. There is **no per-type directory
anywhere in that repo** (`git ls-files | grep -iE 'bindings|generated'` returns that one path). A
cross-check of all 79 `S["…"]` references in its alias layer against the 187 emitted schema names finds
**0 orphans**. The mechanism is exactly as claimed: a wholesale rewrite cannot contain a stale entry, so a
deleted Rust struct becomes a **compile error** in the alias layer, caught by `npm run typecheck` in CI
(`.github/workflows/ci.yml:83`).

**And this is where the brief stops and the finding begins.**

- **Single-file emission buys orphan-immunity by giving up staleness detection.** `brainiac` gates the
  *first* hop of its chain — `crates/brainiac-server/src/openapi.rs:425`'s
  `committed_document_is_current` fails `cargo test` when `openapi.json` is stale. The *second* hop is
  **not gated at all**: `grep -rn "gen:api\|api-schema\|openapi-typescript" .github/ scripts/` returns
  **one** hit and it is an unrelated comment. Its CI console job runs `npm ci`, `typecheck`, `build` — no
  regeneration, no diff. So: change a Rust field, regenerate `openapi.json` (gated ✓), forget
  `npm run gen:api`, and the `.d.ts` still holds the **old** schema — all 187 names present, **0 orphans**,
  `tsc` green, CI green, frontend typed against a shape the server no longer sends. **The second half of
  the chain is enforced by a sentence inside an assert message** (`openapi.rs:437`: "…and re-run
  `npm run gen:api` in console/").
- **Personas has the mirror-image profile, and is ahead on the axis brainiac is weak on.** Job D
  regenerates from source and diffs, and now also catches untracked output. It cannot see a deletion.
  **Neither shape is strictly better: wholesale rewrite converts deletion-drift into a compile error and
  does nothing about non-execution of the generator; per-type emission with a regenerate-and-diff gate
  catches non-execution and is blind to deletion.** The honest prescription for this repo is therefore
  **not** "migrate to single-file emission" — it is "keep the drift gate and add the inverse walk"
  (§9 mechanism 2), which costs ~40 lines against a 1,033-file migration.
- **The alias layer is a real, recurring cost of the single file.** `openapi-typescript` output is only
  reachable as `components["schemas"]["Foo"]`; `brainiac` pays that indirection down to **one line**
  (`console/src/lib/types.ts:13-15`) behind a 162-line hand-written alias layer with **79 aliases**. But
  **9 of its 36 regeneration commits (25%) also had to hand-edit that layer**, and **111 of 187 schemas
  are never aliased at all**. Personas' direct-path import needs no such layer. The single file is not
  free.
- **The single file also cannot express what the per-type emitter can, and annotating makes it worse.**
  `brainiac`'s two `#[schema(value_type = Object)]` annotations
  (`crates/brainiac-server/src/http.rs:1784`, `docs.rs:134`) produce
  **`Record<string, never>`** — a type **no non-empty object inhabits**, so `payload.job_id` is a compile
  error. Its *un*annotated `serde_json::Value` fields emit `unknown`, which is narrowable and correct.
  **Adding the type hint degraded the generated type.** Personas' `JsonValue` recursive union is better
  than both. This is a genuine "Personas is ahead" datum and it is worth knowing before anyone proposes a
  generator swap.
- **`bigint` is a ts-rs anomaly, not physics.** **Zero** occurrences across `brainiac`'s generated file
  and console, `personas-web/src`, and `personas-cloud`'s packages and facade. `brainiac` maps 170
  `format: int64` schema fields to `number` with a JSDoc comment (`api-schema.d.ts:1469-1473`,
  `AnalyticsGraph.entities` from `console.rs:1856` `i64`). Its mitigation carries **zero** enforcement and
  the same latent 2^53 hazard — so nobody has solved this — but two independent generators chose the
  mapping that *works*, which settles the direction of the fix.
- **The hand-mirror chain is four links long and 5 of 6 shared types have drifted.** `Persona`:
  **37 fields** in `core/src/models/persona.rs:556` → **37** in the generated `src/lib/bindings/Persona.ts`
  (exact) → **20** in `personas-cloud/packages/shared/src/types.ts:5` → **18** in
  `personas-web/src/lib/types.ts:5`. The two fields lost at the last hop are `permissionPolicy` and
  `webhookSecret` — both security-relevant, both documented in the source they were copied from. Of the 6
  type names shared between the two mirrors, **5 differ in field count**. And because the generated link
  is snake_case while both mirrors are camelCase, **the drift is not merely unchecked, it is
  mechanically undiffable**. Every hand-authored mirror of a generated type in this repo —
  `src/api/companion.ts:706` is the local one — is the first link of that chain.
- **Only one repo in the fleet states which contract is authoritative.**
  `brainiac/console/src/lib/types.ts:1-11` names the source, the derivation chain, the consumer rule
  ("import friendly names from `@/lib/types` and never touch the generated file's indirection") and the
  maintenance obligation. **It also overclaims**: "these names cannot drift from the API" is true only
  under the assumption that someone ran the ungated regeneration, and is outright false of the **5
  hand-authored string unions living in that same file** (`:31,:116,:119,:155,:162`) — backend
  vocabularies the generator cannot see because Rust sends bare `String`. Personas has **92 exported
  enums** and does not have that hole. The others declare only *what mirrors what*
  (`personas-cloud/packages/shared/src/types.ts:2`, `personas-web/src/lib/types.ts:2`) and never who wins.
- **`personas-cloud` is the negative control for "every response is a named type".** 48 FastAPI route
  decorators in `facade/routers/`, **0** declaring `response_model`. Its own header
  (`facade/models.py:3-4`) admits the models are request-side only.

## 7. Deviations found

**Four categories, 419 individually-addressable items.** All ship green under `npm run check`,
`npm run census:check`, CI Job D and `check-unused-bindings.sh`.

### A. Crossability — 187 commands (11.3%) have a success type the generator cannot describe

| Class | Commands | Detected by | Frontend-reachable |
|---|---:|---|---:|
| returns `serde_json::Value` | **104** (40 files) | `untyped-command-payload` census rule ✓ | 55 call sites |
| **returns a named Rust struct that never derives `TS`** | **83** (75 distinct types) | **nothing** | **82 of 83** |
| **total un-generatable** | **187 of 1,661** | | |

The second row is new. It is not a variant of the first — it is the *opposite* markup for the same
condition, and that is exactly why it survives: the code reads as correct.
`companion_list_pending_approvals -> Result<Vec<PendingApproval>, AppError>` is a named type with a doc
comment; `PendingApproval` (`src/commands/companion/approvals/mod.rs:47-49`) derives
`Debug, Clone, Serialize` and even carries `#[serde(rename_all = "camelCase")]` — everything a wire type
needs *except* `TS`. It is the closest possible near-miss, which is why nobody has noticed 83 of them.

Concentration by area, resolved from each command's `fn` signature:

| Area | Commands with a named-but-unexported return |
|---|---:|
| `commands/companion/**` | ~40 (`PendingApproval`, `ApprovalOutcome`, `BrainListItem`, `BrainDetail`, `BriefingSpec`, `CompanionMessage`, `CompanionMessagePage`, `ApplyOutcome`, `ReflectionRow`, `ReflectionDetail`, `DashboardSpec`, `CockpitSpec`, `PendingRequestDto`, `DoctrineIngestSummary`, `EngageOutcome`, `WhisperModelListing`, `CompanionTemplateMatch`, `PocketStatus`, `TtsAudio`, …) |
| `commands/infrastructure/**` | `MemoryIngestResult`, `MemoryNodeRow`, `MemoryCoverage`, `DocRotScanSummary`, `DocRotRow`, `MemoryHealthScanSummary`, `MemoryHealthRow`, `SkillUsageScanSummary`, `ContextAuditReport`, `CrossRefRepairPlan`, `RepoEvidence` |
| `commands/credentials/**` | `CliCaptureResult`, `CliSpecInfo`, `CliInstallStatus`, `CliVerifyResult`, `AuthDetection`, `ForagingScanResult` |
| `commands/artist/**` | `TranscribeResult`, `KokoroVoiceEntry`, `KokoroStatus` |
| `commands/core/**` | `MemoryClaim`, `DisputedMemoryRow`, `MemoryStats`, `MemoriesWithStats`, `KnownProject` |

Broader context: **201 of 422 `Serialize`-deriving struct/enum declarations under `src-tauri/src/commands/`
do not derive `TS`** (two independent implementations agree — an attribute-block parser and a
census-style whole-file regex both return 201 across 61 files). **49 of those 201 are a command's success
type**; the rest are internal (the export-bundle schema in `core/data_portability.rs` alone is ~50, and is
a legitimate non-IPC use — it defines a file format). See §9 for why the broad signal is refused.

### B. `bigint` — already gated, and the blast radius is wider than the count suggests

The census rule exists; these are the numbers it does not report.

| Measure | Count |
|---|---:|
| binding files containing `bigint` | **144** (142 after the runner's comment filter — 2 mention it only in prose) |
| **field declarations typed `bigint`** | **294** (2 `Array<bigint>`, 4 tuple positions inside `Array<[string, bigint]>`) |
| bigint-carrying types imported by app code | **102 of 144** |
| **`Number(<expr>.<bigintField>)` coercions in feature code** | **162** |
| `typeof x === 'bigint'` guards — branches that cannot execute | **6** (`src/api/companion.ts:745,794,795,865,867`; `src/features/overview/components/health/LogDiskUsageSection.tsx:9`) |
| test fixtures constructing real `BigInt`s to satisfy a binding | **2 files** (`compositeHealthScore.test.ts:20-23`, `monitorModel.test.ts:32-33`) |
| `#[ts(type = "number")]` pins already working around it | **314** |

The claim that no `bigint` can ever arrive was verified, not assumed: `src/lib/tauriInvoke.ts` contains
**no** `BigInt`, no `bigint`, and no `JSON.parse` reviver — deserialization is Tauri's own, and it is JSON.
`PersonaSlaStats` is the cleanest illustration: `core/src/models/sla.rs:22-25` declares four `i64`
counters, `src/lib/bindings/PersonaSlaStats.ts` emits four `bigint` fields plus three more, and the unit
test at `compositeHealthScore.test.ts:20-23` writes `100n / 95n / 5n / 0n`. **The type is wrong, the
runtime is right, and the test agrees with the type.**

The 162 coercions are the part that should change the priority of this class. They are not concentrated in
the API layer where someone might notice a pattern — they are scattered across
`sub_deployment/components/cloud/CloudExecutionRow.tsx:31`, `sub_executions/trace/SubSpanBar.tsx`,
`fleet/monitor/monitorModel.ts`, `overview/sub_cron_agents/components/CronAgentCard.tsx` and 30+ other
feature files, each written independently by someone who hit a type error and made it go away.

### C. Authoritativeness — three ways to declare a wire type, and no rule about which wins

**C1 — 52 inline object literals as the IPC contract, resolved to their commands.** Each site's command
name literal was resolved to the Rust `fn`'s return type:

| What the backend actually returns | Sites | Meaning |
|---|---:|---|
| `serde_json::Value` | **32** | the inline literal is the *only* contract; fix is on the backend |
| a type that **already has a generated binding** | **7** | the literal shadows a real one (`companion.ts:730` over `SensorySourceState.ts`; 5 in `src/test/automation/bridge.ts` over `Persona`/`PersonaDetail`/`TwinProfile`) |
| a named type with **no** binding (§7 A) | **8** | `MemoryIngestResult`, `SkillUsageScanSummary`, `DocRotScanSummary`, `MemoryHealthScanSummary`, `CliCaptureResult`, `CliSessionReadAudit`, `TasksPage` |
| a command that exists in **no** `.rs` file | **5** | `zapier_create_zap` + 4 `safeInvoke` sites; see [`new-ipc-command`](./new-ipc-command.md) §7 A2 |

Densest files: `src/api/devTools/devTools.ts` (17), `src/test/automation/bridge.ts` (6),
`src/api/overview/reviews.ts` (7).

**C2 — 148 generated bindings are never imported anywhere, and a hand-authored type of the same name
exists instead.** This is the one that makes the existing gate meaningless. `check-unused-bindings.sh:17`
tests `grep -rw "$name" src/ --exclude-dir=bindings`; `export interface CrewFitnessReport` in
`src/api/devTools/crewFoundry.ts:30` contains the word `CrewFitnessReport`. **The shadow is what makes the
shadowed binding look used.** Sample: `AccessLevel`, `BackgroundJob`, `BlastRadiusItem`, `BuildEvent`,
`BuildPhase`, the whole `src/api/network/bundle.ts` set (7), the whole `src/api/researchLab/` set (8), the
whole `src/api/director.ts` set (12), `DriveEntry`/`DriveTreeNode`/`DriveStorageInfo`,
`ErrorCategory`/`ErrorSeverity`, `GatewayMember`, `GitOperationResult`, `CrewFitnessReport`,
`CrewFitnessPersona`.

**And this is not hypothetical, because the gate is currently failing.** Running the script's exact logic
against HEAD: of the 1,032 top-level bindings it checks, **830 pass on the word match, 104 more are saved
because a sibling binding imports them, and 98 are reported unused — so the script exits 1.** Of the 830
that pass the word match, **105 pass *only* because a hand-authored declaration of the same name exists**
— they are imported from `@/lib/bindings/…` by nothing, and no sibling binding imports them either.

> **The honest unused list is 203, not 98. Hand-written duplicates are hiding 105 of them from a gate that
> is already red.** The shadow does not merely make a dead binding look alive in the abstract; it is
> actively suppressing half of a failing check's output, so whoever eventually works that list will
> declare it done at 98.

Verified by direct `grep -rw` on four samples (`NightRun`, `DevAutoRun`, `KbChunk`, `NetworkConfig`):
0 app-code references and 0 sibling-binding imports each, matching the reimplementation exactly.

Full breakdown of the 1,033 bindings by how they are reached from `src/`:

| | Count |
|---|---:|
| imported by direct path | **610** |
| imported via the barrel | **0** |
| **never imported; a hand-authored type of the same name exists** | **148** |
| never imported; only an incidental word match | 73 |
| not referenced by any word outside `src/lib/bindings/` | 202 |

**C3 — 273 tree-wide name collisions between a generated binding and a hand-written declaration**, across
112 files; **130 of them inside `src/api/**`** (of 373 type/interface declarations there). 117 `invoke<T>`
sites use a locally-declared `T`. Against **874** sites that use a generated binding and 484 that use a
primitive, out of **1,554** typed IPC sites — so adoption is 56%, and the hand-authored population is
**165 sites (117 named + 48 anonymous)**.

### D. Artefacts that have stopped working

| Path | What's wrong |
|---|---|
| **`src/lib/bindings/index.ts`** | **950 lines, 946 export specifiers, 87 binding files absent, and 0 importers.** Regenerated by a shell one-liner pasted in its own header comment (`:2`) that nothing runs. `knip.json:18` excludes the directory from dead-code analysis, so the dead-code checker is explicitly told not to look. **Two golden paths currently list "add the missing 86/87" as backlog; the correct fix is `git rm` and a line in `.claude/CLAUDE.md` saying bindings are imported by direct path.** Verify before deleting: `grep -rEl "from ['\"][^'\"]*bindings['\"]" src` → 0. |
| **`scripts/check-unused-bindings.sh` — D2, and it is RED right now** | **The script exits 1 at HEAD, naming 98 unused bindings** (`ArtistTag`, `AthenaPromptBlockStat`, `CloudExecutionPoll`, `DevAutoRun`, `KbChunk`…`NightRun`, `NetworkConfig`, `ValidationError`, `ValidationRule`, `VaultLintReport`, `WorkspaceMergeOutcome`). `ci.yml:177-179` runs it `if: always()` with **no `continue-on-error`**, so this step fails Job A on `master` today — either CI has been red here or the failure is being read as ambient. It takes 3-5 minutes doing 1,032 recursive greps (two 120-second windows elapsed without completion before a background run finished). Its glob (`:12`) is non-recursive, so `serde_json/JsonValue.ts` has never been checked. Bare-word matching (`:17`) means a shadow rescues 105 more (C2). **Correct in intent, pointed the wrong way, defeated by the defect it should surface, and failing unnoticed while it happens.** **Exit code independently reproduced by the parent 2026-08-14: `EXIT=1` at HEAD, with `ValidationError`/`ValidationRule`/`VaultLintReport`/`WorkspaceMergeOutcome` among the names, and `ci.yml:177-179` re-read to confirm `if: always()` with no `continue-on-error`.** The parent's run truncated its own output, so **the count of 98 and the 105-shadow figure remain the composer's measurement, not the parent's** — three implementations agree on 98; the parent verified only that the gate fails and that CI does not tolerate it. |
| `.claude/CLAUDE.md:116` (and `:67`) | Prescribes `cargo test --manifest-path src-tauri/Cargo.toml export_bindings`. Regenerates **zero** bindings and exits 0. `ci.yml:387` has the correct form with the reasoning at `:375-386`. **Third golden path in a row to report this.** |
| `src/lib/bindings/DuplicatePersonaResult.ts` | One wire type, two casing conventions: 5 camelCase own fields, 26 snake_case flattened ones. The Rust (`src/commands/core/personas.rs:466-477`) declares `#[serde(rename_all = "camelCase")]` correctly and flattens `Persona`, which declares none. The only such type in 1,033 — and produced by code that looks right. |

### The casing surface, measured on the emitted output

[persisted-model-struct](./persisted-model-struct.md) measures this from the Rust side and gates it there
(`model-struct-without-rename-all`, baseline 40/198 over `core/src/models`). Measured here from the side
the consumer actually sees:

| | Count |
|---|---:|
| binding files with a snake_case field and no camelCase field | **333** of 1,033 |
| binding files camelCase (or single-word-only) | **608** |
| binding files mixing both **inside one type** | **1** |
| unions/aliases with no field declarations | 91 |
| distinct field names across all bindings | 6,626, of which **1,787 (27.0%) snake_case** |

Rust side, re-measured independently with an attribute-block parser walking upward from each item:
**898 exported structs + 92 exported enums; 594 `camelCase`, 6 other, 298 no `rename_all`.** The sibling
path reports 854/292; the `core/src/models` sub-count agrees **exactly at 198**, so the delta is
attribute-block parsing at the edges, not a disagreement about the condition. Either number supports the
same conclusion.

## 8. Gaps in the primitive

1. **ts-rs writes and never deletes, and it emits no manifest.** This is the root cause of half this
   document. Nothing anywhere records the set of files the last export produced, so nothing can notice
   that a file stopped being produced. `git diff` sees no change (the file was not rewritten);
   `git ls-files --others` sees no new file; `check-unused-bindings.sh` asks a different question. **All
   three gates are correct and all three are structurally incapable of seeing a deletion.** The
   convergence sweep shows the property is obtainable — `openapi-typescript`'s wholesale rewrite is an
   implicit manifest — but at the cost of a staleness blind spot (§6). The cheap fix is to build the
   manifest externally: §9 mechanism 2.
2. **`#[derive(Serialize)]` and `#[derive(TS)]` are independent, and only one of them is required to put a
   type on the wire.** The compiler is satisfied by the first. There is no attribute meaning "this type
   crosses IPC" that could require both. 201 declarations in the commands tree have the first without the
   second; 83 commands return one. §4's `#[derive(WireType)]` is the fix and nothing prevents it.
3. **ts-rs is telling the truth about Rust and lying about the transport.** `i64`/`u64` → `bigint` is
   correct for the Rust type and wrong for every Tauri payload. `#[ts(type = "number")]` fixes the type
   and silently accepts the 2^53 loss. **There is no attribute meaning "serialize as a string, type as a
   string"** — the only honest carrier for a genuinely large integer — so the correct answer requires
   changing the Rust field type. Convergence adds one datum: nobody else has solved this either
   (`brainiac`'s JSDoc `Format: int64` has zero enforcement), but everyone else at least defaults to the
   type that works.
4. **`#[serde(rename_all)]` does not compose across `#[serde(flatten)]`.** A container attribute governs
   only the fields declared in that container. There is no way to say "and everything you flatten". This
   is a serde limitation, not a ts-rs one, and it means the container attribute — the thing
   `model-struct-without-rename-all` gates — is **necessary but not sufficient** for a consistent wire
   type.
5. **`invokeWithTimeout<T>`'s `T` is unconstrained by `cmd`.** The command name is typed `CommandName`;
   the payload is a free type parameter, so `invoke<AnythingIWant>("do_thing")` compiles. Every deviation
   in §7 C lives in this gap. [`new-ipc-command`](./new-ipc-command.md) §4 proposes the fix (a generated
   `CommandReturns` map) and it is correct; this path adds the measurement from the consumer side —
   **165 of 1,554 typed IPC sites (10.6%) would become compile errors**, and the 187 commands in §7 A
   would become *impossible to type at all*, which is the right outcome: it forces the Rust fix.
6. **The barrel is regenerated by a comment.** `index.ts:2` carries a shell one-liner; nothing runs it.
   Unlike the other gaps this one has no downstream cost, because nothing imports the file — but the two
   golden paths that listed it as backlog are the cost, and they are real hours.
7. **No enforcement of any of this reaches `src-tauri/`.** `npm run check` is TypeScript + ESLint over
   `src/` plus the census; `cargo clippy -D warnings` has no opinion about which derives a struct carries.
   Every crossability defect in §7 A shipped green.
8. **`check-unused-bindings.sh` cannot distinguish a reference from a redeclaration**, so the two states
   this leaf most needs to tell apart — "the frontend uses the generated type" and "the frontend replaced
   it" — are the same to the only gate that looks.

## Prefer a type over a gate — the answer for this leaf

Per the [contract](../golden-path-contract.md) this is answered explicitly, before §9.

**Yes for two of the three defect classes, and both fixes are smaller than the gates that would police
them.**

1. **`#[derive(WireType)]` makes non-crossability unrepresentable.** A single derive expanding to
   `Serialize, Deserialize, TS`, `#[ts(export)]` and `#[serde(rename_all = "camelCase")]` removes the 83
   named-but-unexported command returns *and* the 298 missing `rename_all` declarations, because the wrong
   thing stops being shorter to type than the right thing. It is ~30 lines in `personas-core`. **It should
   be the same macro [persisted-model-struct](./persisted-model-struct.md) proposes as
   `#[derive(PersistedModel)]`** — two paths independently derived the same missing primitive from
   opposite directions, which per the contract's convergence rule is the strongest available signal that
   it is real. Landing it converts `model-struct-without-rename-all` from a permanent gate into a
   migration counter that ratchets to zero and is deleted.
2. **A `WireInt` newtype makes `bigint` unrepresentable on the boundary.** `#[ts(type = "number")]` is a
   remedy applied 314 times and forgotten 294 times, because it is optional at every field. A newtype
   whose `TS` impl emits `number` cannot be used without opting in. Convergence says the direction is
   right: **zero** siblings emit `bigint`.
3. **The orphan is genuinely a check.** No signature prevents a file from continuing to exist. The
   emission *shape* can (§6) — and the sweep found that trade is not worth 1,033 files of migration,
   because it swaps a deletion blind spot for a staleness blind spot this repo does not currently have.
   §9 mechanism 2 is the ~40-line answer.

## 9. The missing gate

### The semantic conditions, stated first

Three, each stack-free. Per the [portability test](../research/portability-test.md), **these travel and
the proxies below do not** — an adopting repo inherits the sentences and re-derives its own signals.

> **(A)** A value crosses a serialization boundary without the type generator producing anything that
> describes it, so the consumer must author the contract by hand.
> **(B)** A generated artefact outlives the source that produced it, and every check asks a question that
> a still-referenced stale artefact answers correctly.
> **(C)** A consumer declares the wire contract at the call site, so the contract has no name and nothing
> can compare it to the producer.

### 1. Census rule — `ipc-payload-typed-inline` (condition C)

**The proxy in this repo:** an IPC call whose type argument opens with `{` — an inline object literal —
rather than naming an imported generated type. **Precision is 100% by construction**: the generator only
ever emits *named* types, so an object-literal type argument cannot be a generated one.

**PRECONDITION an adopting repo must re-derive:** Personas funnels every IPC call through
`invokeWithTimeout` / `safeInvoke` and generates named types with ts-rs. A repo whose transport is bare
`fetch()`, whose generated types are reached through one indexed schema object
(`components["schemas"]["Foo"]` — `brainiac`'s shape, where an inline literal would be spelled entirely
differently), or which validates responses with a `zod` parse instead of a type argument, has condition
(C) at full scale and scores **zero** here.

```json
{
  "rules": [
    {
      "id": "ipc-payload-typed-inline",
      "goldenPath": "docs/concepts/golden-paths/bridge-type-contract.md",
      "title": "IPC call site declares the payload shape as an inline object literal, so the wire contract has no name and nothing can compare it to the producer",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "\\b(?:invokeWithTimeout|invoke|safeInvoke)\\s*<\\s*(?:Array<\\s*)?\\{",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "an IPC call whose type argument is an inline object literal rather than an imported generated binding. PROXY FOR the stack-free condition \"a consumer declares the wire contract at the call site, so the contract has no name, no single home, and no tool can compare it to what the producer actually sends\". Precision is 100% by construction: ts-rs only ever emits NAMED types, so an object-literal type argument cannot be a generated one. Measured consequence in this repo, by resolving each site's command-name string literal to the Rust fn's return type: 52 sites across 12 files, of which 32 call a command returning serde_json::Value (no binding CAN exist - the fix is on the backend), 7 shadow a command whose return type ALREADY has a generated binding (src/api/companion.ts:730 hand-writes nine fields over the existing src/lib/bindings/SensorySourceState.ts, and 5 sites in src/test/automation/bridge.ts hand-narrow Persona/PersonaDetail/TwinProfile), 8 call a command returning a named Rust struct that never derives ts_rs::TS (MemoryIngestResult, DocRotScanSummary, CliCaptureResult, ...), and 5 call a command that exists in no .rs file at all. The span is under 40 characters and never crosses a statement, so the runner's comment-skip rewind cannot swallow a neighbouring match; measured commentMatchesSkipped = 0. PRECONDITION (must be re-derived per repo): this repo funnels every IPC call through invokeWithTimeout/safeInvoke and generates named types with ts-rs. A repo whose transport is bare fetch(), whose generated types are reached through one indexed schema object such as components[\"schemas\"][\"Foo\"], or which validates responses with a zod parse instead of a type argument, has this condition wearing different markup and scores zero here. LEGAL FIX: import the generated binding - import type { Foo } from \"@/lib/bindings/Foo\" - and if no binding exists, THAT is the finding: give the Rust command a named success type carrying #[derive(TS)] #[ts(export)] rather than typing the hole on the consumer side."
      },
      "baseline": { "files": 12, "matches": 52 },
      "floor": 4000
    }
  ]
}
```

**Validated standalone before publishing**, from a scratchpad file named `census-bridge-type-9c4e17.json`
— unique to this composition, because a previous composer's validation silently ran a different agent's
rule from a generically-named file:

```
  rule                    files   base  matches   base  walked  floor
  OK   ipc-payload-typed-inline     12     12       52     52    4829   4000
  census OK — 1 rule(s), 4829 file-visits, 52 surviving violation(s) across 12 file(s).
```

`4829 walked` is exactly `frontend.tsFiles` in [`shared-facts.json`](../shared-facts.json) — two
independently derived counts agreeing, which is the only reason to trust either. `floor: 4000` matches
every other `src`-rooted rule in the registry deliberately: two rules over one root must not hold two
opinions about what "the frontend tree is intact" means.

**Counts verified through a second, regex-free implementation**, as the contract requires and as the
engine caveat about multiline comment-skipping demands. A character scanner (walk the source, match an
`invoke`-family identifier at a word boundary, skip whitespace, require `<`, skip whitespace and an
optional `Array<`, require `{`) returns **files=12 matches=52 commentLineMatchesSkipped=0** — identical,
and the zero confirms the comment-rewind path is never taken for this pattern, so the runaway-match hazard
cannot apply.

**Fault injection against the real tree**, because a gate that cannot fail is not a gate:

| Induced fault | Exit | What it printed |
|---|---|---|
| baseline, unmutated | **0** | `OK ipc-payload-typed-inline 12/12 52/52 walked 4829 floor 4000` — surviving counts printed, so a build log distinguishes a clean run from an empty one |
| matcher matches nothing | **1** | `[structural] matched zero files anywhere…` **plus** two `[drift] dropped` problems |
| floor above the walk (`9000`) | **1** | `[structural] walked 4829 files but floor is 9000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (baseline claims 20/80) | **1** | `[drift] files dropped 20 → 12 (-8)`, `matches dropped 80 → 52 (-28)` |
| count rises (baseline claims 9/40) | **1** | `[drift] files rose 9 → 12 (+3)`, `matches rose 40 → 52 (+12)` |
| renamed root (`src` → `srcc`) | **1** | `walked 0 files but floor is 4000` + `matched zero files anywhere` + both drops |
| stale `exclude` (path matching no file) | **1** | `[structural] exclude "…" matched no file. The exemption is stale…` |
| root narrowed to `src/api` | **1** | `walked 141 … floor is 4000` + `files dropped 12 → 11`, `matches dropped 52 → 46` |

All eight behave as the contract requires. **No `exclude` entries**: `src/test/automation/bridge.ts`
(6 sites) is the only candidate and it is not exempt — five of its six sites hand-narrow a type that has a
perfectly good binding, which is the defect, not an exception. An exclude that exists for symmetry is a
stale exemption waiting to happen.

### 2. The inverse walk — one script, both directions, plus the barrel verdict (conditions A and B)

**Not a census rule, and the reason is structural, not a preference.** Both remaining conditions are
*relational across two trees*: "this generated file has no Rust source" and "this command's return type
has no generated file" are joins, and a census rule counts occurrences within one file. This is the same
conclusion [persisted-model-struct](./persisted-model-struct.md) §9 reached for orphans, independently; it
holds in both directions.

~40 lines, wired into `npm run check` and into CI Job D beside the two gates that already cannot see this.
**One walk, four assertions:**

- **(a) Reverse — every `src/lib/bindings/*.ts` name resolves to a Rust `struct`/`enum`/`type` (or a
  `#[ts(rename)]`) under `src-tauri/`.** Catches the **31** orphans, **28** of which are actively
  imported. Seed a shrink-only baseline with today's 31, each carrying a written reason, **stale-entry
  checked in both directions** — copy `ipc_auth.rs:1196-1212`'s `DRIFT_BASELINE`, which is the repo's
  only baseline that cannot rot.
- **(b) Forward — every `#[tauri::command]`'s success type resolves to a binding, a primitive, or
  `serde_json::Value`.** Catches the **83** named-but-unexported returns that nothing sees today. Same
  shrink-only baseline shape.
- **(c) The barrel.** Assert `src/lib/bindings/index.ts` **does not exist**, after deleting it. If the
  team prefers to keep it, assert instead that every binding is exported *and* that at least one file
  imports it — because the second half is the one that has been false all along, and a barrel with zero
  importers is exactly the artefact this assertion exists to prevent.
- **(d) Self-check, fail-loud.** The walk must see **> 900** binding files and **> 900** `.rs` files and
  **> 1,400** `#[tauri::command]` attributes (real: 1,033 / 963 / 1,661) or exit 1 with *"the walk broke,
  the tree did not shrink"*. **Three separate counters**, because a single combined one lets one walk
  break while the other carries the assertion — the failure mode `ci.yml:375-386` documents twice.

Fold `check-unused-bindings.sh` into the same pass while you are there: it is the same join in the same
direction as (a), it takes 3-5 minutes doing 1,032 recursive greps, its glob is non-recursive, and — per
§7 C2 — its bare-word test is satisfied by the shadow. **Replace `grep -rw "$name"` with "is imported from
`@/lib/bindings/$name`", which is the question it meant to ask**, and the 105 shadow-rescued bindings join
the 98 it already reports. **Do this carefully: the script is red today, so a fold-in that starts from a
fresh baseline would silently retire 98 live findings.** Seed the baseline at the honest 203 and ratchet
down.

### What is deliberately left ungated, and why — four refusals

1. **`bigint`. Refused because it is already gated.** `bigint-binding-field` exists at 142/294 and
   reproduces exactly. A second rule over the same signal is precisely the wave-2 collision the contract's
   "do not edit `rules.json` directly" clause was written to prevent, arriving through a different door.
   This path's contribution is the blast radius (§7 B) and the correction that `usize`/`isize` are **not**
   affected.
2. **Casing. Refused because it is already gated, and the sharper signal was already rejected with
   measurement.** `model-struct-without-rename-all` covers the Rust half. This path's independent
   output-side measurement (333 snake / 608 camel / 1 mixed) reaches the same conclusion by a different
   route, and adds the mechanism that gate cannot see: **`#[serde(flatten)]` does not propagate
   `rename_all`**, so a struct that *passes* the rule can still emit a mixed type. That is one instance in
   1,033 and belongs in review, not in a regex.
3. **`Serialize`-without-`TS` in the commands tree. Refused as a census rule — the measurement is the
   reason.** The signal was built and run: a whole-file regex over `src-tauri/src/commands` returns
   **61 files / 201 matches**, and an independent attribute-block parser returns the same **201**. But
   only **49 of the 201 are a command's success type** — **24% precision**. The bulk is
   `core/data_portability.rs`'s ~50 export-bundle structs, which are a *file* format and legitimately not
   IPC types. Narrowing by excluding that file trades a real signal for a permanent named exemption over
   a moving target. **A gate that is three-quarters false positives trains the reflex the census exists to
   prevent** (`npm run census -- --update` as a habit). The honest home for this condition is assertion
   (b) above, which resolves the actual return type instead of guessing from a derive list.
4. **Hand-written *named* response types in `src/api/**`. Refused, confirming a prior refusal with an
   independent number.** [`new-ipc-command`](./new-ipc-command.md) §9 rejected this after measuring a
   back-reference pattern that captured only 72 of 187 true violations. Measured here from the other end:
   **117 `invoke<T>` sites use a type declared in the same file**, and identifying them required resolving
   each identifier against the file's own declarations — not something a single regex can do at any
   precision. Two independent refusals of the same gate, on different evidence, is a settled question.
   **The fix is the `CommandReturns` map (§8 Gap 5), which makes all 165 hand-authored sites compile
   errors.**

### On severity, if any of this ships as an ESLint rule

Ship it at `"error"`. **Not because of warning volume** — the baseline is 1,135, and that number is
irrelevant here. The count-independent argument is the only one that holds: `npm run check` runs
`eslint src/` with **no `--max-warnings`**, and the pre-commit hook runs `--quiet --max-warnings 99999`,
where `--quiet` discards warnings before they can be counted. **A warn-level rule enforces nothing at
either gate, at any count.** It still changes authoring behaviour through editor squiggles, which is worth
something — but it is not a gate and must never be described as one.
