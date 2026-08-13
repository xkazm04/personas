# Adversarial review — golden paths wave 1

> Reviewed 2026-08-13 against `master` @ `5dac80f19`, plus two verification
> sweeps (frontend primitives, Rust/CI) that re-derived every load-bearing count
> from source. 18 documents, ~7,000 lines, read in full.
> Scope: the contract (`../golden-path-contract.md`), the taxonomy
> (`../situation-spine.md` + `.json`), and all 18 paths.
>
> **Verdict distribution: 8 sound · 5 sound with caveats · 5 need revision · 0 wrong.**
>
> The corpus is unusually good. Its factual density is high and its numbers hold
> up: I re-measured 40+ claims and the large majority were exact to the digit
> (1,661 / 1,614 / 32 / 15 commands; 657 / 337 timestamp sites; 252 LoadingSpinner
> sites; 6 `role="columnheader"` files; 217 `<Button>` files; 87→ see below).
> Two documents already carry dated evaluator corrections, which is the right
> posture. What follows is what is wrong, and it is concentrated in one place:
> **§9 gate specifications that would not run.**

---

## 1. Verdict per path

| # | Path | Verdict | Caveat |
|---|---|---|---|
| 1 | `tables.md` | **sound with caveats** | Topic path `frontend/surfaces/tables` does not exist in the spine; its scope spans ≥5 real leaves; no §9; mandates `tableId`, which `client-state-persistence.md` files as a hot-path storage deviation |
| 2 | `modals.md` | **sound with caveats** | Topic path unresolvable; adoption count off by one (130/129, not 129/128); no §9; overlaps `dropdown-and-select` on anchored popovers |
| 3 | `page-loading.md` | **needs revision** | **The only path in the corpus with no proposed gate at all.** Gap 8 states the absence and stops. Gates are to be built from §9; this one has nothing to build from |
| 4 | `button.md` | **sound** | The strongest §9 in the corpus. But Signal A keys on a class combo the doc transcribes wrongly (accent triple is a *quad*, border is `/25` not `/2[05]`), and its own self-check asserts a `[@media(pointer:coarse)]:w-11 h-11` literal that does not ship |
| 5 | `client-state-persistence.md` | **sound with caveats** | `ALLOWED_KEYS` is **87**, not 89 (stated twice); its gate classifies `ColumnResize.tsx` as a violation while the Evidence section cites it as exemplary |
| 6 | `inline-busy-state.md` | **sound with caveats** | Ships `noopSpinner` at `error` on day one over 252 sites, 152 of which are surface-loading migrations, not one-line fixes — the "no long tail to grandfather" claim does not hold |
| 7 | `schema-change.md` | **needs revision** | `.ok()` count is **13**, not 32 (so 55 swallows, not 73) — and it contradicts its own sibling on the same file, same lines |
| 8 | `timestamp-storage.md` | **needs revision** | Its behavioural gate asserts a `db/src/migrations/` test "runs today in `ci.yml:258`" — it does not; that crate is never selected. The gate runs nowhere |
| 9 | `boot-migration-step.md` | **sound** | Best gate section in the corpus. The only document that names the `--workspace` precondition as fatal and refuses to build on it. Minor: `let _ = ddl_step` is 42, not 41 |
| 10 | `json-blob-column.md` | **needs revision** | Same dead-lane defect: two of three behavioural tests live in `personas-db`; "Runs in `ci.yml`'s existing `rust-tests` job with no new infrastructure" is false |
| 11 | `typed-error-contract.md` | **sound** | Every count exact. Two *additional* stale source paths exist beyond the three it found |
| 12 | `ipc-command-authorization.md` | **sound with caveats** | Command count 1,657 vs 1,661 measured by the structural test's own scanner at the same commit. Its gate does live in `personas-desktop`, so it would actually run |
| 13 | `paginated-list-query.md` | **sound** | Its own second-pass correction (17 hand-rolls → 2) is the most honest moment in the corpus. Gate needs a delegation-following parser it costs at one sentence |
| 14 | `polling-loop.md` | **sound** | Gate half 1 is excellent. `check-polling-backoff.mjs` requires interprocedural dataflow in a node script and the doc does not price it |
| 15 | `form-field-and-validation.md` | **sound** | FormField adopters verified at exactly 4. Carries its own dated correction. Malformed markdown at `:578` (unbalanced bold, broken sentence) |
| 16 | `delete-semantics.md` | **needs revision** | Gate A/B claim `npm run test:rust` is "already CI-gated" and reaches `db/` — **false on both counts**. And Gate C assertion (2) accepts `require_auth*` as authorization, which two sibling paths independently prove is a no-op |
| 17 | `dropdown-and-select.md` | **sound** | Prop-drop verified. Says filterable takes "8 of `SelectHTMLAttributes`' props"; the `Pick` has 9 keys of which only 3 are native attributes. Misses that native mode's `{...rest}` spread sits *after* `onChange` |
| 18 | `filesystem-boundary.md` | **sound** | The highest-value document here; its headline traversal is real and is being fixed in the working tree as I write. But it claims to have swept "all 564 `.rs` files under `src-tauri/` (all workspace crates)" — 564 is the `src-tauri/src/` count; the tree is 963. And its topic path is wrong |

