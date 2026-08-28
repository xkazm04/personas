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
npx vite build           # Vite ONLY — bypasses all 14 codegen tasks. Run
                         # `node scripts/run-codegen.mjs prebuild` first, or
                         # use `npm run build` (which does it for you).
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

- `npm run check` — **thirteen gates, not two.** Eleven project checks run *first*, in this order (`check:contracts`, `check:command-registration`, `check:bindings`, `check:glyphs`, `check:tiers`, `check:tauri-configs`, `check:csp-hosts`, `check:corpus`, `check:evidence`, `check:doc-map`, **`census:check`**), then `tsc --noEmit`, then `eslint src/` (21 custom rules — 3 at `error`, 17 at `warn`, 1 `off`). It is a `&&` chain: the first failure stops it and you never see the gates behind it, so a green `tsc` locally tells you nothing about the eleven that run ahead of it. The census is the one most likely to fail a diff that compiles — see [The golden-path census](#the-golden-path-census--the-gate-most-likely-to-fail-a-clean-diff) below.

  > **Re-counted 2026-08-28 against the `&&` chain itself, not from memory.** The line said "ten gates … eight project checks" and then listed eight names — but the chain already ran **ten** project checks: `check:command-registration` and `check:bindings` were added and never made it into the prose, so the two most recently adopted gates were the two an agent reading this had never heard of. `check:glyphs` (this pass) makes eleven. The count is now derived from `package.json:54`; if you add a gate, add it here in the same commit.
  >
  > **Corrected 2026-08-20.** This line read "TypeScript + ESLint (incl. the 18 custom rules)" and named neither the eight project checks nor the census. There are **21** custom rules, not 18. An agent reading it would run `npm run check`, watch `census:check` fail on a rule it had never heard of, and have no doctrine for what to do next — which is the whole reason the section below now exists.
- `npm run check:i18n:strict` (no translation gaps — see `.claude/rules/i18n.md` § "Translation completeness") · `npm run check:error-registry` · `npm run check:themes` · `npm run check:tauri-configs`
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

### The golden-path census — the gate most likely to fail a clean diff

**This is the repo's strongest enforcement mechanism and until 2026-08-20 this file
never described it.** If your change compiles, type-checks, lints clean and still fails
the push, this is almost certainly why.

`scripts/census/rules.json` holds **204 regex-shaped rules** (recounted 2026-08-24 from `rules.json`; the 2026-08-20 full-run stats below still cite 201) — one per golden-path
violation the repo has decided to stop growing (`hand-rolled-spinner`,
`untyped-command-payload`, `native-title-tooltip`, `bindingless-catch-on-io`, …). Each
carries a **ratcheting baseline**: the count measured at adoption. `scripts/census/run-census.mjs`
walks the tree and compares.

**Where it runs:** inside `npm run check`, and at **pre-push** (`lefthook.yml:74`) —
deliberately *not* pre-commit, because the walk is minutes long. So a `git commit`
never consults it and a `git push` always does. That gap is the normal way an agent
meets this gate for the first time.

**It fails in both directions, and the second one surprises everybody:**

| Outcome | Meaning |
|---|---|
| a count **rises** above baseline | you added a violation — fix it |
| a count **drops** below baseline | usually a *broken matcher*, sometimes a real fix — never silently accepted |
| walk visits fewer files than `floor` | the matcher is broken, not the codebase clean |
| a rule matches **zero** files anywhere | same — a rule that finds nothing is assumed broken |
| an `exclude` entry matches nothing | stale exemption, delete it |

The last three are the **fail-loud contract**: this repo is, in the runner's own words,
"a museum of gates that ran green while checking nothing", so *found nothing* and
*looked at nothing* are treated as different outcomes and only one is success.

**When it fails, do this — not a blind edit:**

```bash
npm run census -- --rule <rule-id> --verbose   # prints the offending file:line list
npm run census:check                            # the gate itself
npm run census -- --json                        # machine-readable
node scripts/census/self-test.mjs               # proves the engine still detects its own failure modes
```

`npm run census -- --update` re-baselines to measured reality. It is the **legitimate**
way to clear a drop you caused with a real fix — it is a deliberate act that lands in
the diff where a reviewer sees it, which is the entire point of a ratchet. **Never
reach for it to make a *rise* go away**; that is how you launder a new violation into
the baseline.

**Adding a gate is an entry in `rules.json`, not a new script.** That is the system's
whole design — 247 situation leaves × ~2 gates each would otherwise be ~460 bespoke
checkers. Prefer it to a new ESLint rule for anything regex-shaped, and note that it
reads `.rs`, `.md` and `.sql` too, where ESLint cannot reach.

> Measured 2026-08-20 at HEAD: 201 rules, 518,843 file-visits, **13,245 surviving
> violations across 6,005 files** — all baselined, all green. A large number here is
> not debt out of control; it is debt that has been counted and frozen.

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
├── ../db/            # SQLite schema, migrations, repos — an EXTRACTED CRATE at
│                     # src-tauri/db/, not src-tauri/src/db/ (which does not
│                     # exist; this line claimed it did until 2026-08-14).
│                     # engine/ and core/ are extracted the same way — see
│                     # `npm run test:rust:crates`.
└── src/engine/       # Execution engine, scheduler, healing, crypto
```

## Important Conventions

### State Management
- Zustand with slice pattern in `src/stores/slices/`
- Use `useShallow` from zustand for selective subscriptions
- `globalThis` for singletons surviving HMR. **Corrected 2026-08-14: this line named `executionBuffers` and `eventBus`, and NEITHER IDENTIFIER EXISTS.** `executionBuffers` appears nowhere in the tree except this line and **four** source comments citing it as precedent (`fleetTerminalManager.ts`, `useScrollRestoration.ts`, `silentFailureTelemetry.ts`, `tourSlice.ts`). `eventBus` is really `globalThis.__personasEventBridge` (`src/lib/eventBridge.ts:142`). The real object behind the first name is `executionSink` (`src/lib/execution/executionSink.ts:339`) — a plain module const, not on `globalThis`.

  > **Two corrections to this correction, both earned 2026-08-14.** (1) It first said "three" comments, because the grep that produced it ended in `head -3` — a measurement truncated by its own display limit and then reported as the finding. Same family as the substring-vs-structural errors catalogued elsewhere in this file: **the tool answered a different question than the one asked, and the answer looked plausible.** (2) It implied `executionSink` is the defect. It is not — it is the best answer in the repo, using a `generation` counter to make stale copies inert, re-bound at `executionSlice.ts:189-192`. The fiction inverted its meaning.
  >
  > Measured state of the convention: **25 `globalThis` keys, of which 13 are actually state, across 8 owners**; all 13 ship to production unguarded and 6 of the 8 owners have no test-reset hatch. `import.meta.hot` is used **zero** times in 4,829 files, and was considered and declined in writing in two repos — it is not the sanctioned alternative. The useful discriminator is **refcount vs one-way latch**, not "holds a timer". See [`docs/concepts/golden-paths/hmr-safe-singletons.md`](../docs/concepts/golden-paths/hmr-safe-singletons.md).

### Tauri IPC
- Always use `invokeWithTimeout` from `@/lib/tauriInvoke` — never raw `invoke`
- ESLint `no-restricted-imports` enforces this

### ts-rs bindings (Rust → TypeScript types)
- **Single source of truth: `src/lib/bindings/`.** ts-rs writes here directly via `TS_RS_EXPORT_DIR`, which is forwarded to rustc by `src-tauri/build.rs` (`cargo:rustc-env=TS_RS_EXPORT_DIR=../src/lib/bindings`). The earlier `[env]` table in `src-tauri/.cargo/config.toml` did NOT reliably reach the proc-macro expansion path — the dual-tree drift (`src-tauri/bindings/` AND `src/lib/bindings/` both committed and drifting) traced to that. The build.rs route closes the gap; `src-tauri/bindings/` was retired and now appears in `src-tauri/.gitignore` to prevent any future leak. The `.cargo/config.toml` entry stays as a belt-and-suspenders backstop for tooling that calls cargo without going through the build.rs.
- **After adding `#[derive(TS)] #[ts(export)]` to a Rust struct**, run `cargo test --workspace --manifest-path src-tauri/Cargo.toml --features desktop export_bindings` from the repo root. Commit the resulting new/changed files in `src/lib/bindings/`.

  > **`--workspace` and `--features desktop` are load-bearing; this line omitted both until 2026-08-14.** Without them **zero** bindings regenerate — CI documents exactly this at `.github/workflows/ci.yml:385-386` and runs the full form itself. Following the old instruction produced no output, no diff, and nothing to commit, which is indistinguishable from "already up to date".
  >
  > **The drift job could not catch that for a NEW type — FIXED 2026-08-14 at `ci.yml:426-431`, with the verification in the comment.** `git diff --quiet src/lib/bindings/` exits **0** for an untracked file, so a new binding — untracked by definition — was invisible to the one gate that existed for it. That hole is closed; the text above described the pre-fix state until 2026-08-17.
  >
  > **What the fix does not reach: orphans — NOW GATED, and the count was wrong.** Re-measured 2026-08-22 by an inventory walk over all 963 `.rs` files: **1,008 `#[derive(TS)] #[ts(export)]` types, 1,039 binding files, 35 orphans** — not the 29 recorded on 2026-08-17 (whose three implementations reported 48 / 31 / 29). They split into **13 whose Rust type still exists but no longer carries the TS derive** — the binding and the struct drift apart with nothing comparing them — and **22 with no Rust type of that name at all**. **30 of the 35 are still referenced by app code and 20 are still the declared return type of a live `invoke`**, which is exactly why `scripts/check-unused-bindings.sh` *protects* them: "imported" is its definition of used, so the most dangerous orphans are the ones it certifies as fine. ts-rs never deletes, so an orphan produces **no diff and no untracked file** and is invisible to a diff-shaped gate by construction. The inventory-shaped gate is **`npm run check:bindings`** (`scripts/check-binding-orphans.mjs`, in `npm run check`), with a two-sided allowlist at `scripts/binding-orphan-allowlist.txt` — it fails on a NEW orphan and on an allowlisted name that stops being one. It also checks the mirror direction: **4 `#[ts(export)]` types have no committed binding at all** (all in `personas-core`, none feature-gated), baselined in `scripts/binding-missing-allowlist.txt`.
- **`src/lib/bindings/index.ts` is GENERATED** — `node scripts/generate-bindings-index.mjs`, wired into `predev`/`prebuild` as the `bindings-index` codegen task and verified byte-for-byte by `npm run check`. It was hand-maintained with no generator and no gate until 2026-08-22: an added binding was silently absent from the barrel, and a removed one left a dangling `export type … from "./Gone"` that breaks `tsc`. Do not hand-edit it.
- CI verifies via `git diff --quiet src/lib/bindings/` — a missing regen fails the build at `.github/workflows/ci.yml`'s binding-drift job.
- New Tauri commands additionally need `node scripts/generate-command-names.mjs` (or just `npm run dev`/`npm run build` which trigger `predev`/`prebuild`).

### Type assertions — name the invariant, or don't assert

> **A chained assertion (`x as unknown as T`) discards the evidence the compiler
> already had.** That is not a bug on its own — it compiles, and everything downstream
> believes the new type. It becomes a bug the first time reality disagrees, and by then
> TypeScript has no way to warn you, because you threw away the thing it would have
> warned from.

**The convention: any assertion that crosses a data boundary carries a comment naming
the invariant that makes it safe.** Parsed JSON, a DB blob, an IPC payload, an imported
`.json` fixture, an i18n proxy — anywhere the value's real shape is decided somewhere
other than the type annotation. Prefer parsing at the boundary (narrow once, into a
named domain type) over asserting past it.

The canonical *good* site is `src/features/home/sub_releases/i18n/useReleasesTranslation.ts:88-90`:
three lines of comment explaining why the generated type must be flattened, then the cast.

The canonical *bad* outcome is recorded in that same file's header (`:5`): the version
before it carried **"9 `as unknown as` casts papering over key drift"**. The refactor
removed them. Nothing prevents the next nine.

**Measured 2026-08-20** across `src/` — 220 `as unknown as`, 124 of them in production code:

| Shape | Count | Verdict |
|---|---|---|
| ambient-global escape (`window as unknown as { webkitAudioContext }`) | 44 | **fine** — the DOM lib genuinely lacks these; there is no evidence to discard |
| data-boundary cast (`parsed as unknown as DesignContextData`) | 80 | **this is the one the convention is about** |
| carrying any justifying comment | 30 / 220 | ~14% |

**This is convention, not a gate — deliberately.** 0 of the 201 census rules and 0 of
the 21 custom ESLint rules inspect a type assertion (both checked uncapped, 2026-08-20).
A blanket rule was considered and declined the same day: it would fire on all 44
ambient-global sites, where converting them would be a regression. The repo instead
gates the *specific doors* where a cast has actually caused harm — `unnamed-cast-at-navigation-door`,
`asserted-definition-blob`, `caller-asserted-owner`, `unchecked-destination-id-assertion`,
`unverifiable-catalog-lookup`. If you find a sixth such door, add it to `rules.json`
rather than reaching for a blanket rule.

> Note the asymmetry this closes: `.claude/skills/codebase-init/skill.md:110` has always
> instructed every *managed* repo's generated CLAUDE.md that escape hatches "need a
> comment justifying them". Personas prescribed this to its customers before it wrote
> it down for itself.

### Styling
- **Canonical reference: [`.claude/Design.md`](./Design.md)** — single source of truth for tokens, typography, color, spacing, radius, elevation, motion, and component primitives. Read it before adding any new UI surface or extending an existing one.
- Semantic design tokens: `typo-*` for text sizes, `rounded-{interactive,input,card,modal}` for radii, `shadow-elevation-1..4` for depth, JS spacing tokens (`CARD_PADDING`, `SECTION_GAP`, ...) for layout
- `[data-theme^="light"]` CSS selectors for light theme overrides
- Never use `text-white/*` or `bg-white/*` directly — use `text-foreground/*` or `bg-secondary/*`
- ESLint warns on raw Tailwind classes that have semantic equivalents (see Design.md §8 Do's and Don'ts)

### Reusing shared components — check the catalog before building UI

> **Before you write any UI, check whether a shared component already exists.**
> The project has **128 reusable, domain-agnostic primitives** (recounted 2026-08-17 from the generated catalog; this line said ~115, a figure from the 2026-06-18 curation that has drifted by 13) under `src/features/shared/components/`,
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
| `fixed inset-0` modal backdrop | `modals/BaseModal` / `feedback/ConfirmDialog` — ~~enforced by `custom/enforce-base-modal`~~ **not enforced; corrected 2026-08-17.** That rule is `"warn"` (`eslint.config.js:95`), and warn-level enforces nothing at either gate. Worse, it does not *detect* this either: driven over its whole anchor it reports **8 sites at precision 0/8** (all anchored popovers or an inline notice — converting them would be a regression) and **recall 0/19** (the 19 hand-painted modal files carry no `role="dialog"`, which is what it keys on). It is also satisfied by a bare *import*. Its own `RuleTester` fixtures contain no `fixed inset-0`, so no fixture could ever have failed. Census rule `hand-painted-modal-backdrop` covers the real condition at **19 files / 20 matches, precision 20/20**; adoption is 129 `<BaseModal>` : 20 hand-painted = **86.6%**. See [`modal-stacking.md`](../docs/concepts/golden-paths/modal-stacking.md). |
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

> ✅ **The `CATALOG.md` `LoadingSpinner` warning that stood here is RESOLVED** —
> corrected 2026-08-13 in `ddeb19cc0`. Both the `CURATED` map
> (`scripts/docs/gen-shared-catalog.mjs:57`) and the generated row now read
> "RENDERS NOTHING. Spinners are disabled app-wide…". Verified 2026-08-17. The
> owed follow-up this block described no longer exists — the stale artifact was
> **this paragraph**, which outlived by four days the defect it named.

### Error Handling
- `toastCatch()` from `src/lib/silentCatch.ts` for user-facing errors (Sentry + toast)
- `silentCatch()` for background errors (Sentry + console only)
- `resolveError()` from `src/lib/errors/errorRegistry.ts` maps raw errors to friendly messages
- ESLint rule `custom/no-silent-catch` is **`"error"`** (`eslint.config.js:104`), not "warns" as this line said until 2026-08-14. A full run over 4,829 files returns **0 findings** — the condition is extinct, not unenforced. It is absent from the top lint rules because the gate worked.
- **But it only sees empty `catch {}`.** Measured 2026-08-14: of **2,752** production catch sites, **760 try/catch bodies reach no error door at all** (Sentry, toast, or log) across 440 files, and only **10.6%** produce a Sentry *event*. `.catch()` sits at **99.5%** adoption against try/catch's **58.6%** — a 41-point gap in the same repo for the same concept, and the sole difference is that a lint rule visits `.catch` while nothing visits a `CatchClause` body. See [`docs/concepts/golden-paths/swallowed-error-telemetry.md`](../docs/concepts/golden-paths/swallowed-error-telemetry.md).

### Rust backend conventions

Full doctrine: **[`.claude/rules/rust-backend.md`](./rules/rust-backend.md)** — loads automatically whenever `src-tauri/**` files are touched. The invariant: this backend's dominant defect is not missing abstractions but unadopted ones — reach for the existing primitive (`#[requires]`, `row_mapper!`, `QueryBuilder`, `SHARED_HTTP`, `ReactiveSubscription`, …) before writing anything new, and a NEW shared abstraction is only justified when it retires ≥3 hand-rolled copies in the same change. Machine-readable twin: `.claude/conventions.json` → `rustRules`.

### Concurrent CLI sessions (active-runs ledger)

Multiple CLI sessions (Claude Code agents, manual sessions, skill invocations) often work in parallel on this checkout, on the same branch, without branching for isolation. The coordination surface is **[`.claude/active-runs.md`](./active-runs.md)** — a single git-tracked ledger that any session materially editing the working tree should touch twice:

1. **At session start:** check for conflicts, then register.
   ```bash
   node scripts/active-runs.mjs check --paths "src/features/foo/**" "docs/bar/"   # exit 2 = live conflict
   node scripts/active-runs.mjs register --slug my-run --title "what I am doing" --paths "src/features/foo/**"
   ```
2. **At session end:** deregister with the outcome.
   ```bash
   node scripts/active-runs.mjs complete --slug my-run --status "completed (commit: abc1234)"
   ```

**Do not hand-edit the ledger for these three operations.** They are deterministic —
parsing, placement, timestamping, overlap comparison and staleness — and doing them by
hand is what produced the state the script was written against: the file had reached
3,429 lines with **two** `## Active` sections (against its own "the `## Active` section
is the source of truth"), **three** "Recently completed" sections against a documented
14-day window, **two mutually incompatible entry formats**, and **10** entries still
marked `started` that no session ever closed. Run `node scripts/active-runs.mjs doctor`
to see the current damage; it reports and never rewrites, because a coordination file
other sessions are reading is not something to repair behind their backs.

Judgment stays yours: the slug, the declared paths, and what to do about a real conflict.

Rationale and full design space in **[`docs/architecture/cli-coordination.md`](../docs/architecture/cli-coordination.md)**. Ledger format conventions (timestamps, path declaration granularity, edit-conflict retries) live at the top of `active-runs.md` itself.

First adopter is `/research`; cross-skill adoption is the next step. If you're authoring a new skill that materially edits files, add the Phase 0 register + Phase 11 deregister rituals to its spec.

#### Parallel-safety primitives (MANDATORY for every CLI session)

The active-runs ledger is intent coordination; these are the **never-lose-work** guarantees that protect the working tree even when intent coordination fails. On 2026-05-09 a parallel session ran `git stash` to clean its tree before commit and silently swept five files (one untracked) of an in-flight `/research` run; recovery worked but only because the tracked files were in the stash and the untracked file was reproducible from conversation context. Don't assume the next stash victim will be that lucky.

1. **Never `git stash` work that isn't yours.** Not even with `--keep-index`. Stash sweeps the entire working tree — including untracked files (with `-u`) and other sessions' in-flight edits — into a hidden state most agents won't think to look for. If your commit step needs a clean stage, use `git add <path>` per file (NOT `git add -A`/`git add .`/`git add -u`); leave everything else alone. The architect skill's "[Coexist with uncommitted work](./skills/architect/SKILL.md)" pattern is the canonical reference; mirror its discipline in any new skill.

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

5. **`git commit -- <pathspec>` does NOT reliably scope the commit when lefthook is installed.** Measured 2026-08-13 with four agents on one checkout: an agent used `git commit -- <paths>` precisely to avoid sweeping a sibling's work, and it swept three pre-staged files anyway (lefthook's partial-commit handling re-stages). `git commit --only <paths>` did hold. Two agents also lost a staged index entirely between `git add` and `git commit` — a sibling's activity cleared it, the commit silently became a no-op, and only `git reflog` showed the commit never happened. **`git commit --only` does not hold either.** Measured again later the same day: a sibling's commit landed between staging and committing, `--only` printed "no changes added to commit" and silently no-oped, and all 12 staged files were swept into the sibling's commit — whose own deliverable then did not make it in. ~~**There is no reliable pathspec-scoping incantation while another agent commits to the same worktree.**~~ **CORRECTED 2026-08-17 — that conclusion was too strong, and the mechanism named above is the wrong one.** Driven through a **throwaway `git init` repo with no hooks, no concurrency and no second agent**, both `git commit -- <paths>` and `git commit --only <paths>` *do* scope the file set correctly — and both commit the **WORKING TREE, not the index**. That is the real defect, and it needs no lefthook to bite: a sibling's *unstaged* edit to a file inside your pathspec rides in under your message. The 2026-08-13 incidents are still real; the diagnosis ("lefthook's partial-commit handling re-stages") was not what produced them.

  **A technique that passes all three tests does exist, and this repo already had it.** An isolated index — `IDX=$(mktemp); cp .git/index "$IDX"; GIT_INDEX_FILE="$IDX" git add <your paths>; GIT_INDEX_FILE="$IDX" git commit -m …` — scopes the file set, commits *staged content* rather than the worktree, and is untouched by a sibling `git add` into `.git/index`.

  > **Measured 2026-08-18: seed the isolated index with `git read-tree HEAD`, NOT `cp .git/index`.** The `cp` form has a self-inflicted footgun: after the ritual's own commit, the real `.git/index` is stale relative to the new HEAD, so the *second* isolated commit in the same session inherits that staleness and silently records your first commit's files as **deleted** — and reverts its modifications. It happened here twice in one commit: 4 new docs recorded as deleted AND a 181-line checker extension reverted, all invisible in the hook output (only a deletion check on the commit surfaced it — use `git show --stat --format= <sha> | grep 'delete mode'`, **not** `git show --stat | grep delete`, which also greps the commit MESSAGE and reports a false positive on any message containing the word; measured 2026-08-22, it fired on a commit with zero deletions). `GIT_INDEX_FILE="$IDX" git read-tree HEAD` keeps every property the ritual was adopted for (sibling `git add` still can't touch it) and is always anchored to the commit you are building on. Recover by amending with a read-tree-seeded index; after the last commit of a session, resync the shared index with a plain `git reset` (mixed) — but only after `git diff --cached --stat` confirms nothing a sibling staged would be swept out of it. It has held for **four consecutive runs across eight concurrent builders** in `/mvp`'s own calibration log (`.claude/skills/mvp/state/calibration.md:54`) and no `SKILL.md` mentions it, which is why nobody carried it across. Census rule `defeated-pathspec-commit` now flags the 11 places that still prescribe the defeated form — four of which claim it "bypasses the shared index entirely", and one of which calls it "safe by construction".

  **Untested gap, stated rather than papered over:** `GIT_INDEX_FILE` and lefthook have not been exercised *together* here. Full derivation, seven fault-injection cases and the remaining gaps are in [`docs/concepts/golden-paths/parallel-session-coordination.md`](../docs/concepts/golden-paths/parallel-session-coordination.md).

  > **Measured 2026-08-21: the isolated-index ritual is ONE shell invocation, or it is not the ritual.**
  A session followed the recipe correctly but split `git add` and `git commit` across two Bash tool
  calls. **Shell environment does not persist between tool calls**, so `GIT_INDEX_FILE` was unset by
  commit time and the commit silently used the shared `.git/index` — which still held a stale phantom
  deletion. The commit **reverted an entire completed task (7 files) and deleted a 342-line file**, with
  green hooks, a correct message, and a plausible-looking file list. Nothing in the hook output hinted
  at it; only `git show --name-status HEAD` compared against the intended file set caught it. Recovery
  was `git reset --mixed HEAD~1` (all content was still on disk). Keep `IDX=…`, `read-tree`, `add` and
  `commit` in a single invocation, and **assert `git diff --cached --name-status | grep -c '^D'` is 0**
  before committing unless you are deliberately deleting.

  > **Also 2026-08-21: resolve skill paths with `git ls-files` before staging.** 11 of the 36 skills are
  tracked as lowercase `skill.md`, 25 as `SKILL.md`. On Windows' case-insensitive filesystem an edit to
  the wrong casing lands on disk while `git add` silently no-ops, so the file stays dirty and the commit
  looks complete.

  Still true regardless of which technique you use: (a) verify `git log --oneline -1` is YOUR message after every commit — this is the only step that detects the failure at all; (b) recover by amending rather than resetting, since the content is present and only the attribution is wrong; and (c) for multi-file work, use a real `git worktree`, which is the only structural fix. A commit that didn't happen looks exactly like one that did if you only read the hook output. Note also that `git diff --cached --stat` is a **TOCTOU** check, not a guarantee — measured reading 1 file while the commit shipped 2.

6. **The scratchpad directory is shared between sibling agents.** Two agents wrote their commit message to the same generic filename (`msg1.txt`) and one overwrote the other between `Write` and `git commit -F`. Use a unique filename per agent, or pass the message inline.

7. **`git status` shows everyone's work — and so does the staged index.** Before any commit, scan `git status --porcelain` and classify each entry: yours / pre-existing drift / another session's in-flight work. Stage only yours. The 2026-05-09 stash victim was visible in `git status` to the stashing session — the missing discipline was "what's there that isn't mine?", not "what should I commit?"

   **AND THEN** — after `git add` but BEFORE `git commit` — run `git diff --cached --stat` and check the staged file count. If it is greater than the number of files you explicitly `git add`-ed, the index already had pre-staged files from another session sitting in it; your `git add` simply layered on top. Run `git restore --staged <path>` per unrelated file before committing. The recovery commit for the 2026-05-09 stash incident itself fell into this trap: the parallel-safety codification was supposed to be 6 files; the index already held 18 pre-staged files from a concurrent clear-wins/creative session and the commit swept everything up under a misleading message. Never trust the index; always verify it matches your intent.

---

## Internationalization (i18n)

Every user-facing string goes through `t.section.key` via `useTranslation()` — hardcoded English in JSX/placeholder/title/aria-label is a bug, and every key added to `en.json` must be translated into all 13 other locales in the same change (pre-commit `i18n-no-gaps` runs `check:i18n:strict` and blocks gaps). Full rules — pipeline, token maps, error registry, translation subagent workflow — live in **[`.claude/rules/i18n.md`](./rules/i18n.md)**, which loads automatically when `src/i18n/**` or `scripts/i18n/**` files are touched.

---

## Documentation Sync — three surfaces, honor-system

The product has three docs surfaces: **`docs/features/`** (implemented-product reference), **`src/features/onboarding/`** (guided-tour steps), and **`personas-web/src/data/guide/content/`** (marketing guides, sibling repo at `../personas-web/`).

**The rule:** when a turn edits feature/command source with **user-visible** effect (new tab/page/command, changed flow, removed feature, new event, schema migration that surfaces in UI, renamed table, new tier gate), update **every coupled surface in the same change** — including the cross-repo marketing guide if a `marketingModule` is mapped. Internal-only changes (refactor, bugfix without behavior shift, generated code, test-only) need no update.

**[`scripts/docs/feature-doc-map.json`](../scripts/docs/feature-doc-map.json) is the authoritative source → docs map.** Each entry declares `doc` (required), optional `onboardingFlows` (tour-flow IDs), optional `marketingModule` (`desktop-modules.ts` module ID). When you add a new feature area, add its entry in the same change.

> **This rule stands unenforced — honor-system.** A Stop hook (`scripts/docs/check-doc-sync.mjs`) was registered to nag per turn, but **measured 2026-08-17 it has NEVER fired: replayed over 100 real transcripts, 477 turns edited files, 2,367 file-edits, 0 visible to the hook — 0.00%** (its backward transcript walk terminates on tool results, which share the shape it breaks on; same bug at `check-golden-path-touch.mjs:85`). Every dismissal ever recorded was of a message it never sent. The fix is deliberately deferred — repairing it flips a silent hook into one that fires most turns, which changes the operator's workflow and is theirs to schedule: registered in [`golden-path-deferred-fixes.md`](../docs/concepts/golden-path-deferred-fixes.md), derivation in [`documentation-sync.md`](../docs/concepts/golden-paths/documentation-sync.md). Until then, doc sync happens because you do it, not because anything makes you.

If drift accumulates, run `/guide-sync` manually for a full catch-up pass (`.claude/guide-sync-marker.json` tracks the last full-pass commit). The desktop-module → guide-category map is `personas-web/src/data/guide/desktop-modules.ts` (`TOPIC_MODULE_MAP`). Both repos run their own `git` — keep commits atomic per repo, and never `git stash` other sessions' work in either checkout.

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

## AI registry (knowledge + skills)

This repo is wired to the organization's AI registry - ONE local checkout, at the path in
`.ai/manifest.yaml` under `registry.local` (default `../ai-registry`).

- **The knowledge is already loaded.** `.claude/rules/ai-registry-*.md` are links to the
  registry's generated rules: the access contract, plus a subject map for every domain in
  `.ai/manifest.yaml` `knowledge.domains`. Rules load in every session, so the corpus is in
  front of you without invoking anything. Before a design, architecture or product decision
  in a covered domain, open the governing subject - resolve it through
  `knowledge/<domain>/index.json` (`subjects["<slug>"].file`), never by building a path from
  a slug. Where this repo falls short of the standard, that is a deviation to record, not a
  reason to lower the standard. `/consult <topic>` does the same read deliberately and logs
  it so the registry can see which knowledge is actually reached for.
- **Shared skills are links, not copies.** Every name in `.ai/manifest.yaml` `skills:` is
  linked from `.claude/skills/<name>` into the registry's lane, so there is exactly one file
  on this machine: editing a shared skill from this repo edits the registry's file, and the
  change is live in every project immediately. Never copy a registry skill in - a real
  directory under `.claude/skills/` is a project-owned skill and must carry its own name.
- **After changing the manifest**, re-link with `node <registry>/scripts/link-registry.mjs`
  (`--check` verifies without writing). Project-specific configuration for a shared skill
  lives in its committed overlay, e.g. `.claude/perfect/config.md`.
