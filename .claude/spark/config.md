---
product: "Personas desktop app"
stack: "Tauri 2 + React 19 + TS + Tailwind 4 + Zustand 5; local-first SQLite; Rust backend under src-tauri/"
vault: ["C:/Users/kazda/Documents/Obsidian/personas", "C:/Users/mkdol/Documents/Obsidian/personas"]
vault_subdir: Spark
context_map: context-map.json
base_branch: master
active_runs_ledger: .claude/active-runs.md
locale_count: 14
---

# spark overlay - personas (desktop)

Carries verbatim what the `spark` 1.0.0 SKILL.md body hardcoded, so behaviour here is unchanged
by the 1.1.0 generic rewrite.

## Overlay split - this file vs the vault

`$VAULT/Spark/config.md` already exists (scaffolded by 1.0.0, 2026-07-31, in active use).
**Resolution order is repo overlay -> vault config.md -> defaults**, so:

- **This file owns** the engineering facts: `## Gates`, `## Rituals`, `## Repo law`, `## Wave defaults`.
  They are tracked in git and travel with the clone. The vault's own `## Gates` and `## Wave defaults`
  sections are **superseded** by these - do not read them, and do not maintain two copies.
- **The vault owns** the learned/append-only sections: **`## Question taste`** and
  **`## Skill improvement log`** live at `$VAULT/Spark/config.md` and are NOT duplicated here.
  Phase 3 reads taste from there; Phase 6 appends improvement-log lines there. That file is personal
  data and is not version-controlled - never copy its contents into this repo.

