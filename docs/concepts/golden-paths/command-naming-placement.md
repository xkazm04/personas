# Golden path — Command placement: which module owns the command

> Situation node: `backend-runtime/command-definition/command-naming-placement` · [situation spine](../situation-spine.md)
> `sides: server` · recurrence **1,650** · risk **low**. Dimensions: **code-quality · function**.
> Composed 2026-08-14 against `master` @ `e1a39e38a` from a ground-truth sweep of all **963**
> `.rs` files under `src-tauri/` — the **1,661** `#[tauri::command]` attribute sites, the **299**
> files and **160,516** lines under `src-tauri/src/commands/`, the `db`/`engine`/`core` crates,
> the 1,915-line `generate_handler![]` block, the **141** `src/api/**` wrapper files, and the four
> hand-maintained artefacts that map source to product. Every number was produced by parsing the
> real tree; none is estimated. `src-tauri/target/**` and `.claude/worktrees/**` excluded.

> ### ✅ `shared-facts.json` is correct — verified, not merely cited
>
> The brief warned that three consecutive waves published a wrong Tauri-command count. A fourth,
> fully independent parse (walk every `.rs` file; keep lines whose **trimmed** text begins with
> `#[tauri::command`; resolve each to the following `fn`) reproduces **every** Rust fact exactly:
> `files 963` · `tauriCommands 1661` · `requiresPrivileged 168` · `requiresCloud 56` ·
> `requiresAuth 19`. It also reproduces the discard buckets `new-ipc-command.md` reported —
> **7** comment-only lines and **5** string literals inside the repo's own checkers — and
> **1,658** unique fn names (3 `#[cfg]`-gated duplicate pairs). **The count has stabilised. Cite
> 1,661 and stop re-deriving it.**
>
> ### ⚠ Two corrections to the brief
>
> 1. **"`companion` and `jobs` totalling 3,055 lines" is wrong by ~6×.**
>    `src-tauri/src/commands/companion/` is **18,506 LOC across 40 files** carrying **133**
>    commands — the fourth-largest command area, and it *is* documented
>    (`docs/features/companion/README.md`, mapped at `feature-doc-map.json` via
>    `src-tauri/src/commands/companion/**`).
> 2. **`jobs` is not a module at all.** No directory, no `mod.rs`, nothing to be large. Seven
>    files in six directories share the word: `commands/companion/jobs.rs` (70 LOC, 5 cmds),
>    `commands/core/persona_jobs.rs` (200, 8), `commands/design/n8n_transform/job_state.rs`
>    (171, 3), `commands/network/remote_jobs.rs` (80, 3), `src/companion/remote_jobs.rs` (671, 0),
>    `src/engine/persona_jobs.rs` (587, 0), `src/background_job.rs` (647, 0). That scattering is
>    itself the finding this path is about, but it is a *placement* defect, not a size one.

## 1. Trigger

- "Where do I put this command?" / "which file should this live in?"
- "This module is getting huge — should I split it?"
- "I can't find the command `foo` — which file is it in?"
- "Does this belong in `commands/`, in `engine/`, or in the `db` crate?"
- "There's no obvious directory for this feature — `infrastructure/`?"
- "Why is this command's implementation 400 lines of SQL?"

If you are about to type a new `.rs` file under `src-tauri/src/commands/`, a new `pub mod` line
in a `mod.rs`, a `let conn = state.db.get()?` inside a command body, or you are staring at a
directory list trying to guess which of `core` / `tools` / `infrastructure` / `execution` your
feature is — you are in this situation.

### Scope — the boundary with `new-ipc-command.md`, and where it leaks

**[`new-ipc-command.md`](./new-ipc-command.md) §1 owns the name as a wire key. That boundary is
correct and this path does not re-litigate it.** Tauri's IPC namespace is flat:
`commands::a::foo` and `commands::b::foo` register the identical wire name, so **module placement
has zero wire, runtime, or security effect.** Placement is a pure code-organisation decision.
Verified: the `generate_handler![]` list at `lib.rs:1805` registers by fully-qualified path but
the registered *name* is the bare `fn` ident, and `commandNames.generated.ts` emits only that.

**One honest crack in the seam, reported rather than papered over.** That path's §4 step 1 says:
*"If the verb alone could plausibly belong to two features, prefix the domain (`kb_`,
`dev_tools_`, `companion_`)."* That instruction cannot be executed without a **domain
vocabulary**, and the domain vocabulary is the directory tree — which is this path's subject.
Measured, the instruction is needed: **670 of 1,661 commands (40.3%) begin with a bare verb**
and **1,102 of 1,661 (66.3%) have a first token that is not unique to one directory**. So the
two halves are coupled through §3's table below; a developer following the sibling's step 1 must
land here to pick the prefix, and then §2 here tells them the prefix chooses the file. The seam
holds on the *wire-consequence* axis it was drawn on. It is not a wall.

