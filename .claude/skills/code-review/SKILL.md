---
name: code-review
description: Production-readiness code review for Rust backend and React frontend changes
allowed-tools: Read, Grep, Glob, Bash, Agent
---

# Code Review — Production Readiness

You are a senior code reviewer for the **personas-desktop** Tauri app (Rust + React/TypeScript). Your job is to review changed files and produce an actionable verdict with specific line references.

## Trigger

`/code-review` — reviews all unstaged/staged changes against master.
`/code-review <file-or-glob>` — reviews only matching files.
`/code-review --commit <ref>` — reviews files changed in a specific commit or range.

## Step 1: Identify Changed Files

Determine the review scope:

```bash
# Default: all working-tree changes vs HEAD
git diff --name-only HEAD

# If user gave a commit ref:
git diff --name-only <ref>^..<ref>
```

Separate files into two buckets:
- **Rust files**: `src-tauri/**/*.rs`
- **React files**: `src/**/*.{ts,tsx}`

If no changed files match, tell the user and stop.

## Step 2: Read Every Changed File

Read each file in full. You MUST read the actual file contents — never review from memory or diff snippets alone. For large files, read in sections.

Also read the diff to understand what specifically changed:
```bash
git diff HEAD -- <file>
```

## Step 3: Rust Backend Review

For every changed `.rs` file, evaluate against ALL of the following. Flag any violation with the file path, line number, and a one-line explanation.

### 3A. Security

- [ ] **No unwrap/expect on user input** — All external data (IPC args, DB reads, HTTP responses, file I/O) must use `?`, `.ok()`, `.unwrap_or()`, or explicit match. `unwrap()` / `expect()` are only acceptable on compile-time constants or infallible conversions.
- [ ] **SQL injection** — All queries use parameterized `?` placeholders via rusqlite. No string interpolation in SQL.
- [ ] **Path traversal** — Any path constructed from user input must be canonicalized and validated against a base directory. No raw `format!` into paths.
- [ ] **Secret handling** — Credentials, tokens, keys never logged, never in error messages, never serialized to frontend. Encryption uses AES-GCM with unique nonces. Keys derived via PBKDF2 with sufficient iterations.
- [ ] **Command injection** — No `std::process::Command` with unsanitized user input.
- [ ] **Auth checks** — Every `#[tauri::command]` that accesses user data calls `require_auth()` or `require_auth_sync()` before any logic.
- [ ] **Error leakage** — `AppError` serialization strips file paths and internal details. New error variants must follow the existing sanitization pattern in `error.rs`.

### 3B. Error Handling

- [ ] **Result propagation** — Functions return `Result<T, AppError>`. No silent error swallowing (empty `if let Err(_)` or `let _ = fallible()`). If intentional, require a `// deliberate: <reason>` comment.
- [ ] **Error context** — Errors include enough context to diagnose (which persona, which operation). Use `.map_err()` to add context when propagating.
- [ ] **Mutex poisoning** — `Mutex::lock()` results are handled, not unwrapped. Pattern: `.lock().map_err(|_| AppError::Internal("lock poisoned".into()))?`
- [ ] **Resource cleanup** — DB connections, file handles, temp files cleaned up on both success and error paths. Prefer RAII (Drop) over manual cleanup.

### 3C. Performance

- [ ] **No N+1 queries** — Batch DB reads instead of looping single reads. Prefer `SELECT ... WHERE id IN (...)` over N individual selects.
- [ ] **Mutex hold duration** — Lock is held only for the minimum critical section. No async `.await` while holding a sync `Mutex`. Use `tokio::sync::Mutex` if await is needed inside the lock.
- [ ] **Clone cost** — No unnecessary `.clone()` on large structs. Prefer references or `Arc` for shared data.
- [ ] **Unbounded collections** — Any `Vec::new()` populated from external input must have a capacity limit or pagination.

### 3D. Correctness & Best Practices

- [ ] **Type safety** — New structs exposed to frontend derive `TS, Serialize, Deserialize` with `#[ts(export)]` and `#[serde(rename_all = "camelCase")]`. Verify the ts-rs binding will match frontend expectations.
- [ ] **Idiomatic Rust** — Prefer `if let` over `match` with one arm + wildcard. Use `?` over explicit match-return-err. Avoid `return` at end of blocks.
- [ ] **Tracing** — New commands/operations include `#[tracing::instrument]` or manual `tracing::info!`/`error!` spans with structured fields.
- [ ] **Dead code** — No unused imports, functions, or struct fields. `#[allow(dead_code)]` requires justification.
- [ ] **Concurrency** — Shared state behind `Arc<tokio::sync::Mutex<T>>`. No `Rc` or `RefCell` in async contexts. Background tasks spawned with proper handle tracking.

## Step 4: React Frontend Review

For every changed `.ts`/`.tsx` file, evaluate against ALL of the following.

### 4A. Component Size & Modularity (HARD LIMIT: 200 lines)

- [ ] **Max 200 lines per component file** — Count total lines (including imports and types). If over 200, flag as MUST-FIX and suggest specific extraction points:
  - Extract sub-components for repeated JSX blocks
  - Extract custom hooks for stateful logic (>15 lines of hooks/effects)
  - Extract helper functions to a sibling `libs/` or `helpers.ts` file
  - Extract types/interfaces to a sibling `types.ts` file
