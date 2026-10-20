# AGENTS.md

Instruction sources for any agent harness (Codex, Grok, Claude Code, others). This file points; it
does not restate, except for the command table under "Commands", which is generated and checked.
Where a pointed-to file and this one disagree, the pointed-to file wins.

## Read before you change anything

| You are touching | Read |
|---|---|
| anything in this repo | `.claude/CLAUDE.md` (repo law: commands, gates, git policy, conventions) |
| `src/**/*.tsx`, `src/**/*.css` (any UI) | `.claude/rules/ui.md`, then `.claude/Design.md` as the full reference |
| user-facing strings, `src/i18n/**`, `scripts/i18n/**`, `src/features/**/i18n/**` | `.claude/rules/i18n.md` |
| `src-tauri/**` | `.claude/rules/rust-backend.md` |
| the credential vault: master key, credential decrypt, IPC tiers, API proxy | `docs/security/credential-vault-threat-model.md` (what is protected, from whom, and the boundaries not to cross). Section 7's checkable boundaries are listed in `docs/security/vault-boundaries.json` and enforced by `src/__tests__/structural/vault-boundaries.test.ts` |
| "why is it this way?" | `docs/decisions.md` (generated index over every decision store) |

Claude Code loads the `.claude/rules/*.md` files by their `paths:` frontmatter. Other harnesses do
not, so open the one that matches your change yourself. The globs in the first column are the
frontmatter's, verbatim: `src/__tests__/structural/rulesPathGlobs.test.ts` (in `npm test`) fails when
a rules file's glob matches no file in the tree, or when a row here and its rules file disagree.

## Git policy

Commit on the current branch; never push, force-push or open a pull request unless the prompt asks.
Never `--no-verify`, never `git stash` work that is not yours, stage explicit paths only. Other
sessions commit to this checkout at the same time: see "Parallel-safety primitives" in
`.claude/CLAUDE.md` before your first commit.

Because several sessions commit here at once, name yours in a trailer so a regression can be traced
to the session that made it: `git commit --trailer "Agent-Session: <your active-runs slug>@<date>"`
(add `--trailer "Work-Package: <item id>"` when the work has one). `node scripts/git/by-session.mjs`
lists history by these and by the harness's `Claude-Session:` trailer.
`node scripts/git/check-session-trailer.mjs <message-file>` is the verdict on one message: a commit
co-authored by Claude (or carrying `Claude-Session:`) without a session trailer exits 1; human
commits, merges and reverts pass. It is not yet wired as a `commit-msg` hook in `lefthook.yml`.
`node scripts/git/trailer-coverage.mjs [--since <date>] [--min-share 0.9]` applies the same verdict
to a window of history (default: 30 days) and prints the share of agent commits that name their
session, with the hash of every one that does not; `--min-share` makes it exit 1 below a floor.
No share has been recorded yet, and no regression has yet been traced to a session this way.

## Commands

Generated from `.ai/manifest.yaml`; change a command there, then run
`node .ai/project-commands.mjs --write`.

<!-- ai:commands:begin -->
<!-- GENERATED from .ai/manifest.yaml (capabilities, guidance.doneGate, guidance.prePushGate) by node .ai/project-commands.mjs --write. Edit the manifest, not this block: --check, and src/__tests__/structural/guidanceCommands.test.ts, fail when it is stale. -->

| Capability | Command |
|---|---|
| build | `npm run build` |
| test | `npm test` |
| lint | `npm run lint` |
| typecheck | `npx tsc --noEmit` |
| scan-secrets | `node scripts/secret-scan.mjs` |
| evals | `npm run test:evals` |

Before you report done: `npm run gate -- --cold`.

Before you push: `npm run check` (the full pre-push chain; it is not part of done).

- **test**: the Vitest suite. The Rust suites are separate lanes (`npm run test:rust` for app_lib with `--features desktop`, `npm run test:rust:crates` for the extracted crates), listed under Common Commands in `.claude/CLAUDE.md`.
- **typecheck**: the portable form, run through `npx` because `tsc` is not on PATH on Windows. `npm run check` and `npm run build` typecheck through `npm run typecheck:native` (the TS 7 native compiler, same tsconfig), and `npm run gate` answers tsc from a warm daemon. All three are the same typecheck, not three different ones.
<!-- ai:commands:end -->

## What the two gates run

The done and pre-push commands are the two generated lines above; this section only says what is
behind them.

- The done gate runs tsc, eslint on changed files and the golden-path census, cold.
- The pre-push gate is the full `check` chain. Style rules in ESLint are warn and fail nothing; the
  census ratchets in `scripts/census/rules.json` are what fail a style slip.
- Counts quoted in the docs (connectors, languages, codegen tasks, tests) are measured against the
  tree by `node scripts/docs/check-doc-counts.mjs`; `src/__tests__/structural/docCounts.test.ts`
  (in `npm test`) fails when README.md or CONTRIBUTING.md drifts. Change a quoted number, or move
  the sentence, and update `CLAIMS` in that script in the same change.

## Adding or editing a workflow

`src/__tests__/structural/workflowSupplyChain.test.ts` (in `npm test`) fails when a workflow in
`.github/workflows/` has no `permissions:` (start from a top-level `contents: read` and grant write
on the one job that needs it), grants write at the top level, or references a new action by a tag
or branch instead of a full commit SHA (`owner/repo@<40-hex> # vN`). Its allowlists name what is
still owed in the existing workflows and only shrink: when you fix one, delete its entry.