## Gates
- always: `npm run check`, `npm run test -- --run`
- when locales/strings touched: `npm run check:i18n:strict`
- when Rust touched: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` + `npm run test:rust`
- when ts-rs types change: `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings`,
  then commit `src/lib/bindings/`
- builder: **vitest cannot be run whole here** - `src/features/agents/sub_activity/__tests__/activityTabRunsRegion.test.tsx` kills its worker instead of timing out, so `npx vitest run` never terminates (reproduced on master, 2026-09-22, by three builders independently). Shard it: `npx vitest run --reporter=dot --shard=1/4` .. `4/4`, state the passed count per shard, and never report a pass from a run that did not print a count.
- builder: **never `npm run census -- --update` while a sibling's files are uncommitted** - it re-baselines their drift under your commit. Report drops with their traced cause; the Director ratchets on the clean tree, after tracing each drop to a removal in the branch diff (2026-09-22: six drops, six removals, five minutes).
- builder: `npm run gate -- --cold` (the worktree delta: tsc, eslint, census vs master - REQUIRED before reporting, and COLD:
  on 2026-09-20 a builder's warm gate read green over three real census rises in its own new files, the second sighting of a
  stale warm verdict; the Director also reviews on `--cold` only; on 2026-09-18
  thirteen census rises reached the merge gate because builders ran only the lines below) | `npx tsc --noEmit` | `npm run lint` (no NEW warnings in files you touched) | targeted vitest
  | `npm run check:i18n:strict` if you touched strings/locales | `cargo test export_bindings` (+ commit
  `src/lib/bindings/`) if you touched Rust structs
- Gate calibration: gate on *no NEW warnings in files this diff touched* - a full-crate clippy at
  `-D warnings` fails on pre-existing warnings here; compare against master for the same files.
- Contract freeze for a Tauri feature: TS wrappers typecheck only once the command paths sit in a `generate_handler!` list and
  `node scripts/generate-command-names.mjs` has run, so the Director registers them in WP0 and tells the Rust package the crate
  will not compile until it lands. A contract field typed `number` names `i32`/`u32` in the Rust brief (ts-rs emits `bigint` for
  i64/u64/usize); diff the regenerated binding against the frozen one.
- Never bare `cargo test` on Windows (the lib unit-test binary dies in the loader, exit 127);
  `npm run test:rust` embeds the comctl32-v6 manifest post-link.

## Rituals

**Phase 0 - register in the live-sessions ledger** (one bash invocation each; never hand-edit the ledger):
```bash
node scripts/active-runs.mjs check --paths "<globs this spark will touch>"
node scripts/active-runs.mjs register --slug spark-<slug> --title "<the spark, one line>" --paths "<globs>"
```

**Phase 3 - capture every operator correction to the Decision Mirror, in the same turn as the correction:**
```bash
MSYS_NO_PATHCONV=1 node scripts/decision-ledger/capture-decision.mjs --correction "<what the user directed, near-verbatim>" --was "<what you were doing>" --context "<one-line situation>"
```
The `MSYS_NO_PATHCONV=1` prefix is load-bearing on Windows. The ledger is personal data:
gitignored, never committed, never quoted into committed files.

**Phase 5 - close every i18n gap before the commit that introduces the keys** (the `i18n-no-gaps`
pre-commit hook blocks a commit that stages `src/i18n/locales/*.json` with a gap):
```bash
node scripts/i18n/translate-extract.mjs
# fan out: one Sonnet subagent per non-English locale fills .i18n-work/missing-<code>.json
node scripts/i18n/translate-merge.mjs
```
Inline Director translation is fine to ~10 keys; beyond that batch locales across ~4 agents.

**Phase 6 - deregister with the outcome:**
```bash
node scripts/active-runs.mjs complete --slug spark-<slug> --status "completed (commit: <sha>)"
```

## Repo law
Authority: `.claude/CLAUDE.md` (parallel-safety primitives apply in full).
- Read `.claude/CLAUDE.md` and `.claude/Design.md` before any UI; reuse `src/features/shared/components`
  (`CATALOG.md`) - never hand-roll spinners/modals/tooltips/buttons; semantic tokens only
  (`typo-*`, `rounded-*`, `shadow-elevation-*`). Loading pattern v2 (`docs/design/overview-loading.md`):
  ghost-under-chrome for surfaces, a real spinner only on an action control.
- Every user-facing string goes through `t.section.key` and is translated into all 13 other locales
  in the same change (see the Phase-5 ritual).
- IPC via `invokeWithTimeout`; errors via `toastCatch`/`silentCatch` + the error registry;
  components under 200 LOC.
- Commit form: the repo mandates an **isolated-index** commit
  (`GIT_INDEX_FILE` seeded with `git read-tree HEAD`) over your own paths, in ONE bash invocation.
  Never `git stash`, never `git add -A`/`.`/`-u`, never bare `git commit`.
- Staging list: build it from EXPLICIT paths, never from a directory-prefix regex over `git status --porcelain`
  (porcelain prints files, so an anchored `^dir/` pattern drops every file under it; three commits shipped
  incomplete on 2026-09-16). In the SAME invocation as the commit, assert `git show --name-status HEAD | wc -l`
  equals the intended count, and `git diff --cached --name-status | grep -c "^D"` is 0 unless deleting on purpose.
- UI packages prove themselves on the INTEGRATED page: screenshots of the real page shell (`ContentBox` / `ContentHeader` / `ContentBody`) at 1280x800 and 1920x1080, dark and light, committed beside the design reference, and the Director opens them. A full-bleed page uses `<ContentBody flex>` + a `flex-1 min-h-0` child (the default branch is a padded scroller). Only `typo-body-lg` and `typo-heading` are colourless; `typo-caption`, `typo-title` and `typo-section-title` set a colour that beats a sibling `text-*`.
- Before calling a merge blocked by a sibling's dirty files, compare the working tree with HEAD (`git diff HEAD --stat`; `git cat-file -e HEAD:<path>` per 'untracked' file): isolated-index commits leave the shared index stale, and most of the porcelain can be phantom.
- Doc-sync: user-visible changes update the mapped `docs/features/*` (+ onboarding flow / marketing
  module if `scripts/docs/feature-doc-map.json` maps one). Ask the scout in Phase 2 whether the target
  source paths are covered by that map at all.
- New Rust types with ts-rs: run the `export_bindings` gate above and commit `src/lib/bindings/`.

## Context map
`context-map.json` at the repo root. Note the standing three-way disagreement documented in
`.claude/CLAUDE.md`: the committed file is a peer device's finer partition, the local app DB holds a
coarser one, and they intersect in 2 names. Use the **file** for targeting (the truer partition) and
the **local DB's `dev_contexts` names** for anything the app anchors to.

## Wave defaults
- Wave = one AskUserQuestion call, up to 4 questions. Uncapped waves; clarity terminates.
- Perspective checklist: functional scope | data model & persistence | IPC surface | UX flow +
  async/empty/error states | UI + shared-component reuse | i18n | performance | failure modes |
  docs-sync | out-of-scope.

## Question taste
See `$VAULT/Spark/config.md` -> `## Question taste`. Not duplicated here (see Overlay split above).

## Skill improvement log
See `$VAULT/Spark/config.md` -> `## Skill improvement log`. Append there, not here.