Also adjacent and not covered: [`ipc-command-authorization.md`](./ipc-command-authorization.md)
(the tier decision — §5 below only measures how well the tree predicts it),
[`row-to-struct-mapping.md`](./row-to-struct-mapping.md) and
[`transaction-boundary.md`](./transaction-boundary.md) (what the repository layer does once you
have correctly delegated to it).

## 2. The one way

**Place the command in the *file* whose existing commands share its name prefix and its auth
tier, and make its body a delegation. Do not choose a directory.** The file is the unit that
carries meaning here and the directory is not: the file predicts a command's `#[requires(...)]`
tier at **89.1%** of available entropy, the command's own **name** at 56.5%, and the directory at
only **38.4%** — the directory is the *worst* of the three signals available, so picking one is
picking noise. Concretely: grep the tree for your command's first token; if 3+ commands with that
prefix already sit in one file and that file's commands all carry the tier you need, your command
goes there and nowhere else. If no such file exists, **create one named for the prefix**
(`commands/<area>/<prefix>.rs`), put it under whichever `<area>` its prefix-siblings already use,
and accept that `<area>` is a filing convenience, not a claim. **Never reach for
`commands/infrastructure/`** — it already holds **507 of 1,661 commands (30.5%) across 63 files**
and the repo's own product map has to carve it up with **11 different feature docs**; adding to
it is how the drawer got that big. Keep the body **one call** into `repo::` or an engine module,
the way `commands/core/personas.rs:44` does (`repo::get_all_lean(&state.db)` — it hands the
*pool* to the repository and never checks a connection out); **never `let conn = state.db.get()?`
followed by inline SQL**, which is the one placement error in this repo that has a real cost and
a real gate (§9). Split a file when it crosses **~500 LOC** or when its commands stop sharing one
tier — both are measurable, and both are already past due in 43 and 24 files respectively. Then
register it in `generate_handler![]` under the section comment for its product area, and stop.

## 3. Mandated primitives

There is no runtime primitive here — placement is inert. What exists is a **vocabulary** and four
**maps**, and using the vocabulary that already exists is the whole discipline.

**The directory vocabulary — `src-tauri/src/commands/`, 17 areas + 4 loose files.** Split into
two kinds, because they behave completely differently:

| Kind | Areas | Commands | Directory name appears in the command's own name |
|---|---|---|---|
| **Eponymous** — the directory *is* the prefix | `fleet` (38), `artist` (36), `ocr` (8), `companion` (133), `obsidian_brain` (39) | 254 | **100% / 100% / 100% / 92.5% / 38.5%** |
| **Abstract** — the directory names a concept no command mentions | `infrastructure` (507), `credentials` (161), `execution` (158), `design` (107), `core` (102), `teams` (81), `communication` (78), `tools` (69), `network` (55), `recipes` (33), `signing` (9), `testing` (1) | 1,361 | **0.0% – 21.2%** (`core`, `communication`, `infrastructure` are all **0.0%**) |

Overall the directory name appears in the command name **281 / 1,661 = 16.9%** of the time. When
your prefix matches an eponymous area, that area is the answer and there is nothing to decide.
When it does not, §2's file-first rule is the answer.

- **`src-tauri/src/commands/mod.rs`** — 23 lines, a flat `pub mod` list, **no re-exports**. The
  module path you write is the path callers use; only **3 of 22** `mod.rs` files under
  `commands/` contain a `pub use`, so there is no barrel to hide a move behind.
- **`src-tauri/src/lib.rs:1805–3720` — the `generate_handler![]` block.** 1,915 lines, 1,585
  entries, and **201 hand-written section comments** (`// Core -- Personas`,
  `// Execution -- Scheduler`, …) resolving to **63 distinct product prefixes**. This is the
  repo's most granular and most current taxonomy of the command surface. Put your entry in the
  right section; the surrounding comments are the only place the product structure is written
  down at command granularity.
- **`src-tauri/db/` (the `personas-db` crate)** — where SQL belongs. **117 of 143 files (82%)
  carry a SQL literal.** This is the destination for anything you are tempted to write inline.
- **`src-tauri/src/engine/` and `src-tauri/engine/` (the `personas-engine` crate)** — where
  multi-step logic belongs. Note there are genuinely **two** engine trees (115 files / 96,257 LOC
  in-app, 130 files / 61,281 LOC extracted); the split is mid-migration (`docs/architecture/split-engine-phase1.md`).
- **`scripts/docs/feature-doc-map.json`** (37 entries) and **`docs/architecture/codebase-map.md`**
  (17 rows) — the two hand-maintained *product→source* maps. **If you create or move a command
  file, you must update these**, and nothing will tell you if you don't (§7 D).

## 4. Steps

1. **Grep your command's first token across `src-tauri/src/commands/`.** This is the only step
   that reliably finds the right home. `rg -l 'fn <prefix>_' src-tauri/src/commands/`
2. **If 3+ prefix-siblings live in one file and share your tier — that file. Done.** Do not look
   at directory names. 1,617 of 1,661 commands (97.4%) already sit in a file whose majority tier
   matches theirs; joining that majority is free correctness.
