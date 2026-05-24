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

End-to-end build documentation lives in **[`docs/development/build.md`](../docs/development/build.md)**
(architecture differences, ARM64 vs x64 on Windows, codegen pipeline,
profiles, ONNX bundling). For Android setup, see [`docs/development/android-build.md`](../docs/development/android-build.md).

Quick reference of the most common scripts:
- Tier-specific frontend bundles: `npm run build:starter` / `build:team` / `build:builder`. Locally validate all three with `npm run check:tiers` (CI also runs this).
- Tauri installers: `npm run tauri:build` (canonical) / `tauri:build:lite` (fast nsis-only with `desktop` features) / `tauri:build:stable` (nsis + msi, `desktop-full`).
- Tauri dev: `npm run tauri:dev` / `tauri:dev:lite` / `tauri:dev:stable` / `tauri:dev:test` (the last enables `--features test-automation`, HTTP server on :17320).

#### Picking dev variants — when to use lite vs full

| You're working on… | Use | Why |
|--|--|--|
| UI/UX, frontend logic, Tauri command wiring, schema, triggers, recipes, observability — the **other 95% of the app** | `npm run tauri:dev:lite` | Skips `ml` + `p2p` → no ORT/fastembed compile (~3-5 min faster cold compile; smaller link surface; smaller incremental rebuilds) |
| Vector knowledge base, embeddings, fastembed, ONNX inference, semantic search | `npm run tauri:dev` (full) | These code paths are gated behind `ml` and only compile in `desktop-full` |
| P2P / mDNS / QUIC transport | `npm run tauri:dev` (full) | Gated behind `p2p` |
| MCP-driven UI test automation (test-automation HTTP server on :17320) | `npm run tauri:dev:test` (lite + test-automation) or `tauri:dev:test:full` (full + test-automation) | Pick by what the test needs |
| Verifying a release-shaped build locally (LTO, optimized) | `npm run tauri:build:stable` | Slow (~20 min) but matches what ships |

**Default to `tauri:dev:lite` for daily work.** The cost of switching to full when you actually need ML/P2P is one cargo-recompile of those crates — much cheaper than paying the full compile on every iteration.

#### When builds get slow or break

- **`lld-link: machine type x64 conflicts with arm64`** — host-triple drift. Most common cause is also the well-known one: **pyke's `ort-sys 2.0.0-rc.9` ships a mislabeled aarch64 tarball that's actually x64 inside**. `pretauri:dev`/`pretauri:build` run `scripts/ensure-ort-cache.mjs` automatically before the cargo build, which sniffs the cached `onnxruntime.lib`'s real machine type and swaps it with Microsoft's official ORT release if it doesn't match the host. Idempotent and self-healing — if `clean:ort` ever wipes the cache, the next dev/build re-applies the fix. If you still hit this error: run `npm run ensure:ort-cache` manually and check its output.
- **`Port 1420 is already in use`** — a previous `tauri dev` failed mid-startup and orphaned Vite. Find it with `netstat -ano | findstr :1420` (or `Get-NetTCPConnection -LocalPort 1420` in PowerShell), then `Stop-Process -Id <PID> -Force`. This recurs often enough that automating the kill in `pretauri:dev` is a tracked follow-up.
- **`npm run clean:ort` (surgical, ~5 min recompile)** — wipes ort/ort-sys build artifacts + pyke's download cache. Use after switching Rust hosts. The next `npm run tauri:dev` will re-run `ensure-ort-cache.mjs` and repopulate.
- **`npm run clean:rust` (nuclear, ~10+ min)** — full `cargo clean`. Last resort.
- `predev` auto-detects rustc host-triple drift via `scripts/check-build-cache.mjs`.