---

## 2. Cross-path contradictions

### C1 — `#[requires(auth)]` / `require_auth*`: one path mandates what two others prove is a no-op

**`delete-semantics.md` §Mandated primitives:**
> **`#[requires(auth)]` / `#[requires(privileged)]`** (or `require_auth_sync(&state)?`) — on the delete **and** on its blast radius.

and §Steps 4: *"Put `#[requires(auth)]` or `#[requires(privileged)]` on the command"*.

**`ipc-command-authorization.md` §Anti-patterns:**
> **Reaching for `#[requires(auth)]`.** `require_auth` / `require_auth_sync` are documented no-ops (`ipc_auth.rs:419-421`, `:479-481`). … It communicates a protection that does not exist. Use `privileged`, or nothing plus a comment.

**`filesystem-boundary.md` §Anti-patterns:**
> **Assuming `require_auth` / `require_auth_sync` gate anything.** Both are documented no-ops.

This is not a stylistic disagreement. `delete-semantics.md`'s **Gate C assertion (2)** —
*"every destructive command carries a `#[requires(…)]` attribute or a `require_auth*` call (fails today for 7)"* — would mark **108 destructive commands compliant on the strength of a call that does nothing**, and would pass a newly-written `delete_x` that carries only `#[requires(auth)]`. The gate certifies the no-op.

Worse: `delete-semantics` never mentions `PRIVILEGED_COMMANDS` at all. Per `ipc-command-authorization`, an **async** command with `#[requires(privileged)]` and no list entry has *zero* enforcement. A session following `delete-semantics` verbatim for an async `delete_*` gets an unguarded destructive command it believes is privileged.

**Resolution.** `delete-semantics` §Mandated primitives and Step 4 must be rewritten to: *sync + `#[requires(privileged)]` + an entry in `PRIVILEGED_COMMANDS`*, with a pointer to `ipc-command-authorization.md`. Gate C assertion (2) must key on **list membership**, not on the attribute or the call. `#[requires(auth)]` should be struck from the corpus entirely except where `ipc-command-authorization` names it as an anti-pattern.

### C2 — `ci.yml:258` runs `personas-db` tests, or it does not

**`boot-migration-step.md`, closing paragraph:**
> `ci.yml:258` runs `cargo test --manifest-path src-tauri/Cargo.toml --features desktop` with **no `--workspace`** … **Every test named in this document … lives in `personas-db` and does not run in CI.** … without it, half 2 is a gate that runs nowhere, which is worse than no gate at all.

**`timestamp-storage.md` §The missing gate 3:**
> Mirror it in Rust: a `#[test]` in `db/src/migrations/` that … **That test runs today in `ci.yml:258`'s `rust-tests` job with no new infrastructure.**

**`json-blob-column.md` §The missing gate 3:**
> **Rust, `db/src/migrations/`:** … **Runs in `ci.yml`'s existing `rust-tests` job with no new infrastructure.**

Verified: `ci.yml:258` is `cargo test --manifest-path src-tauri/Cargo.toml --features desktop`. No `--workspace`. The repo's own comment at `ci.yml:351-356` states the rule explicitly (*"`--manifest-path` alone selects only `personas-desktop`"*) — and the binding-drift job at `:363` **does** pass `--workspace`, so the two Rust jobs disagree with each other in the same file.

`schema-change.md` gets this right (Gap 9, and its gate makes the `--workspace` fix a precondition). `boot-migration-step.md` gets it right and names it fatal. `timestamp-storage.md` and `json-blob-column.md` get it wrong and build on it.

**Resolution.** Both must carry the same precondition `boot-migration-step` does. One shared sentence, quoted identically in all four: *"a Rust test outside `src-tauri/src/` does not run in CI until `ci.yml:258` gains `--workspace`; that one-line fix is a precondition of this gate, not a nice-to-have."*

