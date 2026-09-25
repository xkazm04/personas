# AGENTS.md

Instruction sources for any agent harness (Codex, Grok, Claude Code, others). This file points; it
does not restate. Where a pointed-to file and this one disagree, the pointed-to file wins.

## Read before you change anything

| You are touching | Read |
|---|---|
| anything in this repo | `.claude/CLAUDE.md` (repo law: commands, gates, git policy, conventions) |
| `src/**/*.tsx`, `src/**/*.css` (any UI) | `.claude/rules/ui.md`, then `.claude/Design.md` as the full reference |
| user-facing strings, `src/i18n/**` | `.claude/rules/i18n.md` |
| `src-tauri/**` | `.claude/rules/rust-backend.md` |

Claude Code loads the `.claude/rules/*.md` files by their `paths:` frontmatter. Other harnesses do
not, so open the one that matches your change yourself.

## Git policy

Commit on the current branch; never push, force-push or open a pull request unless the prompt asks.
Never `--no-verify`, never `git stash` work that is not yours, stage explicit paths only. Other
sessions commit to this checkout at the same time: see "Parallel-safety primitives" in
`.claude/CLAUDE.md` before your first commit.

## Gates to run before you report done

- `npm run gate -- --cold`: tsc, eslint on changed files and the golden-path census, cold.
- `npm run check`: the full pre-push chain. Style rules in ESLint are warn and fail nothing; the
  census ratchets in `scripts/census/rules.json` are what fail a style slip.
