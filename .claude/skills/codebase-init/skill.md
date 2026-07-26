---
name: codebase-init
description: Initialize any codebase for autonomous development by Dev Clone and QA Guardian personas. Detects the tech stack, generates grounded CLAUDE.md conventions, a brand manual (UI projects), CI suggestions, and writes a result.json the Personas app ingests through its one gated door. Resumable — re-running skips completed artifacts. Invoke with `/codebase-init [--project-root <path>]`.
---

# Codebase Init

One-time bootstrap that prepares a target repo for autonomous development by Dev Clone / QA Guardian personas: establishes conventions, scans the tech stack, suggests CI/CD, and emits a machine-readable result for the Personas app.

## When to Use

Run on a codebase BEFORE activating Dev Clone or QA Guardian personas — it creates the configuration and documentation they expect. Also usable standalone to bootstrap best practices in any project.

## Input

Ask the user: **"Which codebase should I initialize? Point me to the root directory and tell me what the project does."** Wait for the response, then execute the phases below against that root.

If `codebase-init/snapshot.json` exists at the target root (app-dispatched run), read it FIRST — it carries the project's registered name, stack hints, and any prior-run `repo_fingerprint`. If absent (standalone run), infer everything from the repo itself.

---

## Output Boundary (D8 — files only, never application state)

You write **files across a validated boundary — never application state**. No database writes, no app APIs, no IPC. The Personas app consumes exactly one artifact through its one gated ingest door:

**`codebase-init/result.json`** at the target repo root:

```json
{
  "contract_version": 1,
  "run_id": "<YYYY-MM-DD-HHmm>",
  "repo_fingerprint": "<git rev-parse HEAD, or sha256 of root file listing if not a git repo>",
  "stack": { "language": "", "framework": "", "styling": "", "database": "", "testing": "", "ci": "", "package_manager": "" },
  "commands": { "dev": "", "build": "", "test": "", "lint": "" },
  "artifacts": [ { "path": ".claude/CLAUDE.md", "action": "created|updated|skipped", "phase": 2 } ],
  "scan": { "todos": 0, "files_without_tests": 0, "large_files_over_300_loc": 0, "debug_statements": 0, "unguarded_async": 0 },
  "readiness": { "claude_md": true, "brand_manual": false, "ci": false }
}
```

- Every `commands.*` value must be **verified** (see "Adapt, don't paste" below); omit a key rather than emit an unverified guess.
- **Idempotency marker**: `run_id` + `repo_fingerprint`. The app's ingest door dedups on this pair — re-writing result.json for an unchanged repo with the same fingerprint is a no-op on the app side, so overwriting the file on re-run is always safe.
- Also write a short human `codebase-init/report.md` (what was generated, what was skipped, what needs the human).
- Working state lives in `codebase-init/state.json` (below). Only these three files plus the declared artifacts are ever written.

## Resumability — state manifest

Before Phase 1, read `codebase-init/state.json` if present:

```json
{ "run_id": "...", "repo_fingerprint": "...", "phases": { "1": "done", "2": "done", "3": "skipped:no-ui", "4": "pending", "5": "pending" } }
```

- A phase marked `done` whose artifact file still exists is **skipped** on re-run (print "Phase N: already complete — skipping"). `skipped:*` phases stay skipped unless the reason no longer holds.
- If the `repo_fingerprint` has changed materially (new framework, new test runner), offer to refresh stale artifacts instead of skipping.
- Update `state.json` **immediately after each phase completes**, so an interrupted run resumes exactly where it stopped.

## Adapt, don't paste (applies to every generated artifact)

Every artifact must be grounded in THIS repo — no template boilerplate:

1. **Reference only real files and commands** discovered in the target repo. Never emit a placeholder like `{detected test command}` into a written file; if you couldn't detect it, omit the section and note the gap in `report.md`.
2. **Verify each command before documenting it.** Run it (or the cheapest safe probe: `--help`, `--version`, `--dry-run`, or a list-only mode for anything destructive/long-running). A command that fails does not go into CLAUDE.md or ci.yml — investigate or omit.
3. **Cite evidence**: naming/pattern claims in CLAUDE.md come from actually reading 5-10 source files, lint configs, and `git log --oneline -20` — not from stack defaults.

---

## Coordination & git safety

If the target repo has a `.claude/active-runs.md` ledger, register per its header convention before Phase 1 and deregister at session end (rationale: `docs/architecture/cli-coordination.md` in the personas repo). Regardless of ledger presence, these rules are mandatory:

