# CLAUDE.md — Personas Desktop

## Project Overview

Cross-platform desktop app for building, orchestrating, and monitoring AI agent personas. **Tauri 2** (Rust backend) + **React 19** + **TypeScript 6** + **Vite 8** + **Tailwind 4** + **Zustand 5**. Local-first SQLite database with AES-256-GCM encrypted credentials.

## Common Commands

```bash
npm run dev              # Vite dev server (port 1420)
npm run tauri dev        # Full Tauri desktop dev mode
npx tsc --noEmit         # TypeScript check (tsc not on PATH on Windows)
npm run lint             # ESLint
npm run test             # Vitest (675+ tests)
npx vite build           # Production frontend build
node scripts/i18n/check-coverage.mjs   # i18n coverage report (CI gate)
```

### Build & packaging

End-to-end build documentation lives in **[`docs/BUILD.md`](../docs/BUILD.md)**
(architecture differences, ARM64 vs x64 on Windows, codegen pipeline,
profiles, ONNX bundling). For Android setup, see [`docs/ANDROID-BUILD.md`](../docs/ANDROID-BUILD.md).

Quick reference of the most common scripts:
- Tier-specific frontend bundles: `npm run build:starter` / `build:team` / `build:builder`. Locally validate all three with `npm run check:tiers` (CI also runs this).
- Tauri installers: `npm run tauri:build` (canonical) / `tauri:build:lite` (fast nsis-only with `desktop` features) / `tauri:build:stable` (nsis + msi, `desktop-full`).
- Tauri dev: `npm run tauri:dev` / `tauri:dev:lite` / `tauri:dev:stable` / `tauri:dev:test` (the last enables `--features test-automation`, HTTP server on :17320).
- Cache recovery (use after switching Rust hosts or seeing `lld-link: machine type x64 conflicts with arm64`): `npm run clean:ort` (surgical, ~5 min recompile) or `npm run clean:rust` (nuclear, ~10+ min). `predev` auto-detects host-triple drift via `scripts/check-build-cache.mjs`.

Codegen now runs in parallel via `scripts/run-codegen.mjs` (per-task 60s timeout, override with `CODEGEN_TIMEOUT_MS`). `predev` and `prebuild` both go through it.

Advisory pre-release scripts (manual, not CI-gated):
- `npm run check:assets` — reports PNG → WebP compression savings via `scripts/optimize-assets.mjs --dry-run`. Run before bumping a release if asset weight matters.

## Architecture

```
src/
├── api/              # Tauri IPC bridge (invokeWithTimeout wrappers)
├── features/         # Feature modules (~20 domains, ~1200 components)
│   ├── agents/       # Agent CRUD, editor, chat, lab, connectors (303 files)
│   ├── vault/        # Credential management, catalog, connectors (218 files)
│   ├── overview/     # Dashboard, metrics, observability (152 files)
│   ├── shared/       # Shared UI components, layout, feedback (122 files)
│   └── ...           # triggers, recipes, schedules, deployment, etc.
├── hooks/            # Custom React hooks
├── i18n/             # Internationalization system (14 languages)
├── lib/              # Business logic, types, utilities
├── stores/           # Zustand with slice pattern (src/stores/slices/)
└── styles/           # Global CSS, typography, themes

src-tauri/
├── src/commands/     # Tauri command handlers (IPC surface)
├── src/db/           # SQLite schema, migrations, repository pattern
└── src/engine/       # Execution engine, scheduler, healing, crypto
```

## Important Conventions

### State Management
- Zustand with slice pattern in `src/stores/slices/`
- Use `useShallow` from zustand for selective subscriptions
- `globalThis` for singletons surviving HMR (executionBuffers, eventBus)

### Tauri IPC
- Always use `invokeWithTimeout` from `@/lib/tauriInvoke` — never raw `invoke`
- ESLint `no-restricted-imports` enforces this