### C3 — `ListSkeleton` / `TableSkeleton`: banned outright, or conditionally mandated

**`tables.md` §The one way:**
> And do **not** reach for `layout/ListSkeleton` or `layout/TableSkeleton` — they default to the banned `animate-pulse` and are the single largest manufacturer of deviations in this repo.

**`page-loading.md` §Mandated primitives:**
> **`layout/ListSkeleton` / `TableSkeleton` / `ContentHeaderSkeleton`** — **only** inside delay-hidden Suspense fallbacks, and **only with `calm`**.

Verified: `calm` defaults `false` in all three (`ListSkeleton:31`, `TableSkeleton:49`, `ContentHeaderSkeleton:36`), and `RouteChunkSkeleton:42` is the one place `calm` is actually passed. Both statements are defensible; together they give a session two answers for the same import.

**Resolution.** One sentence in `tables.md`: *"banned on a table body; permitted only inside a delay-hidden Suspense fallback with `calm` — see `page-loading.md`."* Better: land the shared P0 both paths already agree on (invert the `calm` default) and the conflict evaporates.

### C4 — `tableId` is mandated by one path and filed as a deviation by another

**`tables.md` §Steps 9:** *"**Set `tableId`** on any long-lived user-facing table (unlocks column resize + sort persistence free)."*

**`client-state-persistence.md` §Deviations C:**
> `shared/components/display/UnifiedTable.tsx:473-481` — `useEffect([tableId, sortKey, sortDir])` → a `setItem` per sort click, on the app-wide table primitive. Undebounced, in shared code.

Verified: `UnifiedTable` touches `localStorage` directly twice — a read at `:48` and an undebounced write at `:477` (the persistence doc cites only the write). So `tables.md` instructs every long-lived table to opt into a behaviour its sibling classes as a shared-layer hot-path defect, and `client-state-persistence`'s proposed `custom/no-raw-web-storage` is `error` in `src/features/**` with an allowlist that does **not** include `UnifiedTable.tsx` or `ColumnResize.tsx` — the latter being a file the same document cites in Evidence as *"correct hot-path discipline"*.

**Resolution.** Either add both files to the storage allowlist with the reason (*"shared primitives, pre-registry; migrate with Gap #1"*), or route them through the `@/lib/storage` primitive in the same change that creates it. Do not ship a gate that errors on your own exemplar.

### C5 — Jurisdiction: three paths were written for a tree that no longer exists

Resolving every claimed `Situation node:` against `situation-spine.json` (247 leaves):

| Path | Claimed node | Result |
|---|---|---|
| `tables.md` | `frontend/surfaces/tables` | **no such domain.** Real home: `product-surfaces/lists-and-tables/data-table` |
| `modals.md` | `frontend/surfaces/modals` | **no such domain.** Real home: `ui-system/overlays/modal-dialog` |
| `page-loading.md` | `frontend/motion/page-loading` | **no such domain.** Real home: `ui-system/empty-and-loading/cold-load-choreography` |
| `filesystem-boundary.md` | `integrations-external/external-and-host/filesystem-boundary` | **wrong domain and subdomain.** Real: `integrations-security/external-and-host-surfaces/filesystem-boundary` |
| the other 14 | — | resolve exactly, metadata matches |

There is no `frontend` domain in the spine at all. The three hand-authored probes were written against the retired 56-topic tree and never re-addressed. Since **the topic path is the primary key** for ingestion as a `principle`-layer row, three paths cannot be ingested and one lands in a node that does not exist.

Worse than the addresses is the **scope**. The contract says *"One leaf → one golden path. No leaf gets two; no path spans two leaves."* Measured against the real tree:

- `tables.md` spans `data-table`, `filtering-and-search`, `long-list-rendering`, `matrix-and-cell-grid`, `expandable-row`, `chronological-feed` — six leaves.
- `modals.md` spans `modal-dialog`, `modal-stacking`, `anchored-popover`, `entity-picker` — four.
- `page-loading.md` spans `cold-load-choreography`, `lazy-route-chunk`, `empty-and-demo-states` — three.

And the overlap is already live: `dropdown-and-select.md` explicitly declares *"This path absorbs … `Anchored popovers`"*, while `modals.md` rules on anchored popovers too (*"Putting `role="dialog"` on an anchored popover"*, and 8 lint false positives filed against them). `paginated-list-query.md` correctly cedes `long-list-rendering` to another leaf; `tables.md` claims virtualization jurisdiction outright.

