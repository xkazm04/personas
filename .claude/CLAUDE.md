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
node scripts/check-locale-parity.mjs   # i18n coverage report
```

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

### Styling
- Semantic design tokens: `typo-*` for text sizes, `rounded-*` for radii, spacing tokens
- `[data-theme^="light"]` CSS selectors for light theme overrides
- Never use `text-white/*` or `bg-white/*` directly — use `text-foreground/*` or `bg-secondary/*`
- ESLint warns on raw Tailwind classes that have semantic equivalents

### Error Handling
- `toastCatch()` from `src/lib/silentCatch.ts` for user-facing errors (Sentry + toast)
- `silentCatch()` for background errors (Sentry + console only)
- `resolveError()` from `src/lib/errors/errorRegistry.ts` maps raw errors to friendly messages

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
node scripts/check-locale-parity.mjs          # All locales
node scripts/check-locale-parity.mjs cs de     # Specific locales
node scripts/check-locale-parity.mjs --json    # Machine-readable
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