### ts-rs bindings (Rust → TypeScript types)
- **Single source of truth: `src/lib/bindings/`.** ts-rs writes here directly via `TS_RS_EXPORT_DIR` set in `src-tauri/.cargo/config.toml`. There is no longer a parallel `src-tauri/bindings/` directory — that dual-copy + manual-sync trap was retired in the build-tooling architect run (2026-05-01).
- **After adding `#[derive(TS)] #[ts(export)]` to a Rust struct**, run `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` from the repo root. Commit the resulting new/changed files in `src/lib/bindings/`.
- CI verifies via `git diff --quiet src/lib/bindings/` — a missing regen fails the build at `.github/workflows/ci.yml`'s binding-drift job.
- New Tauri commands additionally need `node scripts/generate-command-names.mjs` (or just `npm run dev`/`npm run build` which trigger `predev`/`prebuild`).

### Styling
- **Canonical reference: [`.claude/Design.md`](./Design.md)** — single source of truth for tokens, typography, color, spacing, radius, elevation, motion, and component primitives. Read it before adding any new UI surface or extending an existing one.
- Semantic design tokens: `typo-*` for text sizes, `rounded-{interactive,input,card,modal}` for radii, `shadow-elevation-1..4` for depth, JS spacing tokens (`CARD_PADDING`, `SECTION_GAP`, ...) for layout
- `[data-theme^="light"]` CSS selectors for light theme overrides
- Never use `text-white/*` or `bg-white/*` directly — use `text-foreground/*` or `bg-secondary/*`
- ESLint warns on raw Tailwind classes that have semantic equivalents (see Design.md §8 Do's and Don'ts)

### Error Handling
- `toastCatch()` from `src/lib/silentCatch.ts` for user-facing errors (Sentry + toast)
- `silentCatch()` for background errors (Sentry + console only)
- `resolveError()` from `src/lib/errors/errorRegistry.ts` maps raw errors to friendly messages
- ESLint rule `custom/no-silent-catch` warns on empty `catch {}` blocks — the next person debugging in production needs a Sentry breadcrumb, not a comment.

### Concurrent CLI sessions (active-runs ledger)

Multiple CLI sessions (Claude Code agents, manual sessions, skill invocations) often work in parallel on this checkout, on the same branch, without branching for isolation. The coordination surface is **[`.claude/active-runs.md`](./active-runs.md)** — a single git-tracked ledger that any session materially editing the working tree should touch twice:

1. **At session start (Phase 0):** read the ledger; if any `## Active` entry's declared paths overlap your planned scope and the entry is `started`-status and less than 2 hours old, surface the conflict to the user before proceeding. Append your own entry to `## Active`.
2. **At session end (Phase 11/13):** move your entry to the top of `## Recently completed` with the resulting commit SHA (or `aborted (<reason>)` / `handoff: <path>`).

Rationale and full design space in **[`docs/concepts/cli-coordination-active-runs.md`](../docs/concepts/cli-coordination-active-runs.md)**. Ledger format conventions (timestamps, path declaration granularity, edit-conflict retries) live at the top of `active-runs.md` itself.

First adopter is `/research`; cross-skill adoption is the next step. If you're authoring a new skill that materially edits files, add the Phase 0 register + Phase 11 deregister rituals to its spec.

#### Parallel-safety primitives (MANDATORY for every CLI session)

The active-runs ledger is intent coordination; these are the **never-lose-work** guarantees that protect the working tree even when intent coordination fails. On 2026-05-09 a parallel session ran `git stash` to clean its tree before commit and silently swept five files (one untracked) of an in-flight `/research` run; recovery worked but only because the tracked files were in the stash and the untracked file was reproducible from conversation context. Don't assume the next stash victim will be that lucky.

1. **Never `git stash` work that isn't yours.** Not even with `--keep-index`. Stash sweeps the entire working tree — including untracked files (with `-u`) and other sessions' in-flight edits — into a hidden state most agents won't think to look for. If your commit step needs a clean stage, use `git add <path>` per file (NOT `git add -A`/`git add .`/`git add -u`); leave everything else alone. The architect skill's "[Coexist with uncommitted work](./skills/architect/skill.md)" pattern is the canonical reference; mirror its discipline in any new skill.