**Resolution.** Re-address the four headers. Then decide, per overlapping leaf, whether the wave-1 document is the golden path for it (and mark the leaf taken) or whether it must be narrowed before wave 2 writes into the same node. Do this **before** ingestion, because a `violating` cell written under a non-existent topic is unrecoverable by the apply campaign.

### C6 — the corpus has four different values for its most-cited denominator

| Path | Commit | `#[tauri::command]` count |
|---|---|---|
| `paginated-list-query.md` | `f7676ab82` | 1,649 |
| `ipc-command-authorization.md` | `7bb572e2b` | **1,657** |
| `typed-error-contract.md` | `7bb572e2b` | **1,661** |
| `filesystem-boundary.md` | `2602d843b` | 1,661 |
| `polling-loop.md` | `f7676ab82` | 1,666 |

Two pairs are at the *same commit* and disagree. Measured today: a naive `rg '#\[tauri::command\]'` over `src-tauri/` returns **1,673**; over `src-tauri/src/` returns **1,666**; the structural test's own depth-tracking scanner returns **1,661**. So every number in the table is *a* real number produced by *a* method, and no document states its method.

This is not pedantry, because three §9 sections put a **floor assertion** on this quantity:
`typed-error-contract` (raise `>= 400` to `>= 1400`), `ipc-command-authorization` (`registered.len() > 1_400`), `filesystem-boundary` (`commands_parsed > 1_500, "expected ~1,661"`). A floor derived from an unstated method is a floor nobody can re-derive.

**Resolution.** Name one extractor — `src/__tests__/structural/tauri-command-error-envelope.test.ts`'s scanner is the obvious candidate since it already exists and is already CI-gated — and have every path cite *its* number with the method named. Note its scope limit while you are there: it walks `src-tauri/src` only, so it structurally cannot see commands in `core/`, `db/`, `engine/`.

### C7 — `schema-change` and `boot-migration-step` disagree about the same lines of the same file

**`schema-change.md`:** *"**73 remain** (41 `let _ = ddl_step`, 32 `.ok()`)."*
**`boot-migration-step.md`:** *"`let _ = ddl_step(…)` / `ddl_step(…).ok()`. **41 and 13** instances in the migration body."*

Measured: `let _ = ddl_step(` = **42**, `ddl_step(…).ok()` = **13**, in `incremental.rs`. So the real total is **55**, `boot-migration-step` is right on `.ok()` and off by one on the other, and `schema-change`'s 32 is wrong by 19. `schema-change`'s "43% of ALTERs discard their Result" headline is downstream of that figure.

`boot-migration-step`'s §9 freezes `41 / 13 / 18` as a committed ratchet baseline. Shipping it at 41 when the real count is 42 makes the gate fail on its first run for a reason unrelated to any new violation — which is the fastest way to have it disabled.

**Resolution.** One of the two documents owns these counts (it should be `boot-migration-step`, whose whole subject is failure posture). Re-measure, fix both, and have `schema-change` cite rather than restate.

---

## 3. Gate defects

Ranked by how badly the proposed gate would fail its own purpose.

### G1 — `delete-semantics.md` Gates A and B run nowhere, on two independent grounds

> **Gate A … Mechanism.** A Rust `#[test]` in `db/src/migrations/` (**runs in `npm run test:rust`, already CI-gated**) over `init_test_db()` …

Both parenthetical claims are false.

1. `npm run test:rust` → `node scripts/build/run-rust-tests.mjs` → `cargo test --manifest-path src-tauri/Cargo.toml --features desktop **--lib**`. That is `personas-desktop`'s lib target only. A test in `db/src/migrations/` is in `personas-db` and is **not compiled**. The crates lane exists (`npm run test:rust:crates`, which does pass `-p personas-core -p personas-db -p personas-engine`) and the document does not mention it.
2. Neither `test:rust` nor `test:rust:crates` appears anywhere in `.github/workflows/` or `lefthook.yml`. `npm run test:rust` is **not CI-gated at all**. CI runs `cargo test` directly at `ci.yml:258` — without `--workspace`.

Gate B ("a Rust `#[test]` per pair, in the same module as the repo functions") lands in `db/src/repos/**` and inherits the same fate.

So the two gates that would catch the 113 unconstrained FK columns, the `mcp_gateway_members` dangling FK, and the blast-radius/delete divergence are specified into a lane that does not run, in a crate that is not compiled, behind a claim of existing coverage. **This is the worst defect in the corpus** — it is precisely the shape the contract exists to prevent, committed by the document whose own §9 opens by naming *"four artifacts manufacturing confidence"*.

