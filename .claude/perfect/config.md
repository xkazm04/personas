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
- **CORRECTED 2026-09-02: the "480 contexts" figure was the WHOLE `dev_contexts` table across 15 projects.** Filter by
  `project_id = '07fe9de7-ef68-4ce6-a78e-551c09acbdce'` (personas): it still holds **49** contexts, so the 49-name rule above stands. Map names such as `fleet-session-grid` / `commands-fleet` / `fleet-monitor-channels` are still
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
- 2026-09-02 (round 3): 24/24 accepted, 24/24 shipped in TWO waves on master (5 lots each; rust cap 2; sequential lots gated on reports). Five contexts slated (fleet-terminal-manager, fleet-monitor-shell, execution-replay, agents-executions-components, engine-build-session); one operator REJECT (cacheable-prompt inversion) and two product decisions asked as their own question (revive vs retire ExecutionList; fan-out fate) - separate decision questions work well for slate items that are really product calls. What dragged: two builders died AT THEIR GATE with complete test-green work on disk (session limit / stall) - salvage first, always; a builder (lot E) wrote CRLF into three LF files and used jest-dom matchers no tsc types are wired for - briefs now say LF explicitly and the Director normalises before commit. `cd src-tauri` in a Bash spot-check persisted across tool calls and broke a later relative path - never cd in Director shell calls. The corpus check failed on a golden path citing a file a builder deleted - deletions need a `grep -rn <path> docs/` before commit. Census: real drops from deletions are the normal outcome of a wave and want a Director ratchet commit; rises from test fixtures want the rule EXCLUDE with a reason, never --update. Lot G/I builders corrected the brief premise with measurements (denominator unknowable; drop-rows on the persona-switch path) - premise corrections are evidence, keep them in the vault. build.rs is a Director-grade file: the first embed shipped 2.2 MB because serde_json was not a build-dep and Cargo.toml was outside the write set; extend the write set rather than accept the deviation. The '480 contexts' note was wrong: the DB spans 15 projects; personas still has 49 - always filter dev_contexts by project_id.
- 2026-09-02 (round 3): the registry-map deviations seeded 4 of the 24 directions and two of them were MIS-DESCRIBED (broadcast text\r: the split already existed, the real hole was paste framing; cost_usd coercion: real mechanism, zero occurrences) - a deviation is a lead, the scout still re-verifies it, and a refuted-as-written deviation is worth recording in the context note for /conform.
- 2026-09-03 (round 3, cycles 2-3): 21 more directions accepted (commands-execution 4/5, hooks-realtime 6/6 incl. a separately-gated repo-wide addendum, hooks-execution 5/5, lib-execution 6/6) and 21/21 shipped in waves 3-4. New this cycle: an addendum via SendMessage extended a running lot's write set (Cargo.toml for a build-dep) rather than accepting a 2.2 MB deviation; a sequential lot (Q after R) shared a file cleanly; two limit-killed builders were resumed from their transcripts with a state-on-disk message and both finished. Recurring: the shared .git/index accumulates phantom AD/D entries for siblings' new files - resync with a guarded mixed reset at each quiescence and tell every brief that git status lies. A builder's zero-result Node execSync+grep scan on Windows was entirely invalid (cmd.exe argv) - scouts and builders must scan with the Grep tool or Git Bash and prove a known positive. Builders that ended a turn on a pending cargo lock needed a nudge (6-9 min lock contention between two Rust lots is normal). Doc citations of deleted files: the corpus gate reads evidence frontmatter only; prose citations are annotated by the Director, not rewritten. Vitest reds that pass alone are load timeouts under parallel builders - re-run in isolation before calling them regressions.
