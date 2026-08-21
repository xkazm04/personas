---
name: code-review
description: Production-readiness code review for Rust backend and React frontend changes
argument-hint: "[file-or-glob]"
allowed-tools: Read, Grep, Glob, Bash, Agent
---

# Code Review — Production Readiness

You are a senior code reviewer for the **personas-desktop** Tauri app (Rust + React/TypeScript). Review changed files and produce a severity-ranked, verified verdict with `file:line` references.

## Trigger

`/code-review` — reviews all unstaged/staged changes against HEAD.
`/code-review <file-or-glob>` — reviews only matching files.
`/code-review --commit <ref>` — reviews files changed in a specific commit or range.

---

## Coordination — Active-Runs Ledger

`/code-review` is **mostly read-only**. If the run is purely read-only with a chat-rendered verdict, ledger registration is optional. Register in [`.claude/active-runs.md`](../../active-runs.md) before writing any report file or applying any fix; check `## Active` first and surface conflicts on overlapping `started` entries <2h old (the other session may be editing the very files you're grading). At session end, move your entry to `## Recently completed` with `completed (commit: <sha>)` / `completed (review-only, no commit)` / `aborted (<reason>)`. Full rationale: [`docs/architecture/cli-coordination.md`](../../../docs/architecture/cli-coordination.md).

**If applying fixes**, the parallel-safety primitives from [`CLAUDE.md`](../../CLAUDE.md) are mandatory:

1. **Never `git stash`** other sessions' work. Stage per file (`git add <path>`, never `-A`/`.`/`-u`).
2. **Multi-file fixes go in a worktree**: `git worktree add .claude/worktrees/code-review-fix-<slug> -b worktree-code-review-fix-<slug>`. Single-file fixes may stay on the main checkout.
3. **Atomic commits**: one commit per Critical/Warning fix; bundle nits into one polish commit. Never mix a critical fix with polish.
4. **Verify the staged index**: after `git add`, `git diff --cached --stat` — if the staged count exceeds what you added, `git restore --staged <path>` the foreign files (or commit through an isolated index (`GIT_INDEX_FILE` seeded with `git read-tree HEAD` — `.claude/CLAUDE.md` parallel-safety primitive #5). Do **not** scope the commit with a pathspec instead — neither the `--only` form nor the bare double-dash form: both commit the WORKING TREE rather than the index, so a sibling's *unstaged* edit to a file inside your pathspec rides in under your message.)
5. **Remove the worktree + branch** once fixes are merged to master.

---

## Step 0: Scope Depth to Diff Size

Run `git diff --stat HEAD` (or the commit range) first and pick a depth. Do not run a full-depth review on a 5-line diff.

| Diff size | Depth |
|---|---|
| ≤ ~50 changed lines, no high-risk zone | **Quick**: read the diff + surrounding context of each hunk; check gate triggers (Step 5) and the bug/security items only. Skip the full checklists; output findings without the scorecard table. |
| ≤ ~500 lines or any high-risk zone touched | **Standard**: full workflow below. |
| > ~500 lines / >15 files | **Deep**: full workflow; consider parallel Agent subagents per bucket (Rust / React / stores), then merge and verify findings yourself. |

**High-risk zones — always Standard+ and reviewed first, most scrutiny:**

1. **Crypto / vault / credentials** — `src-tauri/src/engine/*crypto*`, `src-tauri/src/commands/credentials/**`, `src/features/vault/**`. Nonce reuse, key derivation, secrets in logs/errors/frontend payloads.
2. **IPC command surface** — `src-tauri/src/commands/**`. Missing `require_auth()`/`require_auth_sync()`, unvalidated args, error leakage.
3. **DB migrations** — `src-tauri/src/db/**` migration code. Incremental `ALTER`s need a has-table/has-column guard (see memory: the test binary drops tables); destructive changes (DROP, column removal) are HIGH RISK; new columns must be nullable or defaulted.
4. **Zustand slices with derived state** — `src/stores/slices/**`. Derived values recomputed vs cached-and-stale; cross-slice duplication; stale-response races (sequence-counter pattern like `fetchDetailSeq`).
5. **i18n key changes** — `src/i18n/locales/*.json`. Renames leave EXTRAS (gate fails); new `en.json` keys untranslated in the other 13 locales block commit.
6. **shared/components boundary** — `src/features/shared/components/**` must stay primitives-only: no imports from `@/stores`, `@/api`, `@/lib/bindings`, or `@/features/<feature>`.

## Step 1: Identify Changed Files

```bash
git diff --name-only HEAD           # default: working tree vs HEAD
git diff --name-only <ref>^..<ref>  # commit mode
```

Bucket into **Rust** (`src-tauri/**/*.rs`), **React/TS** (`src/**/*.{ts,tsx}`), **locales** (`src/i18n/locales/*.json`), **config/other**. If nothing matches the requested scope, say so and stop.

## Step 2: Read Every Changed File

Read the diff (`git diff HEAD -- <file>`) AND the actual file contents around each hunk — never review from the diff alone; the bug is often in the unchanged line the diff now interacts with. High-risk-zone files first. For large files, read the touched regions plus their enclosing function/component in full.

## Step 3: Rust Backend Review

Flag violations with `file:line` + one-line explanation.

### 3A. Security
- **No unwrap/expect on external data** (IPC args, DB reads, HTTP, file I/O) — use `?`, `.ok_or()`, `.unwrap_or()`. `unwrap()` acceptable only on compile-time constants/infallible conversions.
- **SQL** — parameterized `?` placeholders only; no string interpolation into SQL.
- **Path traversal** — user-derived paths canonicalized + validated against a base dir.
- **Secrets** — never logged, never in error messages, never serialized to frontend. AES-GCM with unique nonces; PBKDF2 with sufficient iterations.
- **Command injection** — no `std::process::Command` with unsanitized input.
- **Auth** — every `#[tauri::command]` touching user data calls `require_auth()` / `require_auth_sync()` (see `src-tauri/src/ipc_auth.rs`) before any logic.
- **Error leakage** — new `AppError` variants follow the existing sanitization pattern (no internal paths/details to frontend).

### 3B. Error Handling & Correctness
- `Result<T, AppError>` propagation; no silent swallowing (`let _ = fallible()`, empty `if let Err(_)`) without a `// deliberate: <reason>` comment.
- `.map_err()` adds context (which persona, which operation) when propagating.
- `Mutex::lock()` handled, not unwrapped; no `.await` while holding a sync `Mutex` (use `tokio::sync::Mutex` if needed).
- Resource cleanup on both success and error paths; prefer RAII.
- Shared state: `Arc<tokio::sync::Mutex<T>>`; no `Rc`/`RefCell` in async.
- Structured `tracing` on new commands/operations.

### 3C. Performance
- No N+1 DB loops — batch with `WHERE id IN (...)`.
- Minimal mutex critical sections; no unnecessary `.clone()` on large structs (prefer refs/`Arc`); collections fed from external input bounded or paginated.

## Step 4: React Frontend Review

### 4A. Size & Modularity (HARD LIMIT: 200 lines)
- **Max 200 lines per component file.** Over → MUST-FIX with concrete extraction points (sub-components, custom hooks for >15 lines of stateful logic, sibling `types.ts`/helpers).
- Single responsibility; max ~5 levels of JSX nesting.

### 4B. Bug Prevention
- Correct `useEffect`/`useMemo`/`useCallback` deps — no stale closures, no infinite loops.
- Null safety on API responses / store state; stable unique `key` in `.map()` (not index for reorderable lists).
- Async effects handle unmount (abort/stale flag); store actions use sequence counters (`fetchDetailSeq` pattern) against stale responses.
- No `any`, no runtime-unsafe `as` casts.

### 4C. Repo Conventions (these are enforced or catalogued — cite the rule)
- **IPC**: all Tauri calls via `@/api/` wrappers using `invokeWithTimeout` from `@/lib/tauriInvoke` — never raw `invoke` (`no-restricted-imports` enforces).
- **Errors**: user-facing → `toastCatch()` from `src/lib/silentCatch.ts`; background → `silentCatch()`; friendly messages via `resolveError()` / `resolveErrorTranslated()`. Empty `catch {}` blocks flagged (`custom/no-silent-catch`). Store actions: try/catch with `errMsg()` and loading/error state.
- **i18n**: no hardcoded English in JSX/placeholder/title/aria-label — `t.section.key` via `useTranslation()` (`custom/no-hardcoded-jsx-text`). Backend status tokens rendered via `tokenLabel()`, never raw. Label constants use `labelKey`, not inline strings.
- **Design tokens**: `typo-*`, `rounded-{interactive,input,card,modal}`, `shadow-elevation-*`; never `text-white/*` / `bg-white/*` (use `text-foreground/*` / `bg-secondary/*`). No inline `style={{}}` where a token class exists.
- **Shared components**: hand-rolled spinner/empty-state/modal/tooltip/toggle/etc. that duplicates a catalog primitive (`src/features/shared/components/CATALOG.md`) is a finding — name the primitive to import. Modals must use `BaseModal`/`ConfirmDialog` (`custom/enforce-base-modal`).
- **Stores**: correct slice boundary, immutable `set()` updates, narrow selectors (`useShallow` / `s => s.field`, never whole-store subscribe).
- Lazy-load new top-level tabs/pages (`React.lazy` + `Suspense`); no heavyweight deps without justification.

## Step 5: Gate-Trigger Check (the repo's REAL gates)

Don't re-derive lint advice — determine **which CI/hook gates this diff will trip** and verify the diff satisfies them. For each triggered gate, either confirm it's handled or file a finding naming the exact command that will fail:

| Diff contains… | Gate it trips | What to verify |
|---|---|---|
| Any `.ts`/`.tsx` | `npm run check` (tsc + ESLint incl. 18 custom rules) | New code introduces no TS errors (master is clean — errors are regressions) and no new custom-rule violations |
| `src/i18n/locales/en.json` keys added/renamed | `npm run check:i18n:strict` + `i18n-no-gaps` pre-commit hook | All 13 other locales updated in the same change; renames leave no EXTRAS (extras always fail) |
| `error_registry` keys or `ERROR_KEY_MAP` edits | `npm run check:error-registry` | `<key>_message`/`<key>_suggestion` parity with `src/i18n/useTranslatedError.ts` |
| Theme/token CSS changes | `npm run check:themes` | Both structural families still pass |
| `src-tauri/tauri*.conf.json` | `npm run check:tauri-configs` | Config variants stay consistent |
| Rust struct with `#[derive(TS)]` added/changed | CI binding-drift job (`git diff --quiet src/lib/bindings/`) | `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` was run and `src/lib/bindings/` changes are in the diff; `#[serde(rename_all = "camelCase")]` present; frontend usages match |
| New `#[tauri::command]` | codegen + registration | Registered in `invoke_handler`; `node scripts/generate-command-names.mjs` output regenerated |
| Any `.rs` | clippy `-D warnings` + `cargo test` | No obvious clippy-fatal patterns introduced |
| Logic changes with existing test coverage | `npm run test -- --run` / `cargo test` | Tests updated alongside behavior; flag changed behavior with untouched tests |

Also flag: security-sensitive edits (crypto/vault/connectors/IPC) that should be called out for human review, and user-visible changes missing a `CHANGELOG.md` `[Unreleased]` entry.

## Step 6: Adversarial Verification (before reporting)

Every candidate finding must survive this pass — **unverified findings are dropped or downgraded, never reported as fact**:

1. **Re-read the exact lines.** Open the file at the cited location and confirm the code says what the finding claims. Line numbers must be from the actual file, not estimated from the diff.
2. **Construct the failure scenario.** State concretely how it breaks: what input, what sequence, what state. "unwrap() on line 42 panics when the frontend sends a null credentialId" — not "might panic". If you cannot construct a plausible path to the failure (e.g. the value is validated two calls up — go check), drop the finding.
3. **Check for existing mitigation.** Grep for guards, callers, and tests that already handle the case before claiming it's unhandled.
4. **Residual uncertainty → mark `PLAUSIBLE`.** If the failure depends on runtime state you can't confirm from code, keep the finding but tag it `[PLAUSIBLE]` with what would confirm it. Never present a PLAUSIBLE as Critical.
5. **No invented problems.** Zero findings on an axis is a PASS. Don't pad. Don't suggest comments/docstrings/annotations on unchanged code, or refactors beyond the 200-line rule.

## Step 7: Produce the Review

Severity-ranked, most severe first. Every finding: `file:line`, axis tag, concrete fix (not "fix this"), and `[PLAUSIBLE]` where applicable.

```
## Code Review: <scope description>

### Verdict: APPROVE | APPROVE WITH NOTES | REQUEST CHANGES

### 5-Axis Scorecard        (omit for Quick-depth reviews)
| Axis            | Verdict | Findings |
|-----------------|---------|----------|
| 1. Correctness  | PASS    | 0        |
| 2. Security     | FAIL    | 1        |
| 3. Architecture | PASS    | 0        |
| 4. Performance  | FLAG    | 1        |
| 5. Readability  | FLAG    | 2        |

### Critical (must fix before merge)
- [Security] `src-tauri/src/commands/foo.rs:42` — unwrap() on user-provided credentialId; panics when frontend sends null. Fix: `.ok_or(AppError::InvalidInput("credentialId".into()))?`

### Gate failures (will block CI/commit)
- [Gate:i18n] `src/i18n/locales/en.json` — 3 new keys under `vault.*` untranslated in 13 locales; `i18n-no-gaps` pre-commit will block. Run the translate-extract/merge pipeline.

### Warnings (should fix)
- [Performance] `src-tauri/src/db/repos/core/bar.rs:15` — N+1: loop calls get_persona per group; batch with `WHERE id IN`
- [PLAUSIBLE][Correctness] `src/stores/slices/fooSlice.ts:78` — retry path may keep stale `error`; confirm whether retry clears it before the second fetch

### Nits (optional)
- [Readability] `src/features/agents/components/Foo.tsx:12` — unused import `useState`

### Summary
- Files reviewed: N (depth: Quick|Standard|Deep) · Issues: X critical, Y gate, Z warnings, W nits
- High-risk zones touched: <list or none> · Worst axis: <axis>
```