**Fix.** State the same precondition `boot-migration-step` does, add `--workspace` to `ci.yml:258` (or wire `test:rust:crates` into CI) as an explicit step-zero, and re-verify with `cargo test -p personas-db <name>` before claiming a lane.

### G2 — `timestamp-storage.md` §3 and `json-blob-column.md` §3: same dead lane, no precondition

Covered in C2. Both assert existing coverage that does not exist. `timestamp-storage`'s Rust test is otherwise the best-designed behavioural check in the corpus (it asserts a `>= 250 tables seen` floor *and* forces a non-UTC `TZ` so the test can actually detect the bug it exists to prevent) — and it would never execute.

### G3 — `page-loading.md` has no §9

The document ends at "Gaps in the primitive". Gap 8 says *"Zero automated enforcement … Every deviation above was introduced under a green `npm run check`"* and proposes nothing. Neither do `tables.md` (Gap 9 sketches `custom/prefer-unified-table` inside a Gaps bullet) or `modals.md` (Gap 7 proposes re-keying the existing rule).

The contract makes §9 mandatory and states its purpose: *"gates will be built from their §9 sections."* Three of eighteen have no §9, and the one with genuinely nothing is the **most load-bearing UI standard in the codebase** — the one the spine itself cites as the motivating example for the whole re-taxonomy.

**Fix.** `page-loading` needs a §9. Its own text hands you the signal: `animate-pulse` in a `className` (223 lines / 174 files, ~107 live) plus `{loading ? <LoadingSpinner/>` — and `inline-busy-state.md` has already designed and costed the second half. Coordinate them (see G5) rather than writing two rules over one AST shape.

### G4 — `button.md` Signal A keys on a class combo the document transcribes incorrectly

> the complete accent triple `bg-{c}-500/10` + `text-{c}-400` + `border-{c}-500/2[05]` for one of the 13 `ACCENT_CLASSES` stems. **75 elements / 55 files.** … Zero judgment.

Actual `Button.tsx:68`:
```
violet:  'border-violet-500/25 bg-violet-500/10 text-violet-400 hover:bg-violet-500/20',
```
It is a **quad**, in border→bg→text order, and the border opacity is unambiguously `/25` across all 13 stems — never `/20`. The `2[05]` in the doc is almost certainly a misread of the *hover* opacity, which the doc omits entirely.

A rule implemented from the spec as written matches a different set than the 75 the doc counted, and the doc's "zero judgment / precision ≈ 100%" claim rests on a class list it got wrong. Same problem in the self-check: item 1 tells the implementer to assert `<Button size="icon-sm">` emits `w-7 h-7` **and** the `[@media(pointer:coarse)]` pair — but the doc's own prose renders that pair as `[@media(pointer:coarse)]:w-11 h-11`, and what ships is `[@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11` (both halves prefixed). An unprefixed `h-11` would break the resting height; a test asserting the doc's literal fails against correct code.

**Fix.** Re-derive Signal A's class set from `Button.tsx:65-79` verbatim and re-count. Everything else in this §9 — the sequencing, the four rot-guards, the "ship `unnamedControl` first because it does not depend on the radius decision" argument — is the best reasoning in the corpus and should not be touched.

### G5 — `inline-busy-state.md`'s `noopSpinner` at `error` is a 252-site migration sold as a one-liner

> Ship `noopSpinner` and `voidDisarmsGuard` at `error` from day one: both have bounded, fully enumerated corpora (252 and 34), and unlike the design-token migrations **there is no long tail to grandfather — every hit is a real defect with a one-line fix.**

By the document's own split, of the 252 `<LoadingSpinner>` sites only **75** are action controls (this leaf, one-line fix: switch to `AsyncButton`). **152 standalone + 4 `&&`-guarded are surface loading** — and their correct fix is `page-loading.md`'s calm-delayed ghost with matched geometry, deterministic bar widths and a `≥120ms` `animationDelay`, per surface. That is not a one-line fix; it is ~150 bespoke migrations, and `page-loading` Gap 2 says so outright (*"~70 module-local `*GhostRows` components re-implement the identical recipe"*, with no shared primitive to route to).

Shipping at `error` therefore red-builds ~150 surfaces whose remediation has no primitive yet.

**Fix.** Split the messageId by context, or ship `noopSpinner` at `error` **only** where the ternary's alternate branch is an icon/JSX element (the action-control shape, 75 sites) and at `warn` with a ratchet elsewhere until `page-loading`'s shared `<GhostRows>` exists. This is also the natural home for the §9 that `page-loading` is missing — one rule, two messageIds, one owner.

