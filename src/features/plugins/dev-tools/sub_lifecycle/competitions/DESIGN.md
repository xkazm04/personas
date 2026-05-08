# Competition `worktree.baseRef` — design contract

> Source: `/research` run 2026-05-08 against Claude Code CLI v2.1.133 changelog.
> Approach: B (per-competition control). Picked from three alternatives in
> Phase 7. See research note `Research/2026-05-08-claude-code-2-1-133.md`.

## Why this exists

Claude Code 2.1.133 added a `worktree.baseRef` setting (`fresh` | `head`) that
tells the CLI whether `--worktree`, `EnterWorktree`, and agent-isolation
worktrees should branch from `origin/<default>` (clean baseline) or from local
`HEAD` (current working tree). Personas spawns competition slots with
`--worktree <name>` (`task_executor.rs:670-681`) and currently inherits the
default `head` behavior.

For dev-tools competitions, the choice matters: branching from a clean origin
lets the user A/B test approaches against a known-good baseline; branching
from HEAD continues from in-progress local work. The choice belongs at the
competition level — it's the natural granularity for "this experiment".

## Goal

Add a per-competition `Branch from` segmented control to
`NewCompetitionModal`, with values:

- **Working tree** (default, value `head`) — current behavior
- **Clean origin** (value `fresh`) — fork all slots from `origin/<default>`

The choice is persisted on `dev_competitions` and applied at competition-start
time by writing a merged `<project_root>/.claude/settings.json`.

## Non-goals

- Auto-restore the user's previous `worktree.baseRef` after the competition
  ends. v1 leaves the value in place. Restoration adds stateful complexity for
  a feature that is itself idempotent.
- Per-slot variation. Claude Code reads one settings.json from the project
  root; all slots in a single competition share that value. Per-slot would
  require a different feature (per-slot worktree path overrides) which is
  separate.
- A project-default field on `dev_projects`. Approach A from Phase 7 was
  considered and dropped for v1 — clean to layer on later if the user wants a
  set-and-forget mode without re-renegotiating the design.
- Touching anything outside the competition flow. Production persona
  executions never use `--worktree`, so they are not affected.
- A new top-level UI for project settings. The choice surfaces only inside
  `NewCompetitionModal` for v1.

## Data model

### Schema (incremental migration)

```sql
ALTER TABLE dev_competitions ADD COLUMN worktree_base_ref TEXT;
```

- Nullable. NULL means "do not write `worktree.baseRef`" — settings.json is
  not touched, Claude Code uses its built-in default (currently `head`).
- Allowed non-null values: `'head'`, `'fresh'`. Validate at the
  `dev_tools_start_competition` boundary; reject everything else with an
  `AppError::Validation`.

Lives in `src-tauri/src/db/migrations/initial.rs` next to the existing
`winner_insight` / `baseline_json` ALTER lines (idempotent
`execute_batch` pattern). Schema mirror in
`src-tauri/src/db/migrations/schema.rs` line ~1290 (the `CREATE TABLE
dev_competitions` block) gets the column added so fresh installs and the
incremental ALTER agree.

### Rust model

`src-tauri/src/db/models/dev_tools.rs::DevCompetition` — append:

```rust
pub worktree_base_ref: Option<String>,
```

