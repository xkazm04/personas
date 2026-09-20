---
product: "Personas Desktop"
vault: ["C:/Users/kazda/Documents/Obsidian/council", "C:/Users/mkdol/Documents/Obsidian/council"]
vault_subdir: Council
runs_dir: .personas/council/runs
state_file: .personas/council/state.json
decisions_dir: ""
web_lookups: 3
market_brief_days: 30
---

# Council overlay - Personas Desktop

The method is repo-agnostic and lives in the registry (`/council`). Everything below is
what THIS repository is. Every key has a default; the loop runs without this file.

**Vault.** Neither candidate above is guaranteed to exist on a given machine. When neither
does, the method falls back to `<repo>/.council/` with the same schema - keep that path out
of commits. Obsidian never sees an agent's write, so re-read a note immediately before
patching it and suffix a colliding name rather than overwriting it.

## Gates

The commands the evidence pack runs over a span. Verbatim, in this order:

- always: `npm run gate` (warm tsc + eslint on changed files + census, answered for this
  worktree as a delta against master; it falls back to the cold commands by itself and
  says so) and `npm run test -- --run`
- when strings or locales are in the span: `npm run check:i18n:strict`
- when Rust is in the span: `npm run test:rust -- <filter>`. **Never a bare `cargo test`**
  on this machine - the lib test binary dies at load without the post-link manifest patch -
  and never two cargo invocations at once.
- pre-push equivalent, only when the span is large enough to warrant it: `npm run check`
  (seventeen gates; the census is the one most likely to fail a diff that compiles)

**Gate calibration, and it matters for the robustness member.** Gate on *no NEW warnings in
the files the span touches*. A full-crate clippy at `-D warnings` and a whole-tree eslint
both report hundreds of pre-existing findings here; comparing against master's figure for
the same files is the measurement, and the absolute count is not. A **census RISE** inside
the span is a real robustness finding; a census baseline is never re-baselined to clear one.

## Span

A subject slug is a `dev_use_cases.slug` in this product's own feature inventory. Its span
is the union of the paths of the contexts the feature slices, read from `context-map.json`
at the repo root (208 contexts, 16 groups).

**Known trap, and it is live today.** The 12 Personas features currently have ZERO context
links - a full rescan reconciled by name and dropped them - so `context-map.json` exports
`contexts: []` for every one of them. Until the relink has run against the live app, the
Director derives the span by hand from the feature's description and says so in the report.
A span derived by hand is still a real span; a span silently derived from an empty link
table is a receipt over nothing, and the instrument refuses that outright.

## Characters

`uat/characters/` - the representative users this product declares, with their
jobs-to-be-done, plus `uat/journeys/` and the time-saved rubric in `uat/rubric.md`. The
value member takes them verbatim from there and never invents a persona; `uat/runs/` holds
prior certifications worth citing as evidence.

## Live app

L2 is available only when the operator already has the app running. **Do not start it**:
a build is minutes long, one cargo invocation at a time is a standing rule here, and a
second dev server on port 1420 fails the run rather than the feature.

When it is running, the test-automation bridge is on `:17320` (`npm run tauri:dev:test`)
and the dev-tools bridge on `:17400`. Absent either, the value member records L1 and says
L2 was not available. An L1 score is a real score.

## Repo law

For any implementation the Director does between rounds - `.claude/CLAUDE.md` is the
authority and its parallel-safety primitives apply in full:

- Work in a worktree for anything multi-file. Never `git stash`, never `git add -A` / `.` /
  `-u`; stage explicit paths, and verify `git diff --cached --name-status` equals exactly
  the intended list before every commit. Commit on the current branch; **never push**.
- Reuse `src/features/shared/components` (`CATALOG.md`) before building UI; semantic tokens
  only. A spinner is never a surface loading state; a control the user pressed always gets
  a real one. Components under 200 LOC.
- Every user-facing string goes through `t.section.key` and is translated into all 13 other
  locales in the same change. No em dash in any app string - rewrite the sentence.
- IPC through `invokeWithTimeout`; errors through `toastCatch` / `silentCatch` and the error
  registry. Rust: reach for the existing primitive before writing a new one
  (`.claude/rules/rust-backend.md`).

## Hard failures

The three codes, defined for this product:

- `credential_outside_vault` - a secret read, written, logged or embedded anywhere other
  than the encrypted credential store (`src-tauri/src/engine/` crypto plus the vault
  repositories). An `ANTHROPIC_API_KEY` reaching a CLI spawn is one of these: this product
  runs on subscription auth and strips the key deliberately.
- `write_outside_door` - a write to the application's SQLite database from anywhere other
  than the one gated ingest module that owns that table. The doctrine is at the head of
  `src-tauri/src/commands/infrastructure/dev_tools/notepad_ingest.rs`: skills write files,
  ONE Rust module writes SQLite.
- `unbounded_foreign_decode` - parsing or buffering data from outside the process with no
  size cap, no timeout and no error path. The existing doors cap at 1 MiB and validate
  everything before any write; anything looser in the span is this.

## Skill improvement log