### G6 — `filesystem-boundary.md` part 2 lands in `personas-engine`

> **A Rust test in `engine::path_safety`, `guarded_path_commands`.** … Run it under `cargo test --features desktop` where `ci.yml:252-258` already runs.

`engine/` is the `personas-engine` crate. Same `--workspace` hole as G1/G2. The document is otherwise scrupulous about precondition failure (its "how it fails loudly" list is five separate assertions, including separate counters so one half cannot break behind the other) — and then places the test in a crate CI does not compile. Note that its **part 1** (the lexical-containment source-walk, the ~30-line check that catches the live vulnerability) has no such problem and should ship independently, as the document itself recommends.

### G7 — `polling-loop.md`'s `check-polling-backoff.mjs` needs interprocedural dataflow

> for each `usePolling` call site, resolve the `fetchFn` identifier to its definition and fail if every path through it ends in a `catch` with no `throw`.

The 11 call sites pass store actions from Zustand slices; the document's own P0 table traces each one across 2–3 files (`GlobalExecutionList.tsx:231` → `overviewSlice.ts:405` → `reportError`). Resolving an imported identifier through a barrel into a slice and then proving *every path* through it swallows is whole-program analysis, in a repo with 4,829 TS files, in a script with no type information. The doc prices it at one bullet.

It is also the only mechanism that could catch this leaf's P0 — so the honest move is the one the document already makes elsewhere: **name it as a review obligation.** Its §"The part no gate can cover" already does exactly this for contract rule 1; contract rule 4 belongs in the same paragraph.

### G8 — small but real

- **`client-state-persistence.md`** — the gate's allowlist omits `UnifiedTable.tsx` and `ColumnResize.tsx` (C4). It also asserts a two-sided parity check whose one side (`src/lib/storage/keys.ts`) does not exist yet; the doc says so under Sequencing, which is correct, but part 3's floor assertion (*"zero keys parsed from `keys.ts` … is exit 1"*) will fire from day one until the registry lands.
- **`dropdown-and-select.md`** — the ratchet asserts *"at most 46 select files and at most 43 mousedown files, and that every listed path still exists."* A file that is *renamed* (not deleted) trips the stale-entry check as a failure, which is correct, and a file that is *deleted* also trips it — so a legitimate deletion red-builds until someone edits the rule. That is the intent ("only ever tightens") but it should say so, since the first false red is when a ratchet gets disabled.
- **`ipc-command-authorization.md`** — correctly notes `generate-command-names.mjs:21` "currently matches only because `wrap_invoke_handler(` happens to end in `invoke_handler(`". That is a live single-point-of-failure across three parsers and deserves promotion out of a §9 sub-bullet into a P0 deviation.

---

## 4. Claims I checked and found wrong

Verified against source; everything not listed here that I checked came back TRUE, often exact.

| Claim | Document | Reality |
|---|---|---|
| `ALLOWED_KEYS` has **89** exact keys (stated twice) | `client-state-persistence.md` | **87.** `settings_keys.rs:719-809` — 89 is the non-blank line count, which includes 2 comment lines |
| **2,869** raw `<button>` elements | `button.md` | **2,888** (2,880 in `.tsx`; 2,875 excluding tests). The 1,119-file figure *is* exact on a `.tsx`-only basis |
| accent triple `border-{c}-500/2[05]` | `button.md` | A **quad**, border→bg→text→hover, border always `/25` |
| `[@media(pointer:coarse)]:w-11 h-11` | `button.md` | Both halves are prefixed: `…:w-11 [@media(pointer:coarse)]:h-11` |
| **129** `<BaseModal` sites / **128** files | `modals.md` | **130 / 129.** `LabVersionsTable.tsx` has two |
| `ddl_step(…).ok()` × **32** (→ 73 swallows) | `schema-change.md` | **13** (→ 55). `boot-migration-step` has this right |
| `let _ = ddl_step(` × **41** | `boot-migration-step.md` | **42** |
| "That test runs today in `ci.yml:258`'s `rust-tests` job" | `timestamp-storage.md` | It does not. No `--workspace`; `personas-db` is never selected |
| "Runs in `ci.yml`'s existing `rust-tests` job with no new infrastructure" | `json-blob-column.md` | Same |
| "(runs in `npm run test:rust`, already CI-gated)" | `delete-semantics.md` | `test:rust` is `--lib` on `personas-desktop`, and appears in no workflow |
| "all **564** `.rs` files under `src-tauri/` (all workspace crates)" | `filesystem-boundary.md` | 564 is `src-tauri/src/`. The tree is **963**. The stated sweep scope is ~41% short of its claim |
| `Situation node: frontend/surfaces/{tables,modals}`, `frontend/motion/page-loading` | 3 paths | No `frontend` domain exists in `situation-spine.json` |
| `integrations-external/external-and-host/filesystem-boundary` | `filesystem-boundary.md` | `integrations-security/external-and-host-surfaces/filesystem-boundary`. Its *metadata* (sides/convergence/risk/recurrence 157/twoSided/fused) is exactly right — only the address is wrong |
| **1,657** `#[tauri::command]` definitions | `ipc-command-authorization.md` | The structural test's scanner returns **1,661** at that commit; naive grep returns 1,673 |
| filterable mode "accepts **8** of `SelectHTMLAttributes`' props" | `dropdown-and-select.md` | The `Pick` has **9** keys, of which only **3** (`className`, `disabled`, `aria-label`) are `SelectHTMLAttributes`. The substantive claim — the prop drop — is TRUE and is the leaf's most important finding |
| three-state body at `UnifiedTable.tsx:593-612` | `tables.md`, `page-loading.md` | That range holds states 1–2 only; the rows branch is a separate sibling block at `:614-686` |
| `UnifiedTable` localStorage at `:473-481` | `client-state-persistence.md` | Two sites: read `:48`, write `:477`. The read is uncited |
| `situation-spine.md`: **260** leaves / **153** twoSided / **21** fused | taxonomy doc | The JSON says **247 / 142 / 34**. The `.md` predates the seam-pass commit `7bb572e2b` ("260 -> 247 leaves") and was never updated — while the contract points readers at the `.md` |

