# CLAUDE.md — Personas Desktop

## Project Overview

Cross-platform desktop app for building, orchestrating, and monitoring AI agent personas. **Tauri 2** (Rust backend) + **React 19** + **TypeScript 6** + **Vite 8** + **Tailwind 4** + **Zustand 5**. Local-first SQLite database with AES-256-GCM encrypted credentials.

## Common Commands

```bash
npm run dev              # Vite dev server (port 1420)
npm run tauri dev        # Full Tauri desktop dev mode
npx tsc --noEmit         # TypeScript check (tsc not on PATH on Windows)
npm run lint             # ESLint
npm run test             # Vitest (2,400+ tests)
npm run test:rust        # Rust unit tests (app_lib, --features desktop)
npm run test:rust:crates # Rust unit tests for the extracted crates only
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
- **`cargo test` exits 127 (`0xc0000139`) with no output on Windows** — this is the *loader* failing, not a test failing. The dependency graph (tauri dialog APIs → rfd) imports `TaskDialogIndirect`, which exists only in the **comctl32 v6** side-by-side assembly; test binaries carry no manifest requesting it, so they die before `main()`. tauri-build embeds the needed manifest into BIN targets only, which is why the app always worked. **Use `npm run test:rust`** — it embeds the manifest post-link (needs the Windows SDK's `mt.exe`; override with `MT_EXE`). Diagnose any binary with `node scripts/build/inspect-pe-imports.mjs <exe>`, which reports imported DLLs and whether a manifest is embedded. This cannot be fixed in `build.rs`: cargo has no directive targeting the *lib unit-test* binary (`rustc-link-arg-tests` reaches only `tests/`), and the catch-all `rustc-link-arg` also hits the app binary (`CVT1100: duplicate resource`) and the cdylib (`LNK1327`).
- **`npm run clean:rust` (nuclear, ~10+ min)** — full `cargo clean`. Last resort.
- `predev` auto-detects rustc host-triple drift via `scripts/check-build-cache.mjs`.

Codegen runs in parallel via `scripts/run-codegen.mjs` (per-task 60s timeout, override with `CODEGEN_TIMEOUT_MS`). `predev` and `prebuild` both go through it.

Advisory pre-release scripts (manual, not CI-gated):
- `npm run check:assets` — reports PNG → WebP compression savings via `scripts/optimize-assets.mjs --dry-run`. Run before bumping a release if asset weight matters.

## PR self-review (agent: run before pushing)

> Added by Ascent onboarding (D4 — agent-in-the-loop). The agent self-certifies against the repo's
> *real* gates **before** the branch leaves the box; CI is the backstop. Run these and confirm green
> before opening a PR (the local lefthook hooks enforce the fast subset; the full suites run in CI):

- `npm run check` — TypeScript + ESLint (incl. the 18 custom rules)
- `npm run check:i18n:strict` (no translation gaps — see i18n § "Translation completeness") · `npm run check:error-registry` · `npm run check:themes` · `npm run check:tauri-configs`
- `npm run test -- --run` (Vitest)
- If Rust changed: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo test --manifest-path src-tauri/Cargo.toml`, and `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings` (then commit `src/lib/bindings/`; without `--workspace --features desktop` **zero** bindings regenerate)
- `node .ai/doctor.mjs` — `.ai` conformance (no hard FAILs)

Then the judgment checks a linter can't make:
- Diff is small and single-purpose (one feature/fix per PR).
- New user-facing strings go through `t.section.key` — no hardcoded English in JSX.
- Security-sensitive edits (crypto/vault/connectors/IPC commands) are flagged for human review.
- Public-API / ts-rs binding / generated command-name changes are intentional and regenerated.
- `CHANGELOG.md` has an `[Unreleased]` entry for user-visible changes.

Dependency bumps come in via Renovate (`renovate.json`): the agent reads the changelog / breaking
changes and evaluates — never blind-merges minor/major. The human-facing DoD lives in the PR template.

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
- **After adding `#[derive(TS)] #[ts(export)]` to a Rust struct**, run `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings` from the repo root. Commit the resulting new/changed files in `src/lib/bindings/`.

  > **`--workspace` and `--features desktop` are load-bearing; this line omitted both until 2026-08-14.** Without them **zero** bindings regenerate — CI documents exactly this at `.github/workflows/ci.yml:385-386` and runs the full form itself. Following the old instruction produced no output, no diff, and nothing to commit, which is indistinguishable from "already up to date".
  >
  > **The drift job cannot catch that for a NEW type.** `git diff --quiet src/lib/bindings/` (`ci.yml:391`) exits **0** for an untracked file — verified directly. A new binding is untracked by definition, so the one case this gate exists for is the one it cannot see. Two independent failures pointing the same way is why 19 orphan bindings accumulated (types whose Rust source is gone; ts-rs never deletes, so there is no diff to notice).