2. **Use `git worktree` for ALL multi-file work.** When your planned scope is more than a single file, do not work on `master` next to other sessions — create a worktree:
   ```bash
   git worktree add .claude/worktrees/<short-slug> -b worktree-<short-slug>
   cd .claude/worktrees/<short-slug>
   # work, commit atomically per task
   ```
   Single-line/single-file fixes can stay on the main checkout. Anything bigger — a research run that touches a connector + Rust seed + engine module, an architect ADR with multi-file rollout, an `/add-template` that writes JSON + regenerates two checksum manifests — gets its own worktree. Worktrees give physical isolation; the ledger gives logical coordination; together they make the never-lose-work guarantee real.

3. **Atomic commits per task.** Never accumulate more than ~30 minutes of uncommitted work. Each finding, each refactor step, each PR-step in a rollout plan = one commit. If validation fails, fix inline and commit; never stack failing work. The 2026-04-11 merge-loss incident and the 2026-05-09 stash incident both reduce to "too much uncommitted work in flight at once" — atomic commits are the structural fix.

4. **Clean up worktrees after merge.** Once the worktree's branch has been merged (or squashed-merged) into `master` and you've confirmed the work is in `git log master`, remove the worktree:
   ```bash
   cd /c/Users/mkdol/dolla/personas       # back to main checkout
   git worktree remove .claude/worktrees/<short-slug>
   git branch -D worktree-<short-slug>    # only if branch is merged
   ```
   Stale worktrees are not free — they hold a working copy of the repo (gigabytes), confuse `git worktree list`, and a future session may accidentally `cd` into one. Treat worktree cleanup as part of the same Phase 13 ritual that records the commit SHA in the ledger.

5. **`git status` shows everyone's work — and so does the staged index.** Before any commit, scan `git status --porcelain` and classify each entry: yours / pre-existing drift / another session's in-flight work. Stage only yours. The 2026-05-09 stash victim was visible in `git status` to the stashing session — the missing discipline was "what's there that isn't mine?", not "what should I commit?"

   **AND THEN** — after `git add` but BEFORE `git commit` — run `git diff --cached --stat` and check the staged file count. If it is greater than the number of files you explicitly `git add`-ed, the index already had pre-staged files from another session sitting in it; your `git add` simply layered on top. Run `git restore --staged <path>` per unrelated file before committing. The recovery commit for the 2026-05-09 stash incident itself fell into this trap: the parallel-safety codification was supposed to be 6 files; the index already held 18 pre-staged files from a concurrent clear-wins/creative session and the commit swept everything up under a misleading message. Never trust the index; always verify it matches your intent.

---

## Internationalization (i18n) — MANDATORY FOR ALL UI CHANGES

**CRITICAL**: This project supports 14 languages. Every user-facing string MUST go through the i18n system. Hardcoded English strings in JSX are a bug, not a shortcut.

### The Rule

> **Never write hardcoded English text in JSX, placeholder, title, or aria-label attributes.**
> Always use `const { t, tx } = useTranslation()` and reference `t.section.key`.

The ESLint rule `custom/no-hardcoded-jsx-text` enforces this as a warning. Treat warnings as errors for new code.

### How the i18n System Works

```typescript
// In any component:
import { useTranslation } from '@/i18n/useTranslation';

function MyComponent() {
  const { t, tx } = useTranslation();
  
  return (
    <div>
      <h1>{t.common.save}</h1>                           {/* Simple key */}
      <p>{tx(t.common.agent_count_other, { count: 5 })}</p> {/* Interpolation */}
    </div>
  );
}
```

**Source of truth**: `src/i18n/locales/en.json` (~11,500 leaf keys across 60 top-level sections — `common`, `agents`, `vault`, `overview`, `triggers`, …)
**14 languages**: en, zh, ar, hi, ru, id, es, fr, bn, ja, vi, de, ko, cs
**Fallback**: Non-English bundles are split per top-level section and lazy-loaded as separate JS chunks. The `t` proxy deep-merges each section over its English counterpart so missing sub-keys resolve to English automatically (translation lag never renders `undefined`); a section that hasn't loaded yet shows English while the chunk is in flight.