3. **If the prefix is new, create `commands/<area>/<prefix>.rs`,** filing `<area>` under whatever
   the nearest prefix-family already uses. If the prefix is a first-class product noun with no
   home (a new plugin), an eponymous directory `commands/<prefix>/` is legitimate — that is what
   `fleet`, `artist` and `ocr` are, and they are the only areas whose names actually pay rent.
4. **Do not add to `commands/infrastructure/`.** If nothing else fits, that means you have a new
   product area — name it. `infrastructure` is the residue of not having done step 4.
5. **Write the body as a delegation.** `repo::do_thing(&state.db, …)` or
   `engine::module::do_thing(…)`. The command function's job is argument marshalling and one
   call. 1,096 such delegations across 86 files already exist; copy any of them.
6. **If you find yourself typing `state.db.get()` / `state.user_db.get()`, stop.** That is a
   layer crossing, not a shortcut. Move the query into the `db` crate and call it. §9 gates this.
7. **Register the entry in `lib.rs`'s `generate_handler![]` under the matching section comment.**
   If your product area has no section comment, add one — the 201 headers are the taxonomy.
8. **If the file you just grew is over ~500 LOC or now mixes tiers, split it before you commit.**
   The median command file is 315 LOC and 4 commands; p90 is 1,416 LOC and 15 commands; **43
   files are over 1,000 LOC and 13 over 2,000.** Splitting later never happens.
9. **Update `scripts/docs/feature-doc-map.json` and `docs/architecture/codebase-map.md`** if you
   created a file or moved one. Both already carry dead paths (§7 D) because this step is skipped.
10. **Stop.** No `pub use` re-export to "make the path nicer" (only 3 exist; adding a fourth makes
    the canonical path ambiguous). No helper module under `commands/` that defines no command —
    that belongs in `engine/`.

### Can the primitive's signature make the wrong call impossible? — answered before §9

Two candidates, and the honest answer is **yes to one, and a deliberate refusal on the other.**

- **The layer crossing → make the pool unreachable from a command. YES, and there is a direct
  precedent.** `AppState` today exposes an r2d2 `Pool` as a public field, so
  `let conn = state.db.get()?` compiles inside any command. If `AppState` handed commands only
  *repository facades* (`state.personas() -> PersonaRepo`) and kept the pool private to the `db`
  crate, all **134** checkouts in §7 E would become compile errors and the class would be
  permanently closed. This is exactly the shape the contract already cites: `brainiac` made the
  transaction boundary a type (`&mut PgConnection` vs `&PgPool`) and needs no gate.
  **The §9 census rule is the ratchet until this lands, not the destination.**
- **The directory → derive the wire name from the module path. NO — convergence says this is
  actively wrong.** A `#[personas::command]` macro emitting `<area>_<fn>` would make the tree
  load-bearing and end the taxonomy drift in one move. It would also rename **1,585 wire keys**,
  every frontend literal, and every `PRIVILEGED_COMMANDS` entry. And the sibling evidence says the
  payoff is zero: `brainiac`, where crate placement *is* compiler-enforced, has **1.9%**
  name↔directory agreement (8 of 432 pub fns) and is healthy — because the path already binds,
  restating it in the identifier is redundant. `personas-web`'s API layer is at **0%** by
  framework mandate (`GET`/`POST`). **Low name↔directory agreement is a symptom of a *working*
  binding, not a broken one — so Personas' 16.9% is not evidence of a defect and must not be
  "fixed" by making the path bind.** Refused.

## 5. Anti-patterns

- **Choosing a directory by what it sounds like.** `infrastructure` holds 30.5% of the command
  surface and its contents span **11 different feature docs** (`director`, `settings`, `overview`,
  `dev tools`, `workspaces`, `research-lab`, `twin`, `scraper`, `gitlab`, `live-roadmap`, `kpis`).
  It is not a domain; it is the answer people give when the question is hard. Every command added
  there costs the next reader a full-text search.
- **Putting a helper module under `commands/`.** **66 of 299 files (22%) under `commands/` define
  zero `#[tauri::command]` — 23,547 LOC, 14.7% of the tree.** `fleet/registry.rs` (1,902),
  `fleet/stale.rs` (1,810), `companion/approvals/approval_exec_{core,knowledge,dev}.rs` (3,451
  combined). These are engine modules filed under a directory named for the IPC surface, and a
  reader looking for the command tree has to skip them.
- **`let conn = state.db.get()?` inside a command.** The single measurable placement defect.
  **134 checkouts across 46 files**, 88.1% immediately followed by SQL. The compliant shape is
  one line away and 1,096 examples exist. See `commands/companion/observability.rs:76-88` for
  what it looks like and `commands/core/personas.rs:31-45` for what it should look like.
- **Letting a module grow past its tier.** **24 of 237 command-defining files mix auth tiers.**
  `credentials/crud.rs` is 6 public + 13 privileged; `infrastructure/cloud.rs` is 35 cloud + 2
  public; `drive.rs` is 17 public + 1 privileged. A mixed file is where a privileged command
  gets copy-pasted from a public neighbour and loses its annotation.
