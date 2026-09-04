---
product: "Personas"
stack: "Tauri 2 desktop app - React + TypeScript + Tailwind frontend, Rust backend (src-tauri), SQLite, ts-rs bindings, 14 locales"
vault: ["C:/Users/kazda/Documents/Obsidian/personas", "C:/Users/mkdol/Documents/Obsidian/personas"]
vault_subdir: Friend
base_branch: master
worktree_dir: .claude/worktrees
active_runs_ledger: .claude/active-runs.md
context_taxonomy: .claude/codebase-context.md
context_outbox: .personas/memory-outbox.jsonl
verify_url: "http://127.0.0.1:17320"
locale_count: 14
commit_types: "feat, feat(ux), feat(ui), polish"
---

# /friend overlay - Personas

Everything in this file is what `/friend` may NOT carry in its shared body. The
skill runs without it; with it, the loop knows this repo.

## Areas

Eight rows, matching the 8 groups in `.claude/codebase-context.md` - the same
mapping `/explorer` and `/architect` use. Free-text hints (Q1 option 1) resolve
through the `/explorer` resolver: hint -> context -> primary paths.

| Area | Primary paths | Entry points |
| --- | --- | --- |
| agents | `src/features/agents/` `src-tauri/src/commands/core/personas.rs` | agent list, agent chat panel |
| vault | `src/features/vault/` `src-tauri/src/commands/credentials/` | credential list, keyring settings |
| orchestration | `src/features/teams/` `src/features/schedules/` `src-tauri/src/engine/` | team board, schedule editor |
| triggers | `src/features/triggers/` `src-tauri/src/commands/communication/` `src-tauri/src/engine/event_registry.rs` | trigger list, event registry |
| execution | `src/features/agents/sub_executions/` `src-tauri/src/commands/execution/` `src-tauri/src/engine/runner.rs` | execution panel, run detail |
| templates | `src/features/templates/` `src-tauri/src/commands/design/` `src-tauri/src/engine/build_session/` | template gallery, build session |
| deployment | `src/features/deployment/` `src/features/share/` | deploy panel, share dialog |
| platform | `src/features/settings/` `src/features/overview/` `src-tauri/src/commands/admin/` | settings, overview dashboard |

## Gates

builder: (before every commit, scoped to what the cycle touched)
- `npx tsc --noEmit` - when any `.ts` / `.tsx` changed.
- `npm run lint` - always. Silenced output; fail only on NEW errors above the
  baseline. Warnings from the `custom/no-raw-*-classes` and
  `custom/no-hardcoded-jsx-text` migrations are acceptable on pre-existing lines
  and never acceptable on the lines this cycle wrote.
- `cargo check --manifest-path src-tauri/Cargo.toml` - when any `.rs` under
  `src-tauri/` changed.
- `npm run check:i18n:strict` - when any key was added to `src/i18n/locales/en.json`.
- `npm run test -- <path>` - only when the direction added or changed test files.

integration: (before the exit summary)
- Nothing beyond the builder gates; `/friend` leaves the branch for the user to
  merge and the repo's pre-commit hooks are the real integration gate
  (`i18n-no-gaps` blocks a commit with a locale gap; a Stop hook catches an
  un-updated feature doc).

## Repo law

The authoritative file is `.claude/CLAUDE.md`; `.claude/codebase-stack.md` carries
the architecture and engine internals. The digest that binds a `/friend` cycle:

- **Reuse before building** - the #1 UI-drift source. Before writing any UI, read
  `src/features/shared/components/CATALOG.md` (~115 components) and import the
  existing primitive: `feedback/LoadingSpinner`, `feedback/EmptyState`,
  `buttons/Button` + `buttons/AsyncButton`, `buttons/CopyButton`,
  `display/Tooltip`, `display/RelativeTime`, `display/Numeric`,
  `forms/AccessibleToggle` / `forms/Listbox` / `forms/FormField`. `BaseModal` for
  any backdrop, enforced by the `custom/enforce-base-modal` lint rule. A genuinely
  new reusable pattern goes in `src/features/shared/components/` with a `@catalog`
  tag, never in a feature folder.
- **Strings / i18n (pre-commit ENFORCED)** - every user-visible string goes to
  `src/i18n/locales/en.json` under the right section and is read via
  `useTranslation()` / `t.section.key`. Never hardcode JSX text, placeholder,
  title or aria-label. A cycle that adds English keys MUST fill all 13
  non-English locales in the SAME commit - the `i18n-no-gaps` pre-commit hook
  blocks it otherwise.