### Architecture (section-locales pipeline)

The 500KB+ monolithic locale bundles were retired in May 2026. Today:

1. `src/i18n/locales/<lang>.json` — authoritative human-edited locale files (English is the source; non-English files are partial, with translation teams catching up asynchronously).
2. `scripts/i18n/split-locales.mjs` — runs in `vite buildStart` (and is also wired into `predev`/`prebuild` via `scripts/run-codegen.mjs`). Splits each non-English locale into `src/i18n/section-locales/<lang>/<section>.json` and emits `src/i18n/generated/enSectionStrings.ts` (English sections stored as parse-on-demand JSON strings).
3. `src/i18n/useTranslation.ts` discovers section JSON via `import.meta.glob('./section-locales/*/*.json', { eager: false })`, so each section becomes its own async chunk. The `t` value is a `Proxy` that triggers section loading on first property access.
4. `src/i18n/routeSections.ts` — declares which sections each `SidebarSection` (home/overview/personas/…) needs. The active route's sections preload eagerly; everything else loads on demand. `BASE_SECTIONS` (common, chrome, sidebar, toasts, errors, error_registry, empty_states, status_tokens, process_labels) always preload.
5. `src/main.tsx` `preloadPersistedLocaleBeforeMount()` — kicks off section loads for the persisted locale + persisted sidebar route before React mounts, so non-English users avoid an English-first-paint flash. Bounded by a 1.2s timeout.
6. `useLanguagePrefetch()` — hover/intent prefetch used by `LanguageSwitcher` / `AppearanceStep` to warm chunks before a language switch commits.

The English type tree (`src/i18n/generated/types.ts`) is codegen'd from `locales/en.json` by `scripts/i18n/gen-types.mjs` on `predev`/`prebuild`. It gives `t.section.key` autocomplete and catches drift at compile time.

### When Adding New UI Strings

1. **Add the key to `src/i18n/locales/en.json`** in the appropriate top-level section (`common`, `agents`, `vault`, …). The file is plain JSON.
2. **Include a translator comment in the PR description or commit message** explaining context for short labels (e.g. "duplicate_agent: button in agent editor toolbar — keep 1-2 words"). JSON does not support inline comments; treat the PR/commit as the translator-facing context.
3. **Use the key in your component** via `t.section.key` (autocompleted by the generated `Translations` type).
4. **Do NOT add to non-English locale files** — they fall back to English automatically. Translation teams catch up asynchronously.
5. After editing `en.json`, the next `npm run dev` / `npm run build` regenerates `generated/types.ts`, `generated/enSectionStrings.ts`, and `section-locales/*/<section>.json`.

### When Adding New Backend Status Tokens

The Rust backend sends machine tokens (e.g. `"queued"`, `"failed"`, `"critical"`) over IPC. These are **language-agnostic identifiers** — never display them directly to users.

**Pattern (token-based):**
1. Add the token label to `src/i18n/locales/en.json` under `status_tokens.<category>`.
2. Use `tokenLabel()` from `src/i18n/tokenMaps.ts` to resolve:
   ```typescript
   import { tokenLabel } from '@/i18n/tokenMaps';
   const { t } = useTranslation();
   <Badge>{tokenLabel(t, 'execution', row.status)}</Badge>
   ```

**Available token categories**: execution, event, automation, severity, priority, healing_status, healing_category, connector_status, test, dev

### When Adding Error Messages

Use the error registry bridge for user-facing errors:

```typescript
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
const { t } = useTranslation();
const { message, suggestion } = resolveErrorTranslated(t, rawError);
```

To add a new error pattern:
1. Add `<key>_message` and `<key>_suggestion` to `locales/en.json` → `error_registry` section.
2. Add a match rule in `src/i18n/useTranslatedError.ts` → `ERROR_KEY_MAP`.