- **Creating a stutter path.** `commands/teams/teams.rs` (26 cmds) and `commands/tools/tools.rs`
  (15) — `commands::teams::teams::foo`. Both mean "the directory was created but its first file
  was never named".
- **Creating a `<name>.rs` beside a `<name>/` directory.** Exactly one exists —
  `infrastructure/dev_tools.rs` (70 cmds, 2,815 LOC) alongside `infrastructure/dev_tools/` (6
  files, 108 cmds) — and it is the most fragmented module in the handler list (**9 separate
  blocks**). `dev_tools::foo` and `dev_tools::goals::foo` read as siblings and are not.
- **Leaving a file at the root of `commands/`.** `drive.rs` (18 cmds, 1,546 LOC), `radio.rs` (12),
  `eval_runs.rs` (3, 836 LOC), `live_roadmap.rs` (1, 550 LOC). Each is a product area that never
  got a directory, and `live_roadmap.rs` is the one whose doc-sync hook silently broke (§7 D).
- **Assuming a `pub use` will let you move it later.** 3 of 22 `mod.rs` re-export. The
  fully-qualified path in `generate_handler![]` is the real coupling, and moving a file edits it.
- **Adding a command and not touching the two product maps.** They are strings, unvalidated, and
  already 12 and 5 entries stale.

## 6. Evidence

**Say the good part plainly: the one placement rule that matters is at 99.28% compliance.**
**1,649 of 1,661** command attribute sites live under `src-tauri/src/commands/`. The 12
exceptions are all deliberate and co-located with their subsystem (`lib.rs` ×4 bootstrap,
`notifications.rs` ×4, `cloud/remote_commands.rs` ×3, `test_automation.rs` ×1). **Zero** commands
leaked into the `core`, `db`, `engine` or `macros` crates. The IPC surface is one tree, and that
is worth defending.

- **`src-tauri/src/commands/core/personas.rs:31-45` — copy this file.** 19 commands, 1,158 LOC
  (61 LOC/command), one tier throughout (`#[requires(auth)]` ×19, zero mixing), every body a
  one-line `repo::` delegation, and its only SQL is inside `#[cfg(test)]` at `:930`. It is what
  every command module in this repo should look like, and it is the file the discovery slice
  already nominates as the exemplar.
- **`src-tauri/src/commands/core/personas.rs:44`** — `repo::get_all_lean(&state.db)`. The pool
  goes *to* the repository; no connection is checked out. This one line is the difference between
  compliant and violating, and it is the census signal's negative case.
- **`src-tauri/src/lib.rs:1805-3720`** — the handler block's 201 section comments. Hand-written,
  current, and finer-grained than the directory tree. Whatever replaces the tree should be
  derived from these, not from the directory names.
- **`src-tauri/src/commands/fleet/`** — 38 commands, 100% of them prefixed `fleet_`, 6 files, one
  tier. The eponymous-directory pattern working exactly as intended: the name tells you the
  directory and the directory tells you the name.
- **`src-tauri/src/commands/mod.rs`** — 23 lines, no re-exports, `#[cfg]` gates for `signing`
  (p2p) and `testing` (test-automation) at the point of declaration. The right amount of module
  file: a manifest, not a facade.
- **`src-tauri/db/src/**`** — 143 files, 117 with SQL. The destination exists, is populated, and
  is 82% dense in exactly the thing commands should not contain.

## 7. Deviations found

**Six categories, 158 individually-addressable items.** Every one ships green: `npm run check`,
`npm run census:check`, CI, and clippy are all silent on placement, because **nothing in this
repo checks it.**

### A. `infrastructure/` is a drawer, and the repo already works around it

**507 commands (30.5% of the surface) in 63 files, 42,094 LOC.** The workaround is visible in the
two product maps: `feature-doc-map.json` names **30 individual `.rs` files** (vs 11 directory
globs) and **11 distinct feature docs** claim files inside `infrastructure/` alone;
`codebase-map.md` likewise points at `infrastructure/dev_tools.rs`, `infrastructure/twin.rs`,
`infrastructure/research_lab.rs` individually. **When your product map has to name files because
the directory is meaningless, the directory has failed.** The five largest tenants —
`dev_tools.rs` (70 cmds), `twin.rs` (46), `cloud.rs` (37), `dev_workspaces.rs` (33),
`research_lab.rs` (27) — are five separate products, each with its own feature doc.

### B. 66 files under `commands/` define no command

23,547 LOC (14.7% of the tree). The concentration is `commands/companion/approvals/` (4
zero-command files, 4,297 LOC) and `commands/fleet/` (`registry.rs` 1,902, `stale.rs` 1,810,
`pty.rs` 906, `companion_api.rs` 659). These are engine modules; `src/engine/` or the
`personas-engine` crate is where they belong.

### C. Module size

**43 command-defining files exceed 1,000 LOC; 13 exceed 2,000.** Worst by LOC-per-command:

| File | LOC | cmds | LOC/cmd |
|---|---|---|---|
| `commands/core/data_portability.rs` | **12,705** | 9 | 1,412 |
| `commands/infrastructure/dev_tools_http.rs` | 1,432 | 1 | 1,432 |
| `commands/infrastructure/context_consolidate.rs` | 1,348 | 1 | 1,348 |
| `commands/infrastructure/context_generation.rs` | 2,509 | 3 | 836 |
| `commands/companion/fleet_bridge.rs` | 2,436 | 3 | 812 |
| `commands/companion/approvals/approval_exec_fleet.rs` | 2,352 | 3 | 784 |
| `commands/design/connector_readiness.rs` | 1,922 | 3 | 641 |

`data_portability.rs` at 12,705 LOC is **7.9% of the entire command tree in one file** and holds
**279** SQL literals. It is nine commands wrapping a whole export/import engine.

### D. The placement maps have silently rotted — and one hook is dead because of it

**12 of 79 literal (non-glob) `sourceGlobs` in `scripts/docs/feature-doc-map.json` name a path
that does not exist.** This is not cosmetic: the doc-sync Stop hook matches edits against these
globs, so a dead glob means **the reminder never fires for that feature**.

| Dead path | Where it actually is | Consequence |
|---|---|---|
| `src-tauri/src/commands/infrastructure/live_roadmap.rs` (`:583`) | `src-tauri/src/commands/live_roadmap.rs` | `docs/features/live-roadmap/live-roadmap.md` is never nagged |
| `src-tauri/src/engine/{runner,scheduler,parser}.rs` | moved into the `personas-engine` crate | `docs/features/execution/README.md` under-covered |
| `src-tauri/src/db/repos/core/{teams,groups}.rs` | the `personas-db` crate | `docs/features/teams/pipeline.md` under-covered |
| `src-tauri/src/commands/core/agent_ir.rs`, `src-tauri/src/engine/scraper.rs`, 3 × `src/features/shared/components/layout/*.tsx`, `public/radio.html` | deleted or moved | 5 more docs under-covered |

`docs/architecture/codebase-map.md` has **5 of 54** literal paths dead (`src/features/execution`,
`src/features/pipeline`, `src/features/sharing`, `src/api/pipeline/triggers`,
`…/sidebar/sidebarData.ts`).

**And `.claude/CLAUDE.md`'s architecture diagram documents `src-tauri/src/db/` — which does not
exist.** The `db` tree is the `personas-db` crate at `src-tauri/db/`. The onboarding map of the
backend names a directory that was extracted.

### E. The layer boundary — 134 crossings in 46 files

`state.db.get()` / `state.user_db.get()` / `user_db.get()` inside `commands/`. **88.1% are
followed by a SQL literal or a rusqlite call within 900 characters**; only 13.4% are inside
`#[cfg(test)]`. Of the 233 command-defining files under `commands/`: **70 delegate to `repo::`
only** (compliant), **26 check out a pool only**, **16 do both**, 121 touch no persistence.
**467 of 1,661 commands live in a file that checks out a connection.** Worst offenders:
`credentials/vector_kb.rs` (13), `core/data_portability.rs` (11), `design/build_sessions.rs` (8),
`infrastructure/memory_ledger.rs` (7), `companion/{brain,observability}.rs` (6 each),
`design/reviews.rs` (6), `infrastructure/dev_tools/competitions.rs` (6).

### F. Naming/structure debris

- **24 files mix auth tiers** (list in §5). `credentials/crud.rs` 6 public + 13 privileged is the
  most consequential, since it is also `new-ipc-command.md`'s nominated exemplar file.
- **2 stutter paths**: `teams/teams.rs`, `tools/tools.rs`.
- **1 file/directory collision**: `infrastructure/dev_tools.rs` + `infrastructure/dev_tools/`.
- **4 loose root files**: `drive.rs`, `radio.rs`, `eval_runs.rs`, `live_roadmap.rs`.
- **5 areas keep their implementation in `mod.rs`** rather than named files: `obsidian_brain`
  (1,969 LOC, 22 cmds), `artist` (987, 13), `companion` (716), `ocr` (676, 8), `signing` (317, 9).
  Every one of them is an eponymous area — the pattern that grew from a single file and never
  got decomposed.

## 8. Gaps in the primitive

1. **Rust and Tauri offer no placement type.** The module path is not part of any signature, is
   not in the wire name, and is not checked by anything. Unlike the *crate* boundary — which
   `brainiac` proves the compiler will enforce (moving a file between crates breaks the build) —
   an intra-crate module move is free. **Personas has 1,661 commands in one crate, so it has zero
   structural allies for placement.** This is the root gap and everything in §7 A–C is downstream.
2. **The census/regex mechanism cannot see any of the three biggest defects.** A rule counts
   *matches in file content*. It cannot count the **absence** of a `#[tauri::command]` (§7 B), a
   file's **LOC** (§7 C), or whether a path in a JSON map **exists** (§7 D). Three real,
   measured, unambiguous conditions with no census expression. §9 mechanism 2 is a script for
   exactly this reason.
