---
product: "Personas desktop app"
stack: "Tauri 2 + React 19 + TS + Tailwind 4 + Zustand 5; local-first SQLite; Rust backend under src-tauri/"
vault: ["C:/Users/kazda/Documents/Obsidian/personas", "C:/Users/mkdol/Documents/Obsidian/personas"]
vault_subdir: Perfect
base_branch: master
wave_size: 3
lot_caps: {rust: 2}
pool_target: 10
round_shape: pool
cooldown_rounds: 2
commit_format: "feat(<context>): <title>"
context_map: context-map.json
active_runs_ledger: .claude/active-runs.md
locale_count: 14
---

# perfect overlay - personas (desktop)

`.claude/active-runs.md` is the live-sessions ledger: read it at Phase 0, surface overlaps, append this
session's entry; move it to Recently completed with SHAs at Wrap. If it shows another session live in the
main checkout, the wave goes to ONE worktree (never one per builder).

**Rust-touching lots: <= 2 concurrent** (`lot_caps.rust`). Round 4 measured why: three different source
paths thrashing one `CARGO_TARGET_DIR` produced single compiles of 24m05s and 28m29s. Within one tree
cargo's target-dir lock serialises compiles for free - a lock wait is normal; ending the turn is not.

## Gates
- always: `npm run check`, `npm run test -- --run`
- when locales/strings touched: `npm run check:i18n:strict`
- when Rust touched: `cargo clippy`/`cargo check` + `cargo test --lib --features desktop`
- slow: none
- builder: `npx tsc --noEmit` | `npm run lint` (no new warnings in files you touched) | targeted vitest
  | `npm run check:i18n:strict` if you touched strings/locales | `cargo test export_bindings` (+ commit
  `src/lib/bindings/`) if you touched Rust structs. Then drive the actual flow when a dev server is
  available; report what you COULD NOT verify honestly.
- Gate calibration: gate on *no NEW warnings in files this diff touched* - full-crate clippy
  `-D warnings` fails on hundreds of pre-existing warnings here; compare against master's warnings for
  the same files before blaming the diff.

## Class B
- `src-tauri/src/lib.rs` command registrations
- `mod` / `pub use` lists
- `CHANGELOG.md`

## Class C
- `src/i18n/locales/*.json` + everything generated from them
- `src/lib/bindings/`
- `commandNames.generated.ts`
- any codegen output
- Director applies at quiescence, once each: regenerate i18n from the builders' reported key fragments
  (`gen-types.mjs` + `split-locales.mjs`), `cargo test export_bindings`, `generate-command-names.mjs`.
  Builders report new i18n keys as a JSON fragment and new ts-rs structs by name. This deletes the
  locale-conflict machinery rounds 1-2 had to invent.
- Commit form: the repo's `.claude/CLAUDE.md` parallel-safety primitive #5 mandates an **isolated-index**
  commit (`GIT_INDEX_FILE` seeded with `git read-tree HEAD`) over the builder's paths; use it in briefs
  in place of `--only` where the repo law says so. Both take whole-file working-tree content.

## Repo law
Authority: `.claude/CLAUDE.md` (parallel-safety primitives apply in full).
- Read `.claude/CLAUDE.md` § Styling before any UI; reuse `shared/components` (CATALOG.md) - never
  hand-roll spinners/modals/tooltips/buttons; semantic tokens only (`typo-*`, `rounded-*`,
  `shadow-elevation-*`).
- Every user-facing string: add key to `src/i18n/locales/en.json` AND translate into all 13 other
  locales yourself via `scripts/i18n/translate-extract.mjs` -> fill `.i18n-work/missing-<code>.json`
  (medium quality fine) -> `translate-merge.mjs`. The pre-commit hook blocks gaps.
- IPC via `invokeWithTimeout`; errors via `toastCatch`/`silentCatch` + error registry; components < 200
  LOC.
- New Rust types with ts-rs: run `cargo test export_bindings` and commit `src/lib/bindings/` changes.
- Review conventions (Director): shared-component catalog, design tokens, i18n keys,
  `invokeWithTimeout`, error registry.