Codegen runs in parallel via `scripts/run-codegen.mjs` (per-task 60s timeout, override with `CODEGEN_TIMEOUT_MS`). `predev` and `prebuild` both go through it.

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
- **Single source of truth: `src/lib/bindings/`.** ts-rs writes here directly via `TS_RS_EXPORT_DIR`, which is forwarded to rustc by `src-tauri/build.rs` (`cargo:rustc-env=TS_RS_EXPORT_DIR=../src/lib/bindings`). The earlier `[env]` table in `src-tauri/.cargo/config.toml` did NOT reliably reach the proc-macro expansion path — the dual-tree drift (`src-tauri/bindings/` AND `src/lib/bindings/` both committed and drifting) traced to that. The build.rs route closes the gap; `src-tauri/bindings/` was retired and now appears in `src-tauri/.gitignore` to prevent any future leak. The `.cargo/config.toml` entry stays as a belt-and-suspenders backstop for tooling that calls cargo without going through the build.rs.
- **After adding `#[derive(TS)] #[ts(export)]` to a Rust struct**, run `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` from the repo root. Commit the resulting new/changed files in `src/lib/bindings/`.
- CI verifies via `git diff --quiet src/lib/bindings/` — a missing regen fails the build at `.github/workflows/ci.yml`'s binding-drift job.
- New Tauri commands additionally need `node scripts/generate-command-names.mjs` (or just `npm run dev`/`npm run build` which trigger `predev`/`prebuild`).

### Styling
- **Canonical reference: [`.claude/Design.md`](./Design.md)** — single source of truth for tokens, typography, color, spacing, radius, elevation, motion, and component primitives. Read it before adding any new UI surface or extending an existing one.
- Semantic design tokens: `typo-*` for text sizes, `rounded-{interactive,input,card,modal}` for radii, `shadow-elevation-1..4` for depth, JS spacing tokens (`CARD_PADDING`, `SECTION_GAP`, ...) for layout
- `[data-theme^="light"]` CSS selectors for light theme overrides
- Never use `text-white/*` or `bg-white/*` directly — use `text-foreground/*` or `bg-secondary/*`
- ESLint warns on raw Tailwind classes that have semantic equivalents (see Design.md §8 Do's and Don'ts)

### Reusing shared components — MANDATORY before building UI

> **Before you write any UI, check whether a shared component already exists.**
> The project has **173 reusable components** under `src/features/shared/components/`,
> catalogued in **[`src/features/shared/components/CATALOG.md`](../src/features/shared/components/CATALOG.md)**
> (auto-generated, always fresh). The #1 source of UI drift is new code re-implementing
> a spinner / empty state / button / modal / tooltip / badge / copy-button / relative-time
> / number-format that already exists.

**Do NOT hand-roll these — import the shared one** (full table + import paths in
[`docs/refactor/shared-component-reuse.md`](../docs/refactor/shared-component-reuse.md)):

| Don't hand-roll | Use |
|---|---|
| `animate-spin` / local spinner | `feedback/LoadingSpinner` |
| "no data" block | `feedback/EmptyState` |
| styled `<button>` | `buttons/Button` / `buttons/AsyncButton` |
| `navigator.clipboard.writeText` | `buttons/CopyButton` / `useCopyToClipboard` |
| `fixed inset-0` modal backdrop | `modals/BaseModal` / `feedback/ConfirmDialog` (enforced by `custom/enforce-base-modal`) |
| `title=` / custom tooltip | `display/Tooltip` |
| `new Date().toLocaleString()` / "ago" | `display/RelativeTime` |
| `.toFixed()` / `.toLocaleString()` for display | `display/Numeric` |
| checkbox styled as switch | `forms/AccessibleToggle` |
| `<select>` / custom dropdown | `forms/Listbox` |
| label+input+error | `forms/FormField` |
| custom tab strip | `layout/PanelTabBar` / `layout/SegmentedTabs` |

Import as `@/features/shared/components/<category>/<Name>`. If a genuinely new
reusable pattern is needed, **add it to `shared/components/` (not a feature folder)**
and give it a `@catalog <one-line>` JSDoc tag so it appears in the catalog. After
adding/removing a shared component run `npm run gen:catalog` (also auto-runs in
predev/prebuild; `npm run check` fails on a stale catalog). Extraction/consolidation
backlog (PanelShell, ContentCard, EmptyState merge, …) lives in the reuse doc above.