- CI verifies via `git diff --quiet src/lib/bindings/` — a missing regen fails the build at `.github/workflows/ci.yml`'s binding-drift job.
- New Tauri commands additionally need `node scripts/generate-command-names.mjs` (or just `npm run dev`/`npm run build` which trigger `predev`/`prebuild`).

### Styling
- **Canonical reference: [`.claude/Design.md`](./Design.md)** — single source of truth for tokens, typography, color, spacing, radius, elevation, motion, and component primitives. Read it before adding any new UI surface or extending an existing one.
- Semantic design tokens: `typo-*` for text sizes, `rounded-{interactive,input,card,modal}` for radii, `shadow-elevation-1..4` for depth, JS spacing tokens (`CARD_PADDING`, `SECTION_GAP`, ...) for layout
- `[data-theme^="light"]` CSS selectors for light theme overrides
- Never use `text-white/*` or `bg-white/*` directly — use `text-foreground/*` or `bg-secondary/*`
- ESLint warns on raw Tailwind classes that have semantic equivalents (see Design.md §8 Do's and Don'ts)

### Reusing shared components — check the catalog before building UI

> **Before you write any UI, check whether a shared component already exists.**
> The project has **~115 reusable, domain-agnostic primitives** under `src/features/shared/components/`,
> catalogued in **[`src/features/shared/components/CATALOG.md`](../src/features/shared/components/CATALOG.md)**
> (auto-generated, always fresh — the durable UI reference bundle). The #1 source of UI
> drift is new code re-implementing a spinner / empty state / button / modal / tooltip /
> badge / copy-button / relative-time / number-format that already exists.
>
> **The catalog is a recommended reference, not a build gate.** `shared/components/**` is
> meant to stay primitives-only — ideally it does not import from `@/stores`, `@/api`,
> `@/lib/bindings`, or any `@/features/<feature>`. An ESLint rule in `eslint.config.js`
> **warns** (advisory, non-blocking) when it does, but nothing fails the build. App-shell
> chrome (sidebar, titlebar, footer, toasts, command palette) lives in **`src/features/shared/chrome/`**
> (shared but NOT catalogued); domain components live in their owning feature. If a component
> needs app state, prefer passing it via props or putting the component in `chrome/` or a
> feature — but this is guidance, not enforcement. The 2026-06-18 curation (206→115) and the
> rationale are in [`docs/refactor/catalog-curation.md`](../docs/refactor/catalog-curation.md).

**Do NOT hand-roll these — import the shared one** (full table + import paths in
[`docs/refactor/shared-component-reuse.md`](../docs/refactor/shared-component-reuse.md)):

