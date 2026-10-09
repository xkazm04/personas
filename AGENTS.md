# AGENTS.md

Instruction sources for any agent harness (Codex, Grok, Claude Code, others). This file points; it
does not restate, except for the command table under "Commands", which is generated and checked.
Where a pointed-to file and this one disagree, the pointed-to file wins.

## Read before you change anything

| You are touching | Read |
|---|---|
| anything in this repo | `.claude/CLAUDE.md` (repo law: commands, gates, git policy, conventions) |
| `src/**/*.tsx`, `src/**/*.css` (any UI) | `.claude/rules/ui.md`, then `.claude/Design.md` as the full reference |
| user-facing strings, `src/i18n/**` | `.claude/rules/i18n.md` |
| `src-tauri/**` | `.claude/rules/rust-backend.md` |
| "why is it this way?" | `docs/decisions.md` (generated index over every decision store) |

Claude Code loads the `.claude/rules/*.md` files by their `paths:` frontmatter. Other harnesses do
not, so open the one that matches your change yourself.

## Git policy

Commit on the current branch; never push, force-push or open a pull request unless the prompt asks.
Never `--no-verify`, never `git stash` work that is not yours, stage explicit paths only. Other
sessions commit to this checkout at the same time: see "Parallel-safety primitives" in
`.claude/CLAUDE.md` before your first commit.

Because several sessions commit here at once, name yours in a trailer so a regression can be traced
to the session that made it: `git commit --trailer "Agent-Session: <your active-runs slug>@<date>"`
(add `--trailer "Work-Package: <item id>"` when the work has one). `node scripts/git/by-session.mjs`
lists history by these and by the harness's `Claude-Session:` trailer.

## Commands

Generated from `.ai/manifest.yaml`; change a command there, then run
`node .ai/project-commands.mjs --write`.

<!-- ai:commands:begin -->
<!-- GENERATED from .ai/manifest.yaml (capabilities, guidance.doneGate) by node .ai/project-commands.mjs --write. Edit the manifest, not this block: --check, and src/__tests__/structural/guidanceCommands.test.ts, fail when it is stale. -->

| Capability | Command |
|---|---|
| build | `npm run build` |
| test | `npm test` |
| lint | `npm run lint` |
| typecheck | `npx tsc --noEmit` |
| scan-secrets | `node scripts/secret-scan.mjs` |
| evals | `npm run test:evals` |

Before you report done: `npm run gate -- --cold`.

- **typecheck**: the portable form. `npm run check` and `npm run build` typecheck through `npm run typecheck:native` (the TS 7 native compiler, same tsconfig), and `npm run gate` answers tsc from a warm daemon. All three are the same typecheck, not three different ones.
<!-- ai:commands:end -->

## Gates to run before you report done

- The done gate above runs tsc, eslint on changed files and the golden-path census, cold.
- `npm run check`: the full pre-push chain. Style rules in ESLint are warn and fail nothing; the
  census ratchets in `scripts/census/rules.json` are what fail a style slip.