**Two things I expected to be wrong and were not**, worth recording because they are the corpus's load-bearing claims:

- **The live path traversal.** `desktop_bridges.rs:905/914/921/964` — `vault.join(path).starts_with(vault)` with no canonicalisation and no `Component::ParentDir` rejection — was exactly as described, in `ReadNote` / `WriteNote` / `AppendToNote` / `ListNotes`, reachable from a persona-influenced `path`, with no outer guard. **A fix landed in the working tree during this review** (`resolve_vault_path` → `path_safety::resolve_within_root`, plus a 331-line addition to `path_safety.rs` introducing the shared anchored resolver the document says is missing). Read `filesystem-boundary.md` Gaps 1–2 as *closed in flight*, not as defects.
- **`persona_tombstones`.** 8 references, **0 `INSERT`s**, exactly as `delete-semantics.md` states. A delete-propagation lane that was created, indexed, sync-watermarked, read and drained, and never written.

---

## 5. What is missing from the corpus

These are situations the 18 imply, name, or depend on, and none of them covers.

1. **The `--workspace` fix itself.** Four documents' gates depend on it; one names it; nobody owns it. It is a one-line change to `ci.yml:258` that re-activates 369 existing `init_test_db()` call sites in `personas-db`. It should be a P0 backlog item with a named owner, not a precondition mentioned in four different §9s.

2. **The design-token / shared-primitive blind spot.** Three independent paths found the same root cause from three directions — `button.md` (Button renders `rounded-xl`; `Design.md` mandates `rounded-interactive`), `form-field-and-validation.md` (`INPUT_FIELD` is `rounded-xl`; the token is `rounded-input`), `dropdown-and-select.md` (five select radii; `rounded-input` used by **none**) — and all three trace it to `no-raw-radius-classes.cjs` exempting `src/features/shared/components/` and `designTokens.ts` by name. **The gate is blind to the files that define every control in the app.** No leaf owns "what radius is a control", so three paths each propose a partial fix and none can ship without the others. This needs to be one decision recorded in `Design.md`, not three.

3. **Backend-to-frontend events (`app.emit` → `listen`).** `polling-loop.md` names it as the primary escape hatch, measures its divergence (~31 typed calls against 200 `.emit(` + 40 `.emit_to(`), and correctly declines to absorb it. Nothing else covers it, and "just use events instead" is the recommended answer in at least two paths.

4. **Row-level authorization.** `delete-semantics` Gap 11 and `ipc-command-authorization` Gap 7 independently arrive at the same undeclared boundary: every guard in the app is session-level, none is ownership-level, and `crud_delete!` hardcodes `WHERE id = ?1`. Both correctly call it defensible for a single-user desktop app and both flag it as a landmine for the shared-workspace direction the repo is building toward. Nobody owns the decision.