### Constants with Labels

For static data objects with display labels (category names, status configs, filter labels):

**DO NOT** use inline English strings:
```typescript
// BAD
const FILTERS = [{ id: 'active', label: 'Active' }];
```

**DO** use i18n keys:
```typescript
// GOOD
const FILTERS = [{ id: 'active', labelKey: 'common.active' as const }];
// Then in the component:
<span>{t.common.active}</span>
```

### What NOT to Translate

- Brand names: Claude, Personas, GitHub, Slack, Sentry, etc.
- Technical identifiers: API, CLI, JSON, HTTPS, cron, webhook, SQLite
- User-generated content: persona names, descriptions, system prompts
- CSS class names, data attributes, code identifiers
- Log messages (console.log, Sentry breadcrumbs)

### Checking Coverage

```bash
node scripts/i18n/check-coverage.mjs           # CI gate — fails if any locale's keyset has EXTRAS (stale keys)
node scripts/i18n/check-coverage.mjs --json    # Machine-readable
node scripts/i18n/check-coverage.mjs --strict  # Also fail on missing keys (use before a release)
npm run check:i18n                             # Same as check-coverage above (wired into CI)
```

`check-coverage.mjs` reads `src/i18n/locales/*.json`. Extras always fail (stale keys after a rename). Missing keys warn by default — translation lag is expected and the runtime fall-back to English keeps the app functional.

### Back-compat shim `src/i18n/en.ts`

Provides `import { en, type Translations } from '@/i18n/en'` for the ~48 modules that bind English values at module scope (Zustand slices like `tourSlice`/`deployTarget`/`alertSlice`/`executionSlice`, helpers in `modelCatalog`/`connectorRoles`/`triggerConstants`, etc.). The `en` export is a `Proxy` that lazy-parses each section on first property access — so `import { en }` is nearly free and `en.alerts.x` only parses the `alerts` section. New code should prefer `useTranslation()` for components and `getActiveTranslations()` (from `@/i18n/useTranslation`) for non-React modules; keep the `en` shim only when you need a stable English snapshot at module-init time.

### Feature-scoped `i18n/` directories

The 2026-04-19 retire pass folded `overview`, `settings`, `templates`, `onboarding`, and `home` into the main bundle, and a 2026-05-08 follow-up resolved `agents/sub_lab/`, `plugins/twin/`, and `recipes/shared/`. The only surviving `i18n/` folder under `src/features/` is `home/components/releases/i18n/useReleasesTranslation.ts`, which is a *display-shape adapter* — it just reshapes flat `t.releases.whats_new.release_X_Y_Z_item_N_title` keys into the nested object that `HomeRoadmapView` and `ReleaseDetailView` consume. It uses the main `useTranslation()` underneath, owns no parallel locale data, and is allowed to stay. **Do NOT create new feature-scoped i18n dirs.** Add strings to `src/i18n/locales/en.json`.

### i18n Migration Status

Hardcoded English in JSX is still being extracted incrementally. When you encounter hardcoded strings while editing a file for other reasons, extract them to `locales/en.json` if the fix is small (< 5 strings). Do NOT bulk-migrate files that aren't part of your current task.

---

## Guide Sync (Marketing Site)

After significant feature work, run `/guide-sync` to keep the marketing site guides (`personas-web`) in sync with desktop app changes. The skill:

1. Detects changed files since last sync (marker at `.claude/guide-sync-marker.json`)
2. Maps changes to guide topics via `personas-web/src/data/guide/desktop-modules.ts`
3. Flags stale topics and suggests content updates
4. Optionally updates guide content in `personas-web/src/data/guide/content/*.ts`

**Mode tags**: Guide categories and topics have a `mode` field (`"simple"`, `"power"`, or `"both"`) that controls visibility in the guide filter UI. When moving features between Simple/Power modes in the desktop app, update the corresponding category or topic mode in `personas-web`.

---