Re-derive `TS` (it's already on the struct — auto re-exports). Run
`cargo test export_bindings` (or hand-write the binding if a long-running
desktop instance locks the test build, per the 2026-05-02 lesson).

`src-tauri/src/db/repos/dev_tools.rs`:

- `row_to_competition` (line ~2748) — read the new column with the same
  `row.get::<_, Option<String>>(...).ok().flatten()` shape used by
  `winner_insight` and `baseline_json` so legacy rows that predate the
  migration are tolerated.
- `create_competition` signature gains `worktree_base_ref: Option<&str>` and
  the INSERT statement gains `worktree_base_ref` column + `?9` placeholder.

### Command shape

`src-tauri/src/commands/infrastructure/dev_tools.rs::dev_tools_start_competition`
gains a new arg `worktree_base_ref: Option<String>`. Validation at the top:

```rust
if let Some(ref v) = worktree_base_ref {
    if v != "head" && v != "fresh" {
        return Err(AppError::Validation(
            "worktree_base_ref must be 'head' or 'fresh'".into(),
        ));
    }
}
```

Plumb the value through to `repo::create_competition`.

## Settings.json merge

New helper module: `src-tauri/src/engine/worktree_settings.rs`. Tiny, focused.

```rust
/// Merge `worktree.baseRef` into <project_root>/.claude/settings.json,
/// preserving every other key the user has authored. No-op when value is
/// None. Best-effort: filesystem failures are logged + skipped, never
/// propagated, so a non-writable .claude/ does not abort the competition.
pub fn apply_worktree_base_ref(
    project_root: &Path,
    base_ref: &str,  // "head" | "fresh"
) -> Result<(), AppError> { ... }
```

Logic:

1. Read `<project_root>/.claude/settings.json` if it exists. Parse as
   `serde_json::Value`. If parse fails, log warn + bail (do NOT overwrite
   user's broken file).
2. If file does not exist, start with `serde_json::json!({})`.
3. Get-or-insert top-level `"worktree"` as an object. Set
   `obj["baseRef"] = base_ref`.
4. Create `.claude/` if needed. Write back via `to_string_pretty`.
5. Return `Ok(())`. Caller logs but doesn't fail on errors from `Err(...)`.

Called once from `dev_tools_start_competition` BEFORE the slot loop:

```rust
if let Some(ref base_ref) = worktree_base_ref {
    if let Err(e) = engine::worktree_settings::apply_worktree_base_ref(
        Path::new(&project.root_path), base_ref,
    ) {
        tracing::warn!(error = %e, "worktree_settings: skipping merge");
        // Non-fatal: competition still proceeds with whatever settings.json
        // already says (or the CLI's built-in default).
    }
}
```

### Tests

In `worktree_settings.rs::tests`:

- `applies_to_empty_dir` — no existing `.claude/`. After call, file exists
  with `{"worktree":{"baseRef":"fresh"}}`.
- `preserves_user_keys` — pre-existing settings.json with
  `{"hooks":{...},"theme":"dark"}` keeps both keys after merge.
- `overwrites_existing_baseRef` — pre-existing
  `{"worktree":{"baseRef":"head"}}` becomes `{"worktree":{"baseRef":"fresh"}}`.
- `tolerates_malformed_json` — pre-existing settings.json with garbage
  content returns Err; original file is untouched.
- `idempotent_repeated_calls` — same value applied twice produces identical
  file content.

### Backward compatibility

- Claude CLI < 2.1.133 silently ignores unknown settings, so writing
  `worktree.baseRef` is forward-compatible.
- Rows in `dev_competitions` with NULL `worktree_base_ref` = legacy
  competitions and competitions where the user kept the default. Both
  resolve to "do not write" (current behavior).
- The existing `hooks_sidecar.rs` writes a SEPARATE `.claude/settings.json`
  scoped to `exec_dir` (per-spawn, env-gated). It does NOT collide with this
  feature, which writes to the project-root `.claude/settings.json` for
  worktree creation (Claude CLI reads the project-root one for `--worktree`
  base resolution, distinct from the per-spawn exec_dir one).

## API surface

`src/api/devTools/devTools.ts::startCompetition` gains a final
`worktreeBaseRef: 'head' | 'fresh' | null` parameter (default `null`).
Forwarded as `worktreeBaseRef` to the Tauri command.

## TS bindings

- `src/lib/bindings/DevCompetition.ts` — auto-regenerated. Adds
  `worktree_base_ref: string | null`.
- No changes to `CompetitionSlotInput.ts` (per-competition, not per-slot).

If the running app blocks `cargo test export_bindings`, hand-write the
`DevCompetition.ts` shape and let the next clean test run idempotently
overwrite it (per the 2026-05-02 lesson).

## UI shape

`NewCompetitionModal.tsx` gains a small segmented control between the
slot-count picker and the strategy list. Exact placement (left of the
existing slot-count buttons keeps the modal's vertical rhythm):

```
┌─────────────────────────────────────────────────────────┐
│ Title:        [____________________________________]    │
│ Description:  [____________________________________]    │
│                                                         │
│ COMPETITORS:    BRANCH FROM:                            │
│ [2] [3] [4]     [Working tree*] [Clean origin]    [↻]   │
│                                                         │
│ ┌── Alpha ──────────────────────────────────────┐       │
│ │ [genes...]                                    │       │
│ └───────────────────────────────────────────────┘       │
│ ...                                                     │
└─────────────────────────────────────────────────────────┘
```

- Default selected: `Working tree` (`head`).
- A Tooltip on the row label explains "Pick where each competitor's worktree
  branches from. Working tree continues your in-progress changes; Clean
  origin forks from origin/<default> for a clean baseline."
- The visual treatment matches the existing slot-count buttons (same shape,
  active = `bg-violet-500/15 text-violet-400 border-violet-500/25`, inactive
  = `text-foreground hover:bg-secondary/40`).
- Works alongside the existing "↻ regenerate strategies" button — they share
  the right-hand area. Group order: `[2][3][4]` ⋯ `[Working tree][Clean origin]` ⋯ `↻`.

State:

```ts
const [baseRef, setBaseRef] = useState<'head' | 'fresh'>('head');
```

Wired into `handleCreate`:

```ts
const result = await startCompetition(
  projectId, title.trim(), description.trim() || null, null, null, slots,
  baseRef === 'head' ? null : baseRef,  // null when default to keep DB sparse
);
```

The `null when default` rule keeps `worktree_base_ref` NULL on rows where
the user didn't deviate from the default — preserves the
"current-Claude-Code-default" semantics if Anthropic ever flips the
implicit default in a future CLI version.

## i18n

Source of truth: `src/i18n/locales/en.json`. After editing en.json, run
`node scripts/i18n/gen-types.mjs` to regenerate `src/i18n/generated/types.ts`.
Add identical keys to all 13 other `locales/*.json` files with English
placeholder values + a top-of-file `TODO(i18n-{lang})` marker (per the
14-locale parity contract). Translation is a downstream task.

New keys under `plugins.dev_lifecycle`:

| Key | Value |
|---|---|
| `worktree_base_ref_label` | `"Branch from"` |
| `worktree_base_ref_head` | `"Working tree"` |
| `worktree_base_ref_fresh` | `"Clean origin"` |
| `worktree_base_ref_help` | `"Pick where each competitor's worktree branches from. Working tree continues your in-progress changes; Clean origin forks from the default branch on origin for a clean baseline."` |

Voice: leads with user benefit ("clean baseline" not
"`origin/<default>` HEAD"); no file paths; no jargon. Honors CLAUDE.md →
"UI Conventions → Internationalization → Voice for user-facing copy".

## Cross-cutting concerns

- **CLAUDE.md UI Conventions**: typography contrast (use `text-foreground`,
  not `text-white/N` — modal already follows this), semantic tokens
  (`rounded-interactive`, `typo-caption`, etc.), `BaseModal` (already used).
- **i18n contract**: all new strings through `useTranslation()`. NO
  hardcoded English in JSX. No tokenLabel needed (not a backend status
  token). No error_registry update needed (validation error is a code-only
  string visible only to dev tools).
- **Phase 13 commit**: explicit-stage all changed files; `research:` prefix.
- **Validation order**: cargo check (`src-tauri/`), tsc (`npx tsc --noEmit`),
  eslint (`npm run lint`), locale parity (`node scripts/i18n/check-coverage.mjs`
  if it exists; otherwise rely on tsc + the gen-types step).

## Acceptance criteria

1. New `dev_competitions.worktree_base_ref` column exists on fresh + migrated
   schemas. Idempotent ALTER tolerates re-applies.
2. `dev_tools_start_competition` accepts `worktreeBaseRef: 'head'|'fresh'|null`,
   validates, persists.
3. When `worktree_base_ref = 'fresh'`, `<project_root>/.claude/settings.json`
   contains `{"worktree":{"baseRef":"fresh"}}` after the call. Other keys
   preserved.
4. When `worktree_base_ref = NULL`, `.claude/settings.json` is unchanged
   (file may not exist).
5. `NewCompetitionModal` exposes the segmented control. Defaults to
   `Working tree`. Choice round-trips through API → DB → settings.json.
6. All 14 locale files have the 4 new keys (English placeholders OK).
7. cargo check passes (no new warnings on touched files), tsc passes, lint
   passes (no new violations on touched files).

## Rollout shape

This ships as a single atomic commit (Phase 13). Per the 2026-04-17 default,
no handoff is written; the implementation is in-session. Single commit
because the change is internally cohesive — schema + repo + command + helper
+ binding + API + UI + i18n is one feature, splitting it loses atomicity
for no reviewability gain.