- **Design tokens** - `typo-*` for text, `rounded-{interactive,input,card,modal}`,
  `shadow-elevation-1..4`, and `bg-secondary/*` / `text-foreground/*` in place of
  `bg-white/*` / `text-white/*` (CLAUDE.md Styling section).
- **IPC** - always `invokeWithTimeout` from `@/lib/tauriInvoke`, never raw `invoke`.
- **Errors** - `toastCatch()` for user-facing, `silentCatch()` for background.
  No empty `catch {}`. A new `AppError` variant needs both the enum addition and
  the `Serialize` match arm.
- **Status tokens** - Rust ships machine tokens (e.g. `"queued"`); display them
  through `tokenLabel(t, 'execution', row.status)`, never string-cased in the view.
- **Migrations** - additive only on a `/friend` cycle; anything destructive trips
  the Phase 3 risk gate.
- **Parallel safety** - never `git stash` (S1); never carry >30 minutes of
  uncommitted work (S3); stage per file with `git add <path>`, never `git add -A`
  / `.` / `-u`, and re-verify `git diff --cached --stat` before EVERY commit in a
  slice, because a parallel session may pre-stage files between them (S5).

## Codegen

| Trigger | Command | Enforced by |
| --- | --- | --- |
| a `#[derive(TS)] #[ts(export)]` struct is added or changed | `cargo test --manifest-path src-tauri/Cargo.toml export_bindings` - commit the result in `src/lib/bindings/`, the single source of truth (the old `src-tauri/bindings/` dual tree is retired and gitignored) | review |
| a new Tauri command is registered | `node scripts/generate-command-names.mjs` (any `npm run dev` / `npm run build` also triggers it) | build |
| a new shared component with a `@catalog` tag | `npm run gen:catalog` | review |
| English locale keys added | `node scripts/i18n/translate-extract.mjs` -> one Sonnet subagent per locale fills `.i18n-work/missing-<code>.json` (preserve `{placeholders}`, keep brand/technical terms) -> `node scripts/i18n/translate-merge.mjs`. For a <=5-key polish cycle, inline edits per locale file are fine. | `i18n-no-gaps` pre-commit hook |

## Docs

`scripts/docs/feature-doc-map.json` maps source areas to `docs/features/<area>/README.md`.
A user-visible direction touching a mapped area updates the matching README in the
SAME commit. Enforced by the Stop hook.

## Verified mode

- Boot once per session, from inside the worktree: `npm run tauri:dev:test` -
  an HTTP automation server on port 17320 with Vite HMR for frontend cycles.
- Probe `http://127.0.0.1:17320` for readiness before the first verification.
  If the port is already held, that instance does NOT have this worktree's code:
  offer (a) read-only reuse for verification only, (b) a different port via the
  `dev:test` env overrides, or (c) a downgrade to checklist-only.
- Frontend-only cycles arrive live via HMR - no restart. Rust-touching cycles
  need the instance rebuilt; budget for it or batch the Rust changes in a slice.
- Driver: `clickTestId` (the `__test_respond` path). **Never the `/eval` queue** -
  it silently drops scripts mid-session (`feedback_tauri_eval_queue_drops`). Add
  the `data-testid`s you will assert on while writing the UI in Phase 4.

## Context sources

- The name source for `context_outbox` is the **product-level context names in
  `.claude/codebase-context.md`** - 49 names under 8 groups, the taxonomy the
  project map describes. The ingest matches case-insensitively; an unknown name
  is not an error, it is stored with a null context and never counts.
- **Do NOT use repo-root `context-map.json`.** It is a stale (2026-07-10) Vibeman
  auto-map with 236 mechanical names like `tauri:engine [3/10]` and
  `plugins/dev-tools [2/3]`, none of which the app knows.
- The app ingests and deletes `.personas/memory-outbox.jsonl` when the session ends.

## Direction taste

- Outcome-value over cosmetic churn: a user can do or see something they could
  not before. Dark-mode remount tweaks and restyling that changes nothing
  behavioral are rejected shapes.
- Prefer deepening an existing surface over a net-new surface: at most 1 of the 5
  proposals may be a new tab / rail / page-level panel.
- Prefer the shape of an existing strong pattern (`$VAULT/Architect/strong-patterns.md`)
  and name it in the direction body.

## Skill improvement log

_(created on first wrap)_
