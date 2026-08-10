---
name: idea-run
description: Execute ONE approved dev_idea end to end in its own repo — re-validate the ticket against real code (with authority to decline), implement atomically, verify with the repo's own gates, and write a result.json the orchestrator rolls up. Stage 2 of the idea-triage funnel (docs/concepts/idea-triage-funnel.md). Invoke with `/idea-run <idea-id> [--ideas-file <path>]`.
---

# idea-run — one idea, grounded, end to end

You are executing ONE backlog idea that passed a cheap policy gate. The gate was shallow
on purpose; **you are the deep check**. The ticket is a hypothesis about the codebase,
not an order.

## Inputs

- `<idea-id>` — the `dev_ideas` UUID (or unambiguous prefix).
- `--ideas-file <path>` — JSON array of idea rows (id, project, repo_path, title,
  description, reasoning, evidence, risk/impact/effort). Default:
  `triage/runs/<latest>/accepted.json` next to this repo's `triage/` dir; the
  orchestrator always passes the explicit path when dispatching.

Resolve your item from the file. If the id is missing or ambiguous: STOP, write a
`blocked` result (see Output) — never guess which ticket you're holding.

## Phase 0 — situate (5 minutes, hard cap)

1. `cd` into the item's `repo_path`. If it doesn't exist or isn't a git repo → `blocked`.
2. Read the repo's own rules if present: `CLAUDE.md`, `.claude/conventions.json`,
   `context-map.json`. They override this skill's generic guidance.
3. Check the working tree: `git status --porcelain`. Other sessions' in-flight work is
   untouchable — never stash, never `git add -A`. If your write-area overlaps dirty
   files → `blocked` with the file list (the orchestrator re-waves it later).

## Phase 1 — re-validate (the authority to decline)

Read the ACTUAL code the ticket names — files, functions, the claimed gap. Then decide:

- **Premise holds** → proceed to Phase 2.
- **Already fixed / feature removed / premise contradicted** → write result with outcome
  `analysis-declined`, citing file:line evidence for the contradiction. STOP. This is a
  SUCCESS outcome, not a failure — a wrong ticket caught here costs minutes, merged it
  costs days.
- **Premise partially holds** → narrow the scope to the part that is real, note the
  narrowing in the result.

Validation questions worth asking every time: does the referenced file still exist?
Was this fixed in a commit newer than the idea's `created_at`? Does the "missing"
error-handling/test/pattern actually exist under a different name?

## Phase 2 — implement

- **Smallest correct change.** The ticket's scope is a ceiling, not a target.
- Match the repo's idiom: comment density, naming, error-handling patterns, i18n rules,
  design tokens — whatever its CLAUDE.md/conventions demand.
- **Atomic commits**, one logical step each, message per repo convention. Stage
  file-by-file (`git add <path>`), verify `git diff --cached --stat` matches your
  intent exactly before each commit — the index may hold other sessions' pre-staged
  files.
- No drive-by refactors, no bulk migrations, no fixing unrelated warnings.

## Phase 3 — verify

Run the repo's OWN gates, scoped where possible:

- Typecheck + lint (as the repo defines them).
- The test files covering your write-area; add a regression test when the ticket was a
  defect and the repo has a test culture.
- If a gate fails: fix and re-verify. If you cannot make it green: revert your commits
  (`git revert`, not reset — history stays honest) and report `blocked` with the output.

Never report `implemented` with a red gate. Never skip hooks (`--no-verify` is banned).

## Output — result.json (the contract)

Write `idea-run/result.json` under the run directory you were given (or
`<repo_path>/idea-run/<idea-id-prefix>/result.json` if none):

```json
{
  "ideaId": "<full uuid>",
  "outcome": "implemented" | "analysis-declined" | "blocked",
  "seenStatus": "accepted",
  "summary": "<2-3 sentences: what was done or why not>",
  "evidence": ["<file:line or commit sha per claim>"],
  "commits": ["<sha> <subject>"],
  "gates": [{ "name": "<gate>", "result": "pass" | "fail", "detail": "<one line>" }],
  "narrowed_scope": "<present only if Phase 1 narrowed the ticket>",
  "blocked_reason": "<present only when outcome=blocked>"
}
```

Rules: `evidence` is mandatory for every outcome (an analysis-decline without file:line
citations is an opinion, not a verdict). `commits` empty unless outcome=implemented.
The final text of your session is a 5-line human summary; the JSON is the machine record.

## Conduct

- Permissions are wide but the blast radius is not: touch only your item's write-area.
- Push NOTHING. Commits stay local; the orchestrator owns push/rollup.
- If the repo has an active-runs ledger convention, honor it.
- Time-box: if Phase 2+3 exceed ~45 minutes of wall clock, prefer `blocked` with a
  handoff note over a half-implemented tree. Revert anything uncommitted first.