## Documentation Sync (`docs/features/`)

`docs/features/` is the implemented-product reference for users, developers, and CLI agents. It must track the codebase. This project's development happens through Claude — there is no other reviewer who will catch doc drift, so the responsibility lives in this section and in a Stop hook.

### The rule

When a turn edits **feature/command source** with **user-visible** effect (new tab/page/command, changed flow, removed feature, new event, schema migration that surfaces in UI, renamed table, new tier gate), update the matching feature doc in the **same turn**. If the change is internal-only (refactor, bugfix without behavior shift, generated code, test-only) no doc update is needed.

### Source → doc map

The authoritative source→doc mapping is in [`scripts/docs/feature-doc-map.json`](../scripts/docs/feature-doc-map.json). Quick reference:

| Source area | Feature doc |
| --- | --- |
| `src/features/personas/**`, `src/features/agents/**`, `src-tauri/src/commands/core/personas.rs` | [`docs/features/personas/README.md`](../docs/features/README.md) |
| `src/features/templates/**`, `src-tauri/src/commands/design/**`, `src-tauri/src/engine/build_session/**` | `docs/features/templates/README.md` |
| `src-tauri/src/commands/execution/**`, `src-tauri/src/engine/{runner,scheduler,bus,chain,...}.rs` | `docs/features/execution/README.md` |
| `src/features/vault/**`, `src-tauri/src/commands/credentials/**` | `docs/features/connections/README.md` |
| `src/features/triggers/**`, `src-tauri/src/commands/communication/**`, `engine/event_registry.rs` | `docs/features/events/README.md` |
| `src/features/recipes/**`, `src-tauri/src/commands/recipes/**` | `docs/features/recipes/README.md` |
| `src/features/settings/**`, `commands/credentials/external_api_keys.rs`, `engine/management_api.rs` | `docs/features/settings/README.md` |
| `src/features/home/**`, `src/features/simple-mode/**` | `docs/features/home.md` |
| `src/features/onboarding/**` | `docs/features/onboarding.md` |
| `src/features/overview/**` | `docs/features/overview/README.md` |
| `src/features/plugins/<plugin>/**`, `src-tauri/src/commands/<plugin>/**` (or `infrastructure/<plugin>.rs`) | `docs/features/<plugin>.md` (artist, companion, dev-tools, drive, obsidian-brain, research-lab, twin) |

When you add a new feature area, add an entry to `feature-doc-map.json` in the same change.

### The Stop hook

`.claude/settings.json` registers a Stop hook that runs `node scripts/docs/check-doc-sync.mjs` before every turn ends. The script:

1. Walks the current turn's transcript for `Edit` / `Write` / `MultiEdit` calls.
2. Filters out skip patterns (tests, generated bindings, i18n, docs themselves, migrations, template/connector seeds).
3. Matches the remaining edits against the feature-doc map.
4. If feature source was edited but no `docs/features/*` was touched in the same turn, exits 2 with a structured reminder naming the affected docs.

When you see that reminder, **either** update the named doc(s) in this turn, **or** reply with one short sentence — `"internal-only, no doc update needed"` (or similar) — explaining why no doc work is required (refactor, bugfix without behavior shift, etc.). Do not ignore the reminder silently.

The hook honors `stop_hook_active`, so it can't infinite-loop. Bypass for an entire turn by either dismissing as above, or by including a doc edit alongside the source change.

---

## Pre-existing Issues (Do Not Fix Unless Asked)

- Git post-commit hook warning about `git_hook.py` is harmless.
- Lint baseline (as of 2026-04-17 ship-ready pass): **0 errors, ~10,086 warnings**. The warnings are almost entirely `custom/no-raw-*-classes` (design-token migration) and `custom/no-hardcoded-jsx-text` (i18n extraction) — both are known incremental migrations. Follow CLAUDE.md's fix-as-you-touch policy; do not bulk-migrate.
- `react-hooks/rules-of-hooks` violations (conditional hooks, hooks called outside components): ~21 remain across ~7 files, at warn-level pending triage. Not a ship-blocker; fix opportunistically when touching those files.