- Doc-sync: user-visible changes update the mapped `docs/features/*` (+ onboarding flow / marketing
  module if mapped) - the Stop hook will demand it anyway.

## Context sources
- As of 2026-08-08 THREE sources disagree: the committed `context-map.json` is a **peer device's**
  post-consolidation partition (208 contexts, produced by `consolidate-contexts`, commit `976da4c5f`
  "767 -> 208", confirmed correct by the operator); the **local app DB holds 49 coarse contexts / 8
  groups** from an older scan; `.personas/contexts.txt` holds 773 pre-consolidation names dumped by the
  peer. Map ∩ local DB = 2 names. There is no import path - `context-map.json` is export-only - so
  `git pull` does NOT sync a peer's rescan into this machine's DB.
- **2026-09-01: the local DB was RESCANNED on 2026-08-29 into 480 `dev_contexts`** (the 49-context note above
  is stale). Map names such as `fleet-session-grid` / `commands-fleet` / `fleet-monitor-channels` are still
  NOT DB names; `fleet-monitor` and `team-channels` are. Query the DB before anchoring:
  `sqlite3 "file:C:/Users/mkdol/AppData/Roaming/com.personas.desktop/personas.db?mode=ro" "select name from dev_contexts where name like ...".`
- Use the map for the QUEUE (the finer, truer partition) and the LOCAL DB's `dev_contexts` names for
  anything the app anchors to (outbox `context`). Provenance check:
  `node -e 'const m=require("./context-map.json");console.log(JSON.stringify(m.project||m.$schema||{}))'`

## Smoke
- Drive the USER'S running instance via the **:17320 bridge** (verify a new-code marker first - never
  trust a stale port); read-mostly navigation.
- Primary diagnostic: read-only sqlite3 against the live DB (`sqlite3 "file:<path>?mode=ro"`) - the same
  DB whose `dev_contexts` table names the coverage contexts.
- State-dependent surfaces that keep rolling over go to a fresh-DB harness session instead.

## Opportunity arcs
- Judged from context-map metadata, `docs/features/*`, and memory; active arcs in memory.

## Vetoes
- "Langfuse REMOVED - don't re-suggest" (and any other "removed, don't re-suggest" memory).

## User taste
- Learned through round 8: accepts **outcome-value work** (features / optimizations with a visible user
  payoff); rejects **cosmetic churn** (e.g. dark-mode remount tweaks).
- Engine depth for contexts with backend/algorithmic substance (data model, algorithms, lifecycle,
  prompt/recall paths, cost structure); UI surfacing at most once-twice unless steered.

## Skill improvement log
- (migrate the existing entries from `$VAULT/Perfect/config.md` on the first 2.3 run, then append here)
- 2026-09-01 (round 2): 8/8 accepted, 8/8 shipped in ONE wave on master (4 lots, rust cap 2, B after A). What dragged: the shared `.git/index` goes stale after every isolated-index commit, so `git status` shows phantom `MM`/`D` and `git diff HEAD --stat` REPORTS NEW FILES AS DELETED (they are on disk; the index simply lacks them) - resync with a guarded mixed `git reset` only when `git diff --cached --name-status` lists nothing foreign. Python `open(p,'w')` on Windows writes CRLF into LF files (en.json, 3 .rs files) - use `newline='
'` or `sed -i 's/$//'` after. `printf` with a literal `%` truncates a vault note silently. A SendMessage addendum to a builder that already reported DOES resume it (lot D converted transcript.rs after its final report). Builder-corrected brief numbers: ai-title 32/60 (scout) was really 7/60 - re-measure counts before they reach a brief. The builder-brief template's tsc-vs-Class-C contradiction from session 1 was fixed in these briefs ("missing t.<key> errors are EXPECTED") and produced zero confusion.
- 2026-09-01 (round 2): the registry map's `deviation` entries are the best direction seed in the vault - both slates carried one pre-approved deviation (one-state-door shipped; heterogeneous-model-panels deferred to the engine context). Read `.ai/registry-map.json` for the cursor context BEFORE scouting; it names the file:line.
