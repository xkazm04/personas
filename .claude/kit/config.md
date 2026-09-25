---
product: "Personas desktop app"
vault: ["C:/Users/kazda/Documents/Obsidian/personas", "C:/Users/mkdol/Documents/Obsidian/personas"]
vault_subdir: Kit
features_root: src/features
entry: src/main.tsx
aliases: "@=src"
kit_path: src/features/shared/components/kit
doctrine: docs/design/style-mastery/doctrine.md
batch_builders: 5
contest_seats: "claude:opus@xhigh,claude:fable@high,codex:gpt-6-sol@high"
---

# kit overlay - personas (desktop)

The setup track ran here as the spark `style-unification` (2026-09-24 .. 2026-09-25), before the skill
existed; its record is the vault note `Spark/ideas/style-unification.md`. Setup is COMPLETE: the kit is
promoted (`26c19f6a5`), the doctrine has the kit section (6b), and five module gates passed. `/kit` here
starts in the batch track.

## Gates
- builder: `npm run gate -- --cold` (tsc + eslint on changed files + census as a delta; COLD only - the warm
  daemon has read green over real rises); `npx tsc --noEmit`; eslint on touched files (no NEW warnings);
  targeted vitest with counts (the whole suite cannot run here: a test kills its worker - shard with
  `npx vitest run --reporter=dot --shard=i/4`); `npm run check:i18n:strict` when strings change.
- Director at batch close: `npm run census:check` on a clean tree; ratchet drops only after tracing each to a
  removal in the batch diff (`npm run census -- --update` then commit it alone); never re-baseline a rise.
- Theme colour: `npm run check:themes` (contrast + CIEDE2000 role/status distinctness) when roles move.

## Instruments
- Divergence: `node scripts/style/style-divergence.mjs --repo . --out tmp/style-divergence` (CSS weight 0).
- Reachability: `node scripts/style/reachability.mjs [--json]` (entry src/main.tsx, `@` = src).
- Shooter: `node scripts/style/shoot.mjs --module <id> --tape <tape.json|synthetic> --out <dir> --label <before|after> --sizes 1280x800,1920x1080,1440x3200`
  and `--pair <before-dir> <after-dir> --out <dir>`. Modules register in `scripts/style/page-harness/`
  (registry + a synthetic tape builder; one entry per view). Docs: `docs/design/style-mastery/instruments.md`.
  Never record a tape from the running app (it drives the operator's window); synthesize from bindings/fixtures.
- Family image: `${CLAUDE_SKILL_DIR}/scripts/family.py` (Pillow), kit reference page = `fleet/activity`.
- Scratch for briefs and shots: the session scratchpad (`spark-style/` precedent).

## Repo law
Authority: `.claude/CLAUDE.md` + `.claude/rules/ui.md` (path-scoped; the kit is in its do-not-hand-roll table).
- Build in the MAIN checkout (operator rule: exactly one Personas worktree, the sim-app); builders on disjoint
  files; isolated-index commit in ONE bash invocation (`GIT_INDEX_FILE` seeded with `git read-tree HEAD`),
  explicit paths, assert no staged deletions, then `git reset -q -- <own paths>`; never `git stash`, never
  `git add -A`, never push.
- Every user-facing string through `t.section.key`, all 14 locales in the same commit.
- IPC via `invokeWithTimeout`; errors via `toastCatch`/`silentCatch`; components under 200 LOC; no em dash.
- The kit: `@/features/shared/components/kit` (KitHost, Surface, Split, Drawer, Section, ListRow/Rows,
  DataTable (sortable), StatStrip, KeyValueGrid, ChipRow, Toolbar (Segmented, SearchField, KitButton),
  RangePicker, ChartFrame + toneColor, UnitStrip, Mark/Dot, Ghost). Approved kit pages: Fleet Activity,
  Observability (Overview tab), Factory (Teams). A `Split` main column is ONE element.
- Tokens are in `@layer components`: a utility beside a token wins; tinted title tokens keep their tint;
  dense tool surfaces opt into `data-type-density="compact"`.

## Visibility order
home, overview, agents, vault, settings, then plugins, companions, teams, triggers, templates, the rest
(owner, 2026-09-25: "What you see most").

## Rituals
- Batch open/close: `node scripts/active-runs.mjs register|complete --slug kit-<batch> ...` (one bash call each).
- Owner correction: `MSYS_NO_PATHCONV=1 node scripts/decision-ledger/capture-decision.mjs --correction "..." --was "..." --context "..."`.
- Strings: `node scripts/i18n/translate-extract.mjs` -> fill per locale -> `node scripts/i18n/translate-merge.mjs`.

## Taste
- Keeps brand tint and glow (Gate 0 titles, Gate 1 primary-glow rail); calls their removal a degradation.
- Judges by eye: gate kit = screenshot pairs + numbered decision list; cut the metric card and live walk.
- Grades what the surface visibly does (fit, height, wrapping, crammed cells) over token counts (Gate 2).
- Row-height rhythm is sacred (Gate 2b: reverted a fold that saved height).
- Weight hierarchy, one emphasis per row, compact type on tool surfaces (Gate 3).
- Chose the more visual kit (drawn unit quantities) over the one that matched its source perfectly (Gate K2).
- Setup/"waiting on you" reads info-blue, not the pink human role (Gate 5).

## Skill improvement log