### Historical (for context; no longer active on `master`)

- The "~159 pre-existing TS errors" and the `AccountSettings.tsx` missing-import list from earlier versions of this document **no longer apply**. The 2026-04-17 ship-ready pass resolved all TS errors; `npx tsc --noEmit` now exits clean on `master`. If you see TS errors on a branch, treat them as regressions introduced on that branch.

---

## Feature Log Sync (codex-gf companion)

A separate local project at `C:\Users\kazda\kiro\gf\codex-gf` runs a personal companion ("codex-gf") that maintains a cross-project **feature log**. The log gives the companion a brief, durable record of what the user achieved across all their Claude CLI projects so it can reason about momentum, causality, and continuity.

**When to log**

After completing one of the following — log a single entry:

- A discrete feature phase landed (e.g. "Phase 3: conflict simulator removed", "session storage migration shipped").
- A substantial session that touched user-visible behavior, schema, or workflow.
- A meaningful refactor, bug fix, or architecture decision the user would care to remember 3 months from now.

Skip routine work: typo fixes, single-line tweaks, dependency bumps, formatting-only commits.

**How to log**

1. Check whether the codex-gf dev server is reachable. It usually runs at `http://localhost:3001`. Probe it with:
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/api/feature-log
   ```
   If the response is not `200`, skip the log silently — never block your task on this. Don't try to start the server.

2. POST a single JSON object to `/api/feature-log`. Required fields: `project`, `motivation`, `action`, `result`. Optional: `phase`, `skill`, `prompt`, `proposal`, `tags`, `metrics`.

   ```bash
   curl -s -X POST http://localhost:3001/api/feature-log \
     -H "Content-Type: application/json" \
     -d '{
       "project": "personas",
       "phase": "Phase X — short label",
       "motivation": "Why this was worth doing — short.",
       "action": "What you actually did, ≤240 chars.",
       "result": "What landed and why it matters, ≤240 chars.",
       "skill": "general | review | ultrareview | init | manual",
       "prompt": "(optional) the user prompt that triggered this work, truncated",
       "proposal": "(optional) your one-line plan or proposal that led to this",
       "tags": ["refactor","ui"],
       "metrics": { "filesChanged": 3, "linesAdded": 120, "linesRemoved": 40, "durationMin": 25 }
     }'
   ```

3. The endpoint dedupes on `(project, action[:40])` within the last 5 entries — if your work is a continuation, send a new entry anyway with a slightly different action phrasing.

**Field guidance**

- `project`: a stable short slug, not a path. For this repo always use `"personas"`.
- `phase`: optional but useful — match the phase/issue label you've been using in conversation, or invent a short one (`"Phase 3 — conflict simulator"`, `"Auth migration"`).
- `motivation` / `action` / `result`: each ≤240 characters. Server caps and truncates with an ellipsis if longer. Aim for one sentence each.
- `skill`: which Claude Code surface this came from. Examples: `"general"` (default), `"review"`, `"ultrareview"`, `"init"`, `"security-review"`, `"manual"` if user drove it without a slash command.
- `prompt`: the original user prompt, truncated to a single sentence/line.
- `proposal`: the one-line summary of your plan you presented before doing the work.
- `tags`: 1–4 short lowercase tags (`["refactor","ui","bugfix","schema","perf","docs","tooling"]`).
- `metrics`: optional — pull `filesChanged` and `linesAdded`/`linesRemoved` from `git diff --shortstat HEAD~1..HEAD` or similar; estimate `durationMin` if you can.

**Failure mode**

If the POST fails (server down, validation error, network error) — silently continue. The log is best-effort observability for the user's companion, never a gate on your real work. Do not retry, do not surface the failure unless asked.

**Privacy**

The codex-gf project is local-only and stored in `data/memory.json`. Treat the log like a personal journal — keep entries factual and brief; avoid quoting private third-party content beyond what's necessary to make the entry meaningful.