3. **`AppState` exposes the connection pool.** Until it doesn't, §7 E is representable and can
   only be counted, not prevented (see the type-over-gate answer above).
4. **No index from command name to file.** With 191 distinct first tokens over 237 files, a
   developer who knows only the first token must search a mean of **28.3 files** (`get_*` spans
   90 files, `list_*` 70, `delete_*` 36). `generate_handler![]` *is* such an index — it maps
   every registered name to its module path — but nothing surfaces it as one.
5. **The two product maps are unvalidated strings.** Adding a `fs.existsSync` loop is ~10 lines
   and would have caught all 17 dead paths the day they died.
6. **There are two engine trees.** `src-tauri/src/engine/` (96,257 LOC) and the extracted
   `personas-engine` crate (61,281 LOC), mid-migration. "Move this out of `commands/`" currently
   has two possible destinations and no stated rule for choosing.

## 9. The missing gate

**Nothing gates placement today, at any level.** Verified exhaustively: no ESLint rule (it is
Rust), no clippy lint, no CI job, no `cargo deny` rule, no test. The only tools that walk
`src-tauri/src/commands/` are `scripts/check-literal-parity.mjs` (a one-off audit of `require_*`
literals), `scripts/security-audit.sh` (scoped to `credentials/`), and the registration test at
`lib.rs:3838` (scoped to `network/`, 1 of 17 areas). Placement compliance is therefore **an
unenforced convention at 99.28% on the one rule that matters** (commands live under `commands/`)
**and 16.9% on the one that doesn't** (directory name matches command name). Those two numbers
say opposite things and the gate must follow the first, not the second.

### 1. Census rule — `persistence-handle-in-command-tree`

**The condition (stack-free):** *the transport/adapter layer acquires a persistence handle
directly instead of delegating to the layer that owns data access.*

**The proxy in this repo:** a connection-pool checkout (`.get()` on a field whose name ends in
`db`) inside `src-tauri/src/commands/**`. **PRECONDITION, and an adopting repo must re-derive its
own:** this works because Personas' persistence handle is an r2d2 pool whose checkout is spelled
`.get()`, and because the compliant alternative passes the pool *by reference* to a repository
(`repo::get_all_lean(&state.db)`) so it never matches. A repo using `sqlx` (`&pool` everywhere),
an ORM session, or an injected repository interface has the *same condition wearing different
markup* and will score zero here.

```json
{
  "rules": [
    {
      "id": "persistence-handle-in-command-tree",
      "goldenPath": "docs/concepts/golden-paths/command-naming-placement.md",
      "title": "An IPC command module checks out a raw database connection instead of delegating to the layer that owns persistence",
      "roots": ["src-tauri/src/commands"],
      "extensions": [".rs"],
      "signal": {
        "pattern": "\\b(?:[A-Za-z_][A-Za-z_0-9]*\\.)?[A-Za-z_0-9]*db\\.get\\(\\)",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "a connection-pool checkout (`state.db.get()`, `state.user_db.get()`, `user_db.get()`) inside src-tauri/src/commands/**. PROXY FOR the stack-free condition \"the transport/adapter layer acquires a persistence handle directly instead of delegating to the layer that owns data access\". The compliant shape is one line -- `repo::get_all_lean(&state.db)` (commands/core/personas.rs:44) -- which passes the POOL to the repository and never checks a connection out; the violating shape is `let conn = state.user_db.get()?;` followed by inline SQL (commands/companion/observability.rs:84-88). Measured in this repo: 134 checkouts across 46 of 299 command files; 88.1% are followed by a SQL literal or a rusqlite call within 900 chars; only 13.4% sit inside a #[cfg(test)] module; and 1,096 compliant repo:: delegations exist across 86 files, so the correct alternative is present and dominant. Convergence: all four repos in this fleet independently built this boundary and all four leak it (personas-web 6/11 routes, brainiac 20/42 SQL files outside its store crate, personas-cloud 1/8 routers) -- the condition is physics, not local taste. PRECONDITION: this proxy works because Personas' persistence handle is an r2d2 pool whose checkout is spelled `.get()` on a field ending in `db`. A repo using sqlx (`&pool` passed everywhere), an ORM session, or a DI-injected repository interface has the same condition wearing different markup and must re-derive its own proxy -- key on whatever the layer-crossing token is there, not on `.get()`. Legal destination: a function in src-tauri/db/ (the personas-db crate, 117 of 143 files already carry the SQL) called with `&state.db`."
      },
      "baseline": { "files": 46, "matches": 134 },
      "floor": 200
    }
  ]
}
```