- [ ] **Single responsibility** — Each component does one thing. A component that fetches, transforms, and renders should be split: container (fetch) + presenter (render).
- [ ] **Flat JSX** — Max 5 levels of nesting in returned JSX. Extract nested blocks into named components.

### 4B. Bug Prevention

- [ ] **Dependency arrays** — Every `useEffect`, `useMemo`, `useCallback` has correct deps. No missing deps that cause stale closures. No unnecessary deps that cause infinite loops.
- [ ] **Null safety** — Optional chaining (`?.`) on all potentially undefined chains. No bare property access on API responses or store state without null check.
- [ ] **Key props** — Every `.map()` rendering JSX uses a stable, unique `key` (not array index unless list is static and never reordered).
- [ ] **Event handler closures** — No inline `() => setState(...)` in `.map()` loops that create N closures per render. Use `useCallback` or extract handler with item ID.
- [ ] **Race conditions** — Async effects must handle component unmount (abort controller or stale flag). Store actions use sequence counters like the existing `fetchDetailSeq` pattern to discard stale responses.
- [ ] **Type safety** — No `any` type. No `as` casts that could fail at runtime. Prefer type guards or discriminated unions.

### 4C. Performance

- [ ] **Unnecessary re-renders** — Components receiving objects/arrays as props should use `useMemo` for computed values. Store selectors should select the minimum needed slice, not the entire store.
- [ ] **Expensive computations** — `useMemo` for any filtering, sorting, or transformation of lists > 20 items.
- [ ] **Bundle size** — No new large dependency imports without justification. Prefer tree-shakeable imports (`import { X } from 'lib'` not `import lib from 'lib'`).
- [ ] **Lazy loading** — New top-level tabs/pages use `React.lazy()` + `Suspense`.

### 4D. Code Quality

- [ ] **Import conventions** — Use `@/` path alias. Group: (1) react/external libs, (2) `@/api`, (3) `@/lib`, (4) `@/stores`, (5) `@/features`, (6) relative imports. No circular imports.
- [ ] **Naming** — Components: PascalCase. Hooks: `use<Name>`. Handlers: `handle<Event>` or `on<Event>`. Constants: UPPER_SNAKE_CASE. Files: PascalCase for components, camelCase for utilities.
- [ ] **API calls** — All Tauri IPC goes through `@/api/` wrappers using `invokeWithTimeout`. No direct `invoke()` calls in components.
- [ ] **Error handling** — API calls in store actions use try/catch with `errMsg()` helper. Components show error state, not silent failure.
- [ ] **No hardcoded strings** — UI text uses i18n (`useTranslation`). No raw English strings in JSX unless it's a code identifier or brand name.
- [ ] **Tailwind** — No inline `style={{}}` when Tailwind classes exist. No conflicting utility classes. Responsive breakpoints where layout requires it.

### 4E. Store Patterns (Zustand)

- [ ] **Slice boundary** — New state belongs in the correct slice. No cross-slice state duplication.
- [ ] **Immutable updates** — State updates via `set()` never mutate existing state. Always spread or create new objects/arrays.
- [ ] **Async actions** — Follow existing pattern: try/catch, `set({ loading: true })`, API call, `set({ data, loading: false })`, catch with `set({ error, loading: false })`.
- [ ] **Selector granularity** — Components use `usePersonaStore(s => s.specificField)` not `usePersonaStore()`.

## Step 5: Cross-Cutting Concerns

- [ ] **Rust ↔ TS type sync** — If a Rust struct changed, verify the corresponding `src/lib/bindings/<Type>.ts` matches (or will after ts-rs regeneration). Flag mismatches.
- [ ] **Command registration** — New `#[tauri::command]` functions are registered in `lib.rs` `invoke_handler`.
- [ ] **Migration safety** — New DB columns have defaults or are nullable to not break existing data. Destructive migrations (DROP, column removal) flagged as HIGH RISK.

## Step 6: Produce the Review

Output a structured review with this exact format:

```
## Code Review: <scope description>

### Verdict: APPROVE | APPROVE WITH NOTES | REQUEST CHANGES

### Critical (must fix before merge)
- `src-tauri/src/commands/foo.rs:42` — unwrap() on user-provided input; use `?` or `.ok_or(AppError::...)?`
- `src/features/agents/components/BigComponent.tsx` — 347 lines; extract <SubSection> (lines 180-260) and useFilterLogic hook (lines 45-95)

### Warnings (should fix)
- `src/stores/slices/agents/fooSlice.ts:78` — missing error state reset on retry
- `src-tauri/src/db/repos/core/bar.rs:15` — N+1: loop calls get_persona inside get_all_groups

### Nits (optional improvements)
- `src/features/agents/components/Foo.tsx:12` — unused import `useState`
- `src-tauri/src/engine/baz.rs:99` — `clone()` avoidable with reference

### Summary
- Files reviewed: N
- Issues: X critical, Y warnings, Z nits
- Lines added/removed: +A/-B
```

Rules:
- Every finding MUST include a file path and line number
- Every finding MUST include a concrete fix suggestion, not just "fix this"
- Group findings by severity, then by file
- If you find zero issues, say so explicitly — don't invent problems
- Do NOT suggest adding comments, docstrings, or type annotations to unchanged code
- Do NOT suggest refactors beyond the 200-line enforcement
- Be direct and specific, not vague
