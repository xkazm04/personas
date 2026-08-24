---
product: "Personas desktop app"
stack: "Tauri 2 + React 19 + TS + Tailwind 4 + Zustand 5; local-first SQLite; Rust backend under src-tauri/"
vault: ["C:/Users/kazda/Documents/Obsidian/personas", "C:/Users/mkdol/Documents/Obsidian/personas"]
vault_subdir: Explorer
context_map: context-map.json
coverage_context_source: ".claude/codebase-context.md"
active_runs_ledger: .claude/active-runs.md
---

# explorer overlay - personas (desktop)

The `vault` list is the SAME Obsidian vault named `personas` on two machines - `kazda` and `mkdol`
hold it under their own `Documents/Obsidian/`. First existing wins; the skill's `<repo>/.explorer/`
fallback is the last resort and means neither machine's vault was found (git-ignore it if it appears).
`$VAULT/Architect/strong-patterns.md` is written by `/architect` into the same vault - Phase 1 reads
it, and a proposed fix should take the shape of an existing strong pattern rather than invent one.

`.claude/active-runs.md` is the live-sessions ledger: append the area's paths as your scope at
Phase 3, move the entry to `## Recently completed` with the SHA at Phase 9. Edit it in ONE bash
invocation. Overlap on the ledger itself is expected and is not a conflict. Format conventions live
at the top of the file; rationale in `docs/architecture/cli-coordination.md`.

## Context sources
1. `.claude/codebase-context.md` - the area taxonomy: 49 contexts under 8 groups, with `Files:`,
   `Keywords:` and `Entry points:` lines, and a `Generated:` staleness signal. Refreshed by
   `/refresh-context`.
2. `.claude/codebase-stack.md` - engine internals and conventions.
3. `.claude/CLAUDE.md` - project rules (i18n, design tokens, error handling, the lint baseline,
   parallel safety).
4. `context-map.json` (repo root) - the machine-readable map; scoping tiebreak only, see
   `## Coverage names`.

## Area menu
The 8 groups of `.claude/codebase-context.md`:
agents (Agent Platform) | execution (Execution Engine) | observability (Observability) |
automation (Automation & Pipelines) | collaboration (Team Collaboration) |
security (Security & Credentials) | plugins (Plugin Ecosystem) | platform (Platform Infrastructure)

## Gates
- TypeScript touched -> `npx tsc --noEmit`
- Frontend touched -> `npm run lint` (warnings at the ~10k baseline are OK; errors and NEW warnings
  in the files you touched are not)
- Rust touched -> `cargo check` in `src-tauri/` (needs `--features desktop`)
- Locales/strings touched -> `npm run check:i18n:strict`
- Before a multi-item sweep's last commit -> `npm run check` (ten gates in an `&&` chain incl.
  `census:check`; the chain stops at the first failure, and `census:check` is the one most likely to
  fail a diff that compiles)

## Repo law
Authority: `.claude/CLAUDE.md`.
- Every user-facing string: key into `src/i18n/locales/en.json` via `useTranslation()`, then
  translated into **all 13 other locales in the same commit** - `translate-extract.mjs` -> fill
  `.i18n-work/missing-<code>.json` -> `translate-merge.mjs`. The `i18n-no-gaps` pre-commit hook
  blocks gaps. No hardcoded English in JSX, placeholder, title or aria-label.
  **14 locales makes a string-adding item NOT a paper cut** - for 1-3 keys use the pipeline; more
  than that, defer the item.
- Status tokens via `tokenLabel()` (`src/i18n/tokenMaps.ts`); errors via `resolveErrorTranslated()`.
- Semantic design tokens (`.claude/Design.md` section 8) and shared components from
  `shared/components` CATALOG.md - no raw white/black/shadow utilities, no hand-rolled primitives.
- IPC via `invokeWithTimeout`; error handling via `toastCatch` / `silentCatch` / the error registry.

## Baseline exclusions
Never surface as items - fix-as-you-touch per CLAUDE.md, ~10k warnings deep:
- `custom/no-raw-*-classes` (the design-token migration)
- `custom/no-hardcoded-jsx-text` (the i18n extraction backlog)
i18n and ui items must be *structural* defects (wrong mechanism, broken behavior), never this backlog.

## Smoke
- `npm run tauri dev`, or drive the USER'S running instance via the **:17320 test-automation
  bridge** (verify a new-code marker first - never trust a stale port).
- Read-only sqlite3 against the live DB (`sqlite3 "file:<path>?mode=ro"`) for state questions.

## Coverage names
For `.personas/memory-outbox.jsonl`, anchor `context` to the **product-level names in
`.claude/codebase-context.md`** (49 names, 8 groups - what the app's DB knows). Do NOT use repo-root
`context-map.json`: it is a peer device's mechanical auto-map whose names the app does not recognize,
and an unrecognized name is stored with a null context and never counts toward coverage.