5. **A shared atomic-write / `fs_util` primitive.** `filesystem-boundary` Gap 9 is explicit that this is the one place the answer is *write a new primitive* rather than *route to an existing one* — seven hand-rolled writers, one `sync_all()` in the whole tree, zero parent-directory fsyncs. That is a construction situation with no leaf.

6. **The catalog-extraction defect.** Five separate paths independently found the same failure: a component with no `@catalog` tag gets a *plausible truncated fragment of an unrelated prop comment* rather than a blank — `DataGrid` → `"CSS grid fraction, e."`, `ThemedSelect` → `"Extra wrapper classes (width, margin, etc."`, `ConfirmDestructiveModal` → `"Modal title, e."`, `DirectoryPickerInput` → nothing, `DropZoneGlow` → its `radius` prop. The catalog `CLAUDE.md` mandates consulting describes four of the corpus's mandated primitives as gibberish. `dropdown-and-select` proposes the one-line generator fix; it belongs upstream of all five.

7. **A "how a golden path gets verified and expires" leaf.** `situation-spine.md` names the risk (*"A stale golden path teaches confidently wrong things — worse than none. Each needs an adoption decision, a verification query, and a `verified_at`"*). Nothing in wave 1 carries a `verified_at`, a verification query, or a stated expiry. Two documents already contain dated evaluator corrections, which proves the need is live — the mechanism is missing.

8. **Reversal / undo.** `delete-semantics` §"No reversal anywhere" establishes there is no trash, no soft delete, no restore for any entity, and that `backup_before_migrations` writes a snapshot the product cannot read back (`boot-migration-step` Deviations D: *"No restore path exists"*). Two paths independently discover that the app's safety net is write-only. That is a product decision with no home.

---

## 6. Top 5 revisions, ranked by cost of leaving them

**1. Fix the four gates that would run nowhere, and land `--workspace`.**
`delete-semantics` Gates A+B, `timestamp-storage` §3, `json-blob-column` §3, `filesystem-boundary` part 2. Cost of leaving it: these are exactly the gates that would catch a dangling FK, a corrupt-blob row disappearance, a shape-divergent timestamp column and an unguarded path command — and each would be built, merged, marked done, and never execute. The corpus would manufacture the confidence it was written to withdraw, in its own §9 sections. `boot-migration-step.md` already contains the correct paragraph; copy it into all four and add `--workspace` to `ci.yml:258` as the first backlog item.

**2. Re-address the four broken topic paths and settle the overlapping leaves.**
Three paths point at a domain that does not exist; one points at the wrong domain *and* subdomain. Cost of leaving it: ingestion writes `violating` cells under keys the tree cannot resolve, and the apply campaign — the thing this whole restructure exists to feed — consumes them. Do it before ingestion; it is unrecoverable after. In the same pass, decide whether `tables`/`modals`/`page-loading` own their 3–6 leaves or must be narrowed, and reconcile `modals` ↔ `dropdown-and-select` on anchored popovers.

**3. Strike `#[requires(auth)]` from `delete-semantics` and re-key its Gate C on list membership.**
Cost of leaving it: the corpus is about to become binding doctrine. A session following `delete-semantics` for an async destructive command writes an unguarded command *and* a gate that certifies it. This is the only place in the corpus where following a path produces a security defect rather than merely a style one.

**4. Give `page-loading.md` a §9, jointly with `inline-busy-state`'s.**
Cost of leaving it: the single most load-bearing UI standard in the codebase ships with no enforcement proposal at all, while its sibling ships one that would red-build ~150 of its surfaces at `error` on day one. One rule, two messageIds, one owner, and the `animate-pulse` signal `page-loading` already measured (223 lines / 174 files). Leaving it means the loading doctrine keeps being enforced by prose — which the corpus's own founding measurement says does not work.

**5. Re-derive the disputed counts and name one method per quantity.**
Four values for `#[tauri::command]`, two for `.ok()` in `incremental.rs`, 89-vs-87 for `ALLOWED_KEYS`, 2,869-vs-2,888 for raw buttons, 129-vs-130 for `<BaseModal>`. Cost of leaving it: three §9 sections put *floor assertions* on numbers nobody can reproduce, and a ratchet baseline seeded at 41 when the truth is 42 fails on its first run for a reason unrelated to any violation — which is how a ratchet gets disabled in week one. Also update `situation-spine.md`'s 260/153/21 to the post-seam-pass 247/142/34, since the contract sends readers there first.

---

*Nothing in this review was committed. The two files under concurrent edit
(`src-tauri/engine/src/desktop_bridges.rs`, `src-tauri/engine/src/path_safety.rs`)
were read as-is; the traversal fix in flight is noted where it applies.*
