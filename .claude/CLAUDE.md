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

**Source of truth**: `src/i18n/en.ts` (~1,622 keys across 29 sections)
**14 languages**: en, zh, ar, hi, ru, id, es, fr, bn, ja, vi, de, ko, cs
**Fallback**: Non-English bundles are lazy-loaded; English is always synchronous. Missing keys fall back to English via deep merge.

### When Adding New UI Strings

1. **Add the key to `src/i18n/en.ts`** in the appropriate section (common, agents, vault, etc.)
2. **Include a translator comment** above the key explaining context:
   ```typescript
   // Button label in the agent editor toolbar — keep short (1-2 words)
   duplicate_agent: "Duplicate",
   ```
3. **Use the key in your component** via `t.section.key`
4. **Do NOT add to non-English locale files** — they fall back to English automatically. Translation teams handle localization separately.

### When Adding New Backend Status Tokens

The Rust backend sends machine tokens (e.g. `"queued"`, `"failed"`, `"critical"`) over IPC. These are **language-agnostic identifiers** — never display them directly to users.

**Pattern (Option A — token-based):**
1. Add the token label to `src/i18n/en.ts` under `status_tokens.<category>`
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
1. Add `<key>_message` and `<key>_suggestion` to `en.ts` → `error_registry` section
2. Add a match rule in `src/i18n/useTranslatedError.ts` → `ERROR_KEY_MAP`

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
node scripts/i18n/check-coverage.mjs           # CI gate — fails if any locale's keyset diverges from en.json
node scripts/i18n/check-coverage.mjs --json    # Machine-readable
node scripts/i18n-real-coverage.mjs            # Real coverage report across all 13 locales (handles inline-object keys)
npm run check:i18n                             # Same as check-coverage above (wired into CI)
```

### Feature-Scoped i18n Hooks (Deprecated)

`src/features/home/i18n/` and `src/features/home/components/releases/i18n/` have their own locale files and hooks. These are **deprecated** — do NOT create new feature-scoped i18n directories. All new translations go into the main `src/i18n/en.ts`.

### i18n Migration Status

~3,800 hardcoded strings remain across ~1,200 files. Migration is in progress. When you encounter hardcoded English while editing a file for other reasons, extract it to en.ts if the fix is small (< 5 strings). Do NOT bulk-migrate files that aren't part of your current task.

---

## Guide Sync (Marketing Site)

After significant feature work, run `/guide-sync` to keep the marketing site guides (`personas-web`) in sync with desktop app changes. The skill:

1. Detects changed files since last sync (marker at `.claude/guide-sync-marker.json`)
2. Maps changes to guide topics via `personas-web/src/data/guide/desktop-modules.ts`
3. Flags stale topics and suggests content updates
4. Optionally updates guide content in `personas-web/src/data/guide/content/*.ts`

**Mode tags**: Guide categories and topics have a `mode` field (`"simple"`, `"power"`, or `"both"`) that controls visibility in the guide filter UI. When moving features between Simple/Power modes in the desktop app, update the corresponding category or topic mode in `personas-web`.

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