**Counts verified through two independent implementations before baselining.** A hand-written
walker (whole-file match, CRLF-aware line mapping, comment-line filter) and the census engine
both return **46 files / 134 matches** over **299** walked files. Three pattern variants were
measured before choosing: a `state.`-anchored form (40 files / 108 matches) missed the
`user_db.get()` local-binding shape that `core/data_portability.rs` uses 11 times; a raw SQL-text
pattern returned 62 files / 693 matches but **53% of those sit inside `#[cfg(test)]` modules**
and 279 came from one file — the exact "35% prose" trap `raw-web-storage` fell into, so it was
rejected. The chosen pattern's test-module contamination is **13.4%**, and its precision against
the stated condition is 100% by construction (every match *is* a checkout); the 88.1%
SQL-within-900-chars figure is a secondary confirmation, not the precision claim. No `exclude`
entries: there is no file under `commands/` that must legitimately check out a connection, and an
exclude added for symmetry is a stale exemption waiting to happen.

**Fault injection against the real tree** (`node scripts/census/run-census.mjs --check --rules …`,
from a scratchpad file named `census-cmd-placement-b47e91.json`, unique to this composition):

| Fault | Exit | What it printed |
|---|---|---|
| clean run | **0** | `OK persistence-handle-in-command-tree 46/46 134/134 walked 299 floor 200` — surviving counts printed |
| matcher matches nothing | **1** | `[structural] matched zero files anywhere…` **plus** two `[drift] dropped` problems |
| floor above walk (`floor: 5000`) | **1** | `[structural] walked 299 files but floor is 5000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` |
| silent drop (`roots` → `commands/network`) | **1** | `walked 9 … floor is 200` + `matched zero files` + `files dropped 46 → 0`, `matches dropped 134 → 0` |
| count rises (baseline lowered to 45/130) | **1** | `[drift] files rose 45 → 46 (+1)`, `matches rose 130 → 134 (+4)` |
| renamed root (`src-tauri/src/commandz`) | **1** | `walked 0 files but floor is 200` + `matched zero files anywhere` + both drops |
| stale `exclude` (path matching nothing) | **1** | `[structural] exclude "…" matched no file. The exemption is stale…` |

All seven behave as the contract requires.

### 2. Validate the two placement maps (node, ~15 lines, into `npm run check`)

`fs.existsSync` every literal (non-glob) path in `scripts/docs/feature-doc-map.json` and
`docs/architecture/codebase-map.md`; fail on any miss. Today that reports **12** and **5**
respectively, including `commands/infrastructure/live_roadmap.rs` — a dead glob that has silently
disabled the doc-sync Stop hook for an entire feature. **Fail-loud self-check:** assert the walk
found **> 60** literal paths in the JSON and **> 40** in the Markdown before reporting a result,
so a parser change that stops finding paths cannot read as "all paths valid". This cannot be a
census rule (gap 2): the census matches file *content*, and the condition here is the
non-existence of a *referenced path*.

### What is deliberately left ungated, and why

- **The directory taxonomy itself. Refused, and convergence is the reason.** The obvious rule —
  "a command's name prefix must match its directory" — would flag **1,380 of 1,661 commands
  (83.1%)**, which is not a gate but a rewrite proposal. More importantly it would be gating the
  wrong thing: `brainiac` runs at **1.9%** agreement and is healthy, `personas-cloud` at **95.8%**
  with zero enforcement, `personas-web`'s API layer at **0%** by framework mandate. **Across four
  repos the agreement figure ranges over the entire possible interval with no relationship to
  code health.** There is no cross-repo signal here to enforce; it is local taste, and the
  contract's rule is that a clause found nowhere else is calibration, not doctrine.
- **`commands/infrastructure/` size. Refused as a gate, kept as a backlog item.** A rule capping
  a directory's command count is trivially satisfiable by renaming the directory. The real fix is
  §7 A's decomposition into the 11 product areas the feature-doc map already names — a refactor,
  which a ratchet cannot express.
- **Module LOC. Refused here, but note the sibling precedent.** `personas-web` enforces exactly
  this with a custom AST rule (`eslint.config.mjs:60`, `custom-quality/max-tsx-lines` at 200) —
  so the fleet demonstrably *will* write a size gate when it decides size matters. It cannot be a
  census rule (gap 2: the census cannot count lines), and a Rust-side equivalent is a new script.
  Recorded as the strongest available follow-up, with the number that justifies it: **43 files
  over 1,000 LOC, 13 over 2,000, one at 12,705.**
- **Zero-command files under `commands/`. Refused — inexpressible.** The condition is the
  *absence* of a pattern in a file, and the census runner treats "matched zero files" as a
  structural failure by design. A 20-line script could do it; it is not worth a new script for 66
  files that a single decomposition PR would clear.
- **Commands defined outside `commands/`. Refused — 99.28% compliant and all 12 exceptions are
  deliberate.** A rule pinned near zero on intentional cases is a gate that only ever produces
  argument.

### On severity, if any of this ever ships as an ESLint rule

Ship it at `"error"`. Not because warnings drown in a large baseline — the baseline is **1,135**.
The count-independent argument is the only one that holds: `npm run check` runs `eslint src/` with
**no `--max-warnings`**, and the pre-commit hook runs `--quiet --max-warnings 99999`, where
`--quiet` discards warnings before they can be counted. **A warn-level rule enforces nothing at
either gate, at any count.** (Moot for this path's own gate — the subject is Rust, and the census
runner has no severity axis: drift is fatal under `--check` or it is not checked.)