| Don't hand-roll | Use |
|---|---|
| a busy state on an **action control** (a button/row affordance the user just pressed) | `buttons/AsyncButton` — it renders a **real** spinner. **Never `feedback/LoadingSpinner`, which renders `null`.** See [the spinner boundary](#the-spinner-boundary--banned-for-surfaces-required-for-actions) below |
| a loading state for a **surface** (a region fetching its data) | a calm delayed ghost under permanent chrome — see [Cold-load / loading UX](#cold-load--loading-ux--the-standard-loading-pattern-v2) below. **A spinner is never a surface loading state in this app.** |
| "no data" block | `feedback/ScenarioEmptyState` (default export — call sites import it as `EmptyState`), plus its `NoResults` / `InboxZero` wrappers. Chart panels → `display/ChartEmptyState`; compact generic block → `display/EmptyIllustration` |
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
| a table + its loading skeleton / empty state / row animation | `display/UnifiedTable` — pass `columns` + `data` + `isLoading`; you get ghost-under-chrome, empty-flash safety, and the id-guarded row-entrance cascade for free (see below) |
| a loading skeleton for a lazy route/section chunk | `layout/RouteChunkSkeleton` as the `Suspense fallback` (delayed header-only ghost, invisible when warm — never `fallback={null}` or a centered spinner) |
| a per-row/tile entrance stagger | `display/RevealItem` (polymorphic `as="tr"\|"li"\|"div"`) + `useRevealTracker` |

### Cold-load / loading UX — the standard (loading pattern v2)

**Never hand-roll a skeleton, spinner branch, or big-bang reveal for an async surface.** The single source of truth is [`docs/design/overview-loading.md`](../docs/design/overview-loading.md) (the five laws; reference impl `overview/sub_activity/components/GlobalExecutionList.tsx`). Compose the four shared mechanics:
1. **Lazy route/section** → wrap in `<Suspense fallback={<RouteChunkSkeleton/>}>` (kills the blank chunk-load gap; invisible once the chunk is warm/idle-prefetched).
2. **A list/table** → use `UnifiedTable` with `isLoading` + `data`. Its three-state body (ghost-under-header while `isLoading && empty` → settled-only empty → rows rippling in via a cascade **coupled to `isLoading`**) is the whole doctrine from two props.
3. **A non-table data region** → static chrome always renders; ghost **under** it only when `isLoading && items.length===0` (a fetch never hides rendered rows — law 1); rows via `RevealItem` + `useRevealTracker`.
4. **A view that fully unmounts on nav-away** (lazy routes do) → keep last fetch in a **module-scoped cache** keyed by entity so a remount paints warm, not a re-ghost (precedent: `sub_lifecycle/LifecyclePage.tsx`, `.../competitions/CompetitionList.tsx`).

Import as `@/features/shared/components/<category>/<Name>`. If a genuinely new
reusable pattern is needed, **add it to `shared/components/` (not a feature folder)**
and give it a `@catalog <one-line>` JSDoc tag so it appears in the catalog. After
adding/removing a shared component run `npm run gen:catalog` (also auto-runs in
predev/prebuild, so CATALOG.md stays fresh on its own — but a stale catalog no
longer fails `npm run check`; regeneration is a convenience, not a gate). The
`check:catalog` / `check:catalog-boundary` scripts still exist for a manual
staleness/boundary audit if you want one. Extraction/consolidation backlog
(PanelShell, ContentCard, FilterToolbar, …) lives in the reuse doc above.

### The spinner boundary — banned for surfaces, required for actions

**These are two different situations with opposite prescriptions. Getting them
confused is the single most common loading defect in this repo.**

> **A spinner is banned for a surface loading its data. A spinner is required on
> a control the user just pressed.**

| | A **surface** loading its data | An **action** the user just triggered |
|---|---|---|
| Examples | a tab, page, panel, list, chart fetching on mount or on filter change | Save, Send, Retry, Test connection, row-level Approve |
| Show | a calm geometry-matched ghost **under** the permanent chrome (see the four mechanics above) | a **real, visible spinner** on the control itself, plus `disabled` + `aria-busy` |
| Use | `UnifiedTable` (`isLoading` + `data`) · `RouteChunkSkeleton` · a local delayed ghost | `buttons/AsyncButton` (returns-a-promise `onClick`, no state at all) or `buttons/Button loading={flag}` when the flag is externally owned |
| Never | a spinner, `animate-pulse`, or `if (loading) return …` that replaces chrome | `useState(false)` + `try/finally`, a scalar flag for a per-row action, `onClick={() => void fn()}` (that silently disarms the double-submit guard) |
| Doctrine | [`docs/design/overview-loading.md`](../docs/design/overview-loading.md) | [`docs/concepts/golden-paths/inline-busy-state.md`](../docs/concepts/golden-paths/inline-busy-state.md) |

**`feedback/LoadingSpinner` renders `null`.** It is a compatibility shim that
emits only an `sr-only` `role="status"` when you pass `label`. It is not a
spinner and it is not a ghost — it is nothing. `{busy ? <LoadingSpinner/> :
<Icon/>}` makes the icon vanish and puts nothing in its place. Do not render it
as either half of the table above. The real spinners live inside `Button`
(`Button.tsx:230,:237`) and `AsyncButton` (`AsyncButton.tsx:85`), which is
deliberate.

> ⚠️ `CATALOG.md`'s `LoadingSpinner` row still reads "Canonical loading
> spinner… Use for any full-element loading state", which is wrong on both
> halves. That text is **not** a `@catalog` tag on the component — it is
> hardcoded in the `CURATED` map at `scripts/docs/gen-shared-catalog.mjs:56`,
> so regenerating the catalog will not fix it. Correcting that line is an owed
> follow-up in the shared-components territory.

### Error Handling
- `toastCatch()` from `src/lib/silentCatch.ts` for user-facing errors (Sentry + toast)
- `silentCatch()` for background errors (Sentry + console only)
- `resolveError()` from `src/lib/errors/errorRegistry.ts` maps raw errors to friendly messages
- ESLint rule `custom/no-silent-catch` is **`"error"`** (`eslint.config.js:104`), not "warns" as this line said until 2026-08-14. A full run over 4,829 files returns **0 findings** — the condition is extinct, not unenforced. It is absent from the top lint rules because the gate worked.
- **But it only sees empty `catch {}`.** Measured 2026-08-14: of **2,752** production catch sites, **760 try/catch bodies reach no error door at all** (Sentry, toast, or log) across 440 files, and only **10.6%** produce a Sentry *event*. `.catch()` sits at **99.5%** adoption against try/catch's **58.6%** — a 41-point gap in the same repo for the same concept, and the sole difference is that a lint rule visits `.catch` while nothing visits a `CatchClause` body. See [`docs/concepts/golden-paths/swallowed-error-telemetry.md`](../docs/concepts/golden-paths/swallowed-error-telemetry.md).

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

5. **`git commit -- <pathspec>` does NOT reliably scope the commit when lefthook is installed.** Measured 2026-08-13 with four agents on one checkout: an agent used `git commit -- <paths>` precisely to avoid sweeping a sibling's work, and it swept three pre-staged files anyway (lefthook's partial-commit handling re-stages). `git commit --only <paths>` did hold. Two agents also lost a staged index entirely between `git add` and `git commit` — a sibling's activity cleared it, the commit silently became a no-op, and only `git reflog` showed the commit never happened. **`git commit --only` does not hold either.** Measured again later the same day: a sibling's commit landed between staging and committing, `--only` printed "no changes added to commit" and silently no-oped, and all 12 staged files were swept into the sibling's commit — whose own deliverable then did not make it in. **There is no reliable pathspec-scoping incantation while another agent commits to the same worktree.** What actually works: (a) verify `git log --oneline -1` is YOUR message after every commit — this is the only step that detects the failure at all; (b) recover by amending rather than resetting, since the content is present and only the attribution is wrong; and (c) for multi-file work, use a real `git worktree`, which is the only structural fix. A commit that didn't happen looks exactly like one that did if you only read the hook output.

6. **The scratchpad directory is shared between sibling agents.** Two agents wrote their commit message to the same generic filename (`msg1.txt`) and one overwrote the other between `Write` and `git commit -F`. Use a unique filename per agent, or pass the message inline.

7. **`git status` shows everyone's work — and so does the staged index.** Before any commit, scan `git status --porcelain` and classify each entry: yours / pre-existing drift / another session's in-flight work. Stage only yours. The 2026-05-09 stash victim was visible in `git status` to the stashing session — the missing discipline was "what's there that isn't mine?", not "what should I commit?"

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

**Source of truth**: `src/i18n/locales/en.json` (~17,000 leaf keys across 60 top-level sections — `common`, `agents`, `vault`, `overview`, `triggers`, …)
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
4. **Translate the new keys into every locale in the same change** — do NOT rely on English fallback. A half-English non-English UI is the exact failure mode this rule prevents (see **Translation completeness — no gaps** below). Don't hand-edit 13 files: run `node scripts/i18n/translate-extract.mjs`, spawn one Sonnet subagent per locale to fill `.i18n-work/missing-<code>.json`, then `node scripts/i18n/translate-merge.mjs`. A pre-commit hook blocks commits that leave a gap.
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
node scripts/i18n/check-coverage.mjs           # report — fails on EXTRAS (stale keys); MISSING only warns
npm run check:i18n:strict                      # the no-gap gate — fails on MISSING or extra
node scripts/i18n/check-coverage.mjs --json    # Machine-readable
```

`check-coverage.mjs` reads `src/i18n/locales/*.json`. **Extras always fail** (stale keys after a rename). **Missing keys (untranslated) are blocked at commit** by the `i18n-no-gaps` pre-commit hook, which runs `--strict` whenever a commit stages any `src/i18n/locales/*.json`. Default (non-strict) mode only warns, and is what pre-push + CI report.

### Translation completeness — no gaps (ENFORCED)

> English text rendered inside an otherwise-translated locale makes the app feel
> broken — a half-translated UI is worse than none. So: **every key you add to
> `en.json` must be translated into all other locales in the same change.** This
> supersedes the old "translation teams catch up asynchronously" posture; the
> runtime English fallback is a safety net, not a shipping state.

**Enforcement:** the `i18n-no-gaps` **pre-commit** job (`lefthook.yml`) runs
`check:i18n:strict` whenever a commit stages any `src/i18n/locales/*.json`, so a
commit that adds `en.json` keys without translating every locale is blocked.
Stage `en.json` and all locale files together — the hook reads the working tree.

**How to close a gap (don't hand-edit 13 files — use the pipeline):**

```bash
node scripts/i18n/translate-extract.mjs   # 1. writes .i18n-work/missing-en.json (the gap) + _meta-keys.json
# 2. Spawn ONE Sonnet subagent per non-English locale. Each reads
#    .i18n-work/missing-en.json and writes .i18n-work/missing-<code>.json with
#    the SAME keys translated. Rules: preserve {placeholders}; keep brand /
#    technical terms (Claude, Personas, SomaFM, YouTube, API, KPI, MCP…); handle
#    plural-variant keys; keep UI register concise; medium quality is fine.
node scripts/i18n/translate-merge.mjs     # 3. validates + merges into locales + re-splits section-locales + asserts strict coverage
```

Medium-quality machine translation is explicitly acceptable — the bar is "no
English mixed in", not literary polish (a human team can refine later without
re-running the pipeline; the keys are all present). `translate-merge` refuses to
merge any locale that dropped keys or broke a `{placeholder}`, and removes the
`.i18n-work/` scratch dir on success. **New `en.json` keys are part of this — wiring
i18n into a feature isn't done until `npm run check:i18n:strict` is clean.**

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
- Lint baseline — **measured 2026-08-14 at HEAD: 0 errors, 1,135 warnings across 246 of 4,829 files.** Breakdown: `custom/no-low-contrast-text-classes` **705 (62%)**, `custom/no-hardcoded-jsx-text` 226, `custom/no-raw-radius-classes` 128, `custom/no-raw-text-classes` 16, `no-restricted-imports` 13. Follow the fix-as-you-touch policy; do not bulk-migrate.

  > **Corrected 2026-08-14.** This line previously read "~10,086 warnings … almost entirely `no-raw-*-classes`", a figure from the 2026-04-17 pass that went stale when `no-raw-spacing-classes` was disabled. It was wrong by ~9×, and wrong about the dominator: the whole `no-raw-*` family is **144 (12.7%)**, not "almost entirely". Five golden paths cited it as the *reason* to ship a gate at `"error"` ("a warn-level rule is invisible in a sea of 10,086"). **Re-measure before citing.**
  >
  > The conclusion survives on better grounds, and they don't depend on the count: `npm run check` runs `eslint src/` with **no `--max-warnings`**, so it exits 0 no matter how many warnings exist; the pre-commit hook runs `--quiet --max-warnings 99999`, and `--quiet` suppresses warnings before they can be counted. **A warn-level rule enforces nothing at either gate, by construction.** Warn-level rules still change behaviour — but through editor squiggles at authoring time, not enforcement, which is why they correlate with adoption without ever failing a build.
- `react-hooks/rules-of-hooks` violations (conditional hooks, hooks called outside components): ~21 remain across ~7 files, at warn-level pending triage. Not a ship-blocker; fix opportunistically when touching those files.

### Historical (for context; no longer active on `master`)

- The "~159 pre-existing TS errors" and the `AccountSettings.tsx` missing-import list from earlier versions of this document **no longer apply**. The 2026-04-17 ship-ready pass resolved all TS errors; `npx tsc --noEmit` now exits clean on `master`. If you see TS errors on a branch, treat them as regressions introduced on that branch.

<!-- vibeman:context-map:start -->
## Context Map

This project has a Vibeman-generated context map at `context-map.json` (repo root). It maps every file to a feature ("context"), grouped by business domain. **Before editing code, read `context-map.json` to find the relevant context and scope your changes to its `filePaths`.** The `index` field is a quick one-line-per-context overview. If you change which files a context owns, update `context-map.json` to match (or run Vibeman's refresh) so it stays accurate.

### ⚠ Two different maps currently claim this file

`context-map.json` as committed today is **Vibeman's** artifact — `$schema: vibeman.dev/…`, `version: "2.0.0"` (string), `projectId f8698d31-…`, and `projectPath C:\Users\mkdol\dolla\personas` (a different machine). It describes **12 groups / 236 contexts**.

The **Personas app writes its own file to the same path** (`context_map_export.rs`, after every context scan) in a different format — no `$schema`, `version: 2` as an integer, and the app's own `projectId`. Its map, which is what the database holds and what every app feature reads, is **8 groups / 49 contexts**. The generated block at the top of the root `CLAUDE.md` reports those numbers.

So the counts in the root `CLAUDE.md` and the contents of `context-map.json` disagree, and both are honest — they come from different tools. **The database is the authority for anything the app does** (context-scoped KPI scans, the improve plan, Ship footprints); the committed file is a stale foreign snapshot until the app's next context scan overwrites it. Read the file for a quick orientation if you like, but size any per-context work off the app's 49, not the file's 236 — a 2026-07-29 session sized a KPI sweep at 236 from this file and was wrong by ~5×.
<!-- vibeman:context-map:end -->

## Model & reasoning effort — when to tell the user to change them

Measured on this operator's own repos (2026-07-24/25). Evidence and caveats:
[`docs/development/model-effort-guide.md`](../docs/development/model-effort-guide.md).
**Scope: ONE problem shape — long-form design — with one sample per cell. The
build-and-verify arm was run and then DESCOPED as invalid (see the guide). Treat
everything below as a weak prior, not a rule.**

**You cannot introspect this.** Thinking content is redacted to empty in the
transcript and the stream, so a session has no signal for how hard it is
reasoning. Never trigger on "this feels hard" — trigger only on observable
properties of the task, checked once when scope becomes clear.

**More effort is not automatically better.** On long-form design work, quality
*inverted* above medium: the priciest run wrote 1,327 lines, drifted its own
cross-references, and was the only one to violate its brief. Length is not
insight. Do not recommend raising effort for prose or design deliverables.

**Do not recommend raising effort when output is tightly capped.** With a hard
length cap, Opus showed *no* effort response at all (104→112 output tokens from
low to max). You would be spending on reasoning you do not get.

**Do not assume the bigger model is the safer default.** The model axis did not
survive its own cross-check — two judges disagreed (ρ = 0.50) and each ranked its
own model family first. Choose on cost.

**Suspect framing before capacity.** The most replicated finding: on the design
task all eight runs, at every model and effort, missed the *same* thing. No
escalation would have found it; a sharper problem statement would have. When
output disappoints, re-read the request before reaching for a bigger model.

**How to raise it** — one sentence, once per session, naming the property that
triggered it and the command (`/model`, `/effort`). Never repeat, never block,
and drop it for the session if the user declines.

**The hard-won corollary — about your own verification, not the models'.** This
benchmark's own fixture corpus passed a green verification gate and was still
garbage: the check confirmed numbers round-tripped into the asset, never that the
result was anatomically meaningful, and the artifacts turned out to be visibly
broken the moment a human opened them. **A gate that asserts data is not a gate
on behavior.** Two judge models had meanwhile scored the work at 4/4 while
logging unsubstantiated claims against it. Confidence — theirs or yours — is weak
evidence. Observe the actual output.

## Decision Mirror (operator decision capture)

This repo captures the operator's decisions to build a behavioral profile for
Athena (design + schema: [`docs/concepts/decision-mirror.md`](../docs/concepts/decision-mirror.md)).
Selects/multiselects are captured automatically by a PostToolUse hook, and every
prompt he types plus what your turn did with it by a UserPromptSubmit + Stop
hook pair — no session action needed for either. **Your one duty:** when the
user CORRECTS your course mid-session (overrides an approach, reverses a
decision, redirects scope), record it in the same turn:

```bash
MSYS_NO_PATHCONV=1 node scripts/decision-ledger/capture-decision.mjs --correction "<what the user directed, near-verbatim>" --was "<what you were doing>" --context "<one-line situation>"
```

The `MSYS_NO_PATHCONV=1` prefix is load-bearing on Windows: without it, a
`--context` that opens with a slash-command name gets rewritten by MSYS path
conversion, and four corrections in the ledger now read
`C:/Program Files/Git/architect …` instead of `/architect …`.

Corrections are the highest-value signal in the ledger — never skip one, never
paraphrase away the user's reasoning. The ledger (`.claude/decision-ledger/`)
is personal data: gitignored, never committed, never quoted into committed
files. Distillation runs via the `/reflect-me` skill.