1. **Never `git stash`** — it sweeps the whole tree including other sessions' in-flight work. If you need a clean stage, `git add <path>` per file; never `git add -A` / `.` / `-u`.
2. **Multi-file scope → worktree.** This skill writes several foundational files; if other sessions may be active on the checkout, work in `git worktree add .claude/worktrees/codebase-init -b worktree-codebase-init`.
3. **Atomic commits per artifact** — CLAUDE.md is one commit; brand-manual.md another; ci.yml another; result.json + state + report another. Never accumulate one mega-commit.
4. **Before committing**: scan `git status --porcelain` and classify each entry (yours vs. someone else's); after staging, check `git diff --cached --stat` — if the staged count exceeds what you added, `git restore --staged` the strangers.
5. After merge, remove the worktree and its branch.

**Declared paths**: `.claude/CLAUDE.md` (created/updated), `.claude/brand-manual.md` (UI projects), `.github/workflows/ci.yml` (only with user consent), `codebase-init/{state.json,result.json,report.md}`, plus the ledger itself if present.

---

## Phase 1: Tech Stack Detection

Detect by reading configuration files (glob first, then read the hits):

- **Language/PM**: `package.json` (+`typescript` dep), `Cargo.toml`, `pyproject.toml`/`requirements.txt`, `go.mod`, `Gemfile`, `pom.xml`/`build.gradle`; lockfile → package manager.
- **Framework**: `next.config.*`, `vite.config.*`, `remix.config.*`, `nuxt.config.*`, `angular.json`, `tauri.conf.json`; `django`/`fastapi`/`actix-web`/`axum` in deps.
- **Testing**: `jest.config.*`, `vitest` in deps, `pytest`, `cypress.config.*`, `playwright.config.*`.
- **CI/CD**: `.github/workflows/`, `.gitlab-ci.yml`, `Jenkinsfile`, `.circleci/`.
- **Styling**: `tailwind.config.*`, global CSS custom properties, theme files.
- **Database**: `prisma/schema.prisma`, `drizzle.config.*`, other DB config.

Print a summary table (Language / Framework / Styling / Database / Testing / CI/CD / Package Mgr) and record it in `result.json → stack`. Mark Phase 1 done.

## Phase 2: CLAUDE.md Generation

Create or update `.claude/CLAUDE.md`. Sections (include only what was actually detected — see "Adapt, don't paste"):

- **Project Overview** — from user input + package manifest + README.
- **Common Commands** — dev / build / test / lint, each one **verified to run** in this repo. Note quirks discovered while verifying (e.g. "tsc not on PATH — use npx").
- **Architecture Overview** — top-level directories with purpose inferred from their actual contents.
- **Code Conventions** — naming (components/files/variables/test files), state management, data fetching, error handling, styling approach, import style — each detected from real source files, lint config (`.eslintrc*`, `.prettierrc*`, `tsconfig.json` paths, `.editorconfig`), and `git log --oneline -20` (commit message format) / `git branch -r` (branch naming).
- **Working Agreements** (always include — this is what Dev Clone / QA Guardian will operate under):
  - **Atomic commits**: one logical change per commit; never accumulate >30 min of uncommitted work.
  - **Parallel-session safety**: never `git stash`; stage with scoped `git add <path>` only; verify the staged index (`git diff --cached --stat`) matches intent before committing; use worktrees for multi-file work when sessions run concurrently.
  - **Verification before "done"**: a change is complete only when the repo's test + lint + typecheck gates (name the actual commands from Common Commands) pass locally. Compiling is not passing; never claim done on build success alone — observe the actual behavior.
- **Do NOT** — generated files detected in the repo, `.env` files, plus anti-patterns evident from `.gitignore` and lint config.

Commit, record the artifact in `result.json → artifacts`, mark Phase 2 done.

## Phase 3: Brand Manual (UI projects only)

If the project has a UI (React/Vue/Svelte/Angular or a CSS framework), extract the actual design system and write `.claude/brand-manual.md`:

- **Colors** — from `tailwind.config.*` theme, `:root` custom properties, or theme files, with hex values and usage context.
- **Typography** — font families and scales from CSS/Tailwind config, `next/font`, `@font-face`.
- **Component/icon/animation libraries** — detected from deps (shadcn/ui, Radix, MUI, Chakra; Lucide, Heroicons; Framer Motion…).
- **Design tokens & visual guidelines** — spacing scale, radius, shadows, dark-mode support as actually configured.

Only include values read from the repo; skip sections with no evidence. Non-UI projects: mark Phase 3 `skipped:no-ui`.

## Phase 4: CI/CD Configuration

- **CI exists**: read the workflows; suggest (don't write) missing lint/test/build jobs.
- **No CI**: ask *"No CI/CD configuration detected. Should I create a GitHub Actions workflow?"* If yes, generate `.github/workflows/ci.yml` for the detected stack, using only the **verified** commands from Phase 2 — the workflow steps are exactly `install → lint → test → build` with the repo's real commands and detected runtime version. Never overwrite an existing workflow.
- Print branch-protection recommendations for the default branch (require PR review, require the CI check, no force pushes/deletions) with the repo's actual `Settings → Branches` URL if the remote is on GitHub.

Mark Phase 4 done (or `skipped:declined`).

## Phase 5: Codebase Scan → result.json

Run a quick health scan and record the counts in `result.json → scan`:

- TODOs/FIXMEs; source files without corresponding test files; files >300 lines; leftover debug output (`console.log` / `print` / `dbg!` as appropriate for the stack); async calls without error handling.

Print the counts, then assemble and write `codebase-init/result.json` (full shape above — stack, verified commands, artifacts with actions, scan counts, readiness flags) and `codebase-init/report.md`. This is the **only** hand-off to the Personas app: it ingests result.json through its one governed door, dedup-gated on `run_id` + `repo_fingerprint`; you never touch the app's state directly.

## Phase 6: Dev Clone Readiness Checklist

Print the checklist with real check states from this run:

```
Dev Clone Readiness:
  [state] CLAUDE.md with verified commands + working agreements
  [state] Brand manual (UI projects only)
  [state] CI/CD configured / suggestions reviewed
  [state] Codebase scan completed → codebase-init/result.json

  Human prerequisites — Dev Clone:
  [ ] GitHub PAT with repo permissions · webhook (GitHub → Smee → Personas)
  [ ] Target repository + base branch confirmed · Codebases connector registration
  Human prerequisites — QA Guardian:
  [ ] Separate PAT (different account recommended) · event subscription
  [ ] Approve threshold and write_tests preference decided
```

Finish the ledger/worktree ritual from "Coordination & git safety".

---

## Notes

- Distributed manually: copy `.claude/skills/codebase-init/` into any target project.
- Never modifies source code — only configuration, documentation, and the `codebase-init/` boundary files.
- Re-running is safe by construction: `state.json` skips completed phases; existing files are updated in place, never duplicated; result.json ingest is idempotent on the fingerprint pair.