## Convergence — what travels, and two results that invert the framing

Checked against `../personas-web` (Next.js App Router), `../brainiac` (Rust workspace, 8 crates)
and `../personas-cloud` (FastAPI facade + Node orchestrator). Reported honestly, including where
it contradicts this document.

| | personas | personas-web | brainiac | personas-cloud |
|---|---|---|---|---|
| Placement load-bearing? | **No** (flat wire ns) | **Yes, 100%** — path *is* the URL | **Yes, at crate granularity** — compiler-enforced | **No** — decorator string supplies the URL |
| Surface size | **1,661** | 48 routable units | 65 axum routes / 432 pub fns | 48 route decorators |
| Drawer share | 30.5% `infrastructure/` | 17.2% `sections/` | **36.3%** `brainiac-server` | 16.6% one file |
| Name ↔ directory | 16.9% | 91.9% pages / **0%** API | **1.9%** | **95.8%** |
| Layer leak | 134 checkouts / 46 files | **6 of 11 routes (54.5%)** | **20 of 42 SQL files outside `store`** | 1 of 8 routers |
| Placement enforcement | **nothing** | nothing (but a **size** rule) | **Cargo DAG** | **nothing at all** |
| Largest file / files >1k LOC | **12,705** / 43 | 2,509 / 18 | 4,855 / 12 | 2,447 / 3 |

**Physics — independently reinvented, so §2's delegation clause and §9's rule travel:**

- **Every repo built a transport/data layer split, and every repo leaks it.** `personas-web` has
  `src/lib/server/` and still calls Supabase inline in 6 of 11 routes
  (`app/api/votes/route.ts:37,124,141,148,160`). `brainiac` has a dedicated `brainiac-store` crate
  and still runs `sqlx::query("SELECT id, name FROM orgs")` from its transport crate
  (`brainiac-server/src/alerts.rs:51`, plus `console.rs:112,536,561` and 6 more files) — **20 of
  42 SQL-bearing files sit outside the data crate.** `personas-cloud` is the cleanest (0 of 16
  orchestrator files carry SQL outside `db.ts`) and still leaks 1 of 8 routers
  (`facade/routers/shared_events.py:8,55`). **4 for 4. This is the clause worth gating.**
- **One file eats the transport surface.** `brainiac/crates/brainiac-server/src/console.rs` is
  4,855 LOC and holds **31 of 65 routes (47.7%)**; `personas-cloud/packages/orchestrator/src/httpApi.ts`
  is 2,447 LOC (16.6% of the repo). Personas' `infrastructure/dev_tools.rs` at 70 commands is the
  same organism. Nobody plans a drawer; every sufficiently large surface grows one.

**Two results that INVERT this brief's framing — and both change the prescription:**

1. **A compiler-enforced placement boundary did NOT prevent the layer leak.** `brainiac`'s Cargo
   DAG is the strongest placement enforcement in the fleet — moving a file between crates breaks
   the build — and its transport crate still queries Postgres directly in 7 of 17 files. **Cargo
   enforces dependency *direction*, not layer *semantics*.** So the intuitive fix for Personas
   ("carve the command tree into enforced crates") would buy nothing for §7 E. That is precisely
   why §9's rule targets the handle checkout — the thing a structural boundary cannot see — and
   why the type-over-gate answer targets `AppState`'s field rather than the module tree.
2. **The variable that predicts placement drift in this sample is surface size, not enforcement.**
   `personas-cloud` has **no CI, no lint config, no CODEOWNERS, no `.github` directory at all**,
   and scores 95.8% name agreement with a near-perfect layer split — across 48 units. Personas has
   1,661. **"Unenforced convention" is not the explanation for Personas' drift; 1,661 is.** A gate
   is still the right instrument, but the honest claim is that it holds a line at scale, not that
   its absence caused the divergence.

**Local calibration — Personas-specific, do not export:**

- **The `commands/<area>/` taxonomy.** Name↔directory agreement ranges 0% → 95.8% across the
  fleet with no relationship to health, and the two repos where placement genuinely binds sit at
  the *low* end (brainiac 1.9%, personas-web's API 0%) because the binding makes restatement
  redundant. Personas' 16.9% is neither good nor bad; it is what you get when nothing pulls.
  **§3's eponymous-vs-abstract table is a house convention, not doctrine.**
- **A 201-comment section index inside the registration list.** No sibling has anything like it.
  It is a genuine asset — the most current product taxonomy of the surface — and it is also a
  sign that the directory tree stopped answering the question years ago.
- **Enforcing module *size* instead of module *placement*.** `personas-web` made exactly that
  trade deliberately (`eslint.config.mjs:60`, TSX capped at 200 lines) *because* its framework
  already gives placement for free. Personas has neither. Given that the size defect is measured
  (43 files >1k, one at 12,705) and the placement defect is not (99.28% compliant on the rule
  that matters), **the sibling's choice is the better-evidenced one and Personas should copy it
  next.**