### Error Handling
- `toastCatch()` from `src/lib/silentCatch.ts` for user-facing errors (Sentry + toast)
- `silentCatch()` for background errors (Sentry + console only)
- `resolveError()` from `src/lib/errors/errorRegistry.ts` maps raw errors to friendly messages
- ESLint rule `custom/no-silent-catch` warns on empty `catch {}` blocks — the next person debugging in production needs a Sentry breadcrumb, not a comment.

### Concurrent CLI sessions (active-runs ledger)

Multiple CLI sessions (Claude Code agents, manual sessions, skill invocations) often work in parallel on this checkout, on the same branch, without branching for isolation. The coordination surface is **[`.claude/active-runs.md`](./active-runs.md)** — a single git-tracked ledger that any session materially editing the working tree should touch twice:

1. **At session start (Phase 0):** read the ledger; if any `## Active` entry's declared paths overlap your planned scope and the entry is `started`-status and less than 2 hours old, surface the conflict to the user before proceeding. Append your own entry to `## Active`.
2. **At session end (Phase 11/13):** move your entry to the top of `## Recently completed` with the resulting commit SHA (or `aborted (<reason>)` / `handoff: <path>`).

Rationale and full design space in **[`docs/architecture/cli-coordination.md`](../docs/architecture/cli-coordination.md)**. Ledger format conventions (timestamps, path declaration granularity, edit-conflict retries) live at the top of `active-runs.md` itself.

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

   For periodic batch cleanup of worktrees other sessions left behind, run `npm run clean:worktrees` — it lists every worktree with age / dirty / merged status and (with `--force`) removes the ones that are clean + merged + stale. See [`docs/development/build-cache.md`](../docs/development/build-cache.md).

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

## Documentation Sync — three surfaces, same-session enforcement

The product has three docs surfaces:

1. **`docs/features/`** (this repo) — implemented-product reference for users, developers, and CLI agents.
2. **`src/features/onboarding/`** (this repo) — guided-tour steps the user walks through on first launch.
3. **`personas-web/src/data/guide/content/`** (sibling repo at `../personas-web/`) — marketing-site guides at the product-explanation level.

Development happens through Claude with no second human reviewer to catch drift, so enforcement lives in this section and in a Stop hook. **The design choice is per-session gap-prevention, not a weekly catch-up cron** — drift compounds across sessions much faster than a weekly batch can clear it, so every session must leave all three surfaces consistent with whatever it changed in source.

### The rule

When a turn edits **feature/command source** with **user-visible** effect (new tab/page/command, changed flow, removed feature, new event, schema migration that surfaces in UI, renamed table, new tier gate), update **every coupled surface in the same turn** — including the cross-repo marketing guide if a `marketingModule` is mapped.

If the change is internal-only (refactor, bugfix without behavior shift, generated code, test-only) no surface update is needed. Dismiss the hook with one short sentence naming why.

The cross-repo cost (clone or `cd ../personas-web && git ...`) is real but it's lower than the compounding cost of guides falling out of sync with the desktop product across dozens of sessions.

### Source → docs map (single source of truth)

[`scripts/docs/feature-doc-map.json`](../scripts/docs/feature-doc-map.json) is the authoritative map. Each entry can declare up to three target types:

- `doc` — the feature doc path. **Required.** Drives the feature-doc Stop-hook nag.
- `onboardingFlows` — optional array of tour-flow IDs (from the `onboardingFlows` registry at the top of the same file). Drives the onboarding Stop-hook nag.
- `marketingModule` — optional `desktop-modules.ts` module ID. Drives an *informational* marketing breadcrumb (no enforcement; the scheduled `/guide-sync` is what actually keeps marketing in sync).

Quick reference of source → feature doc:

| Source area | Feature doc |
| --- | --- |
| `src/features/personas/**`, `src/features/agents/**`, `src-tauri/src/commands/core/personas.rs` | `docs/features/personas/README.md` |
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

When you add a new feature area, add an entry to `feature-doc-map.json` in the same change. If the feature has a corresponding onboarding tour step, list its flow id in `onboardingFlows`; if it has a corresponding marketing module, list it in `marketingModule`.

### The Stop hook — three independent checks per turn

`.claude/settings.json` registers a Stop hook that runs `node scripts/docs/check-doc-sync.mjs` before every turn ends. The script:

1. Walks the current turn's transcript for `Edit` / `Write` / `MultiEdit` / `NotebookEdit` calls.
2. Filters out skip patterns (tests, generated bindings, i18n, docs themselves, migrations, template/connector seeds).
3. Matches the remaining edits against `feature-doc-map.json` and runs **three independent exit-2 checks**:
   - **Feature doc** — if source matched an entry's `sourceGlobs` and no `docs/features/*` file was edited → exit 2 with a feature-doc reminder.
   - **Onboarding tour** — if source matched an entry that lists `onboardingFlows` and no `src/features/onboarding/**` file was edited → exit 2 with an onboarding-tour reminder naming the affected flow(s) and their step file(s).
   - **Marketing guide** — if source matched an entry with `marketingModule` and no `../personas-web/` file was edited → exit 2 with a marketing reminder naming the affected module(s). Cross-repo edits to `../personas-web/src/data/guide/content/*.ts` satisfy this; dismissal works the same way.

The three sections combine into one message. Exit 2 fires when **any** of feature-doc / onboarding / marketing is missing.

When you see the reminder, **either** update the named surface(s) in this turn (cross-repo `cd ../personas-web` is part of normal workflow), **or** reply with one short sentence — `"internal-only, no doc/tour/marketing update needed"` (or similar) — explaining why. Do not ignore the reminder silently. The dismiss path is the explicit trade-off for the noisier per-session model.

The hook honors `stop_hook_active`, so it can't infinite-loop. Test fixtures live at [`scripts/docs/__tests__/check-doc-sync.test.mjs`](../scripts/docs/__tests__/check-doc-sync.test.mjs) — run with `node scripts/docs/__tests__/check-doc-sync.test.mjs` (30 assertions, no deps).

### Marketing guides — cross-repo workflow inside the same session

Marketing guides live at `../personas-web/src/data/guide/content/<category>.ts` (sibling checkout). When the Stop hook surfaces a marketing reminder:

1. The fastest path is a direct edit: `Edit` the relevant `personas-web/src/data/guide/content/*.ts` file with the same change you just shipped on the desktop side. The mapping `desktop-module → guide category` is in [`personas-web/src/data/guide/desktop-modules.ts`](../../personas-web/src/data/guide/desktop-modules.ts) (`TOPIC_MODULE_MAP`).
2. For larger changes that affect many topics, invoke `/guide-sync` mid-session — it'll batch-propose updates and write them in one pass.
3. If the change is genuinely below the marketing-guide level of abstraction (an internal refactor, a bugfix that doesn't shift any user-visible flow), dismiss the reminder with `"no marketing impact, internal change only"`.

Both repos run their own `git` — keep commits atomic per repo. Per the parallel-safety primitives above, never `git stash` other sessions' work in either checkout.

**Mode tags**: Guide categories and topics have a `mode` field (`"simple"`, `"power"`, or `"both"`) controlling visibility in the guide filter UI. When moving features between Simple/Power modes in the desktop app, update the corresponding category or topic mode in `personas-web`.

### Catch-up runs

There is no scheduled `/guide-sync` cron — the per-session model is the entire enforcement. If drift accumulates (e.g. after a sustained period where multiple sessions dismissed marketing reminders), run `/guide-sync` manually to do a full pass. The marker at `.claude/guide-sync-marker.json` tracks the last full-pass commit so the skill knows what range of history to scan.

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
