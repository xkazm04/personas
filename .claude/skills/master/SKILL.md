---
name: master
description: The terminal channel to ONE App Master per project. Pick an existing master or create a new one through an onboarding questionnaire (the product, its key goals, the boundaries, how it should work with you), give it its owner's brief, wake it, and then loop with it from this session: read what it decided, dispatched, filed and asked since the last look, answer the asks that are the operator's, speak into its channel, and keep a session memory the next /master session resumes from. Invoke with `/master` (choose), `/master <project>` (boot straight into one), `/master <project> run` (the loop), `/master <project> say <message>`.
version: 0.1.0
---

# /master — one App Master per project, from the terminal

> The App Master is a runtime role the app already owns: a persona bound to a project, with
> charters, a law manifest, a decision lane that wakes it, fleet workers it dispatches, ideas
> and KPIs it files, and asks it raises in Approvals. The record of how it came to be is
> `docs/architecture/app-master-e2e.md`; the Grand Simulation runs seven of them through
> `/grande`. This skill is the operator's chair next to ONE of them. It never runs the loop
> itself and never writes application code for the project: the master decides, the workers
> build, the operator counsels. Everything here goes through `master.mjs`, which reads the
> master's memory from the live database and writes only through the app's own doors.

## Where the master's memory lives (read all of it, write none of it directly)

| Horizon | Store | What it holds |
| --- | --- | --- |
| Now | `persona_manual_reviews` (pending) | the asks it put to the operator and nobody answered |
| Short term | its channel (`team_channel_messages.persona_id`) | what was said to it and what it said back (`say`) |
| Short term | `persona_attention_ledger`, `persona_episodes`, `persona_executions` | every wake: lane, verdict, cost; every run's transcript excerpt |
| Working | charter `spec.pacing` | the coverage note it writes itself after each decision, plus the next wake it chose |
| Long term | `persona_memories`, the manifest self-model | what the app consolidated for it; what it holds about its own craft |
| Project | `dev_goals`, `dev_memories`, `dev_ideas`, `dev_kpis`, `dev_tasks` | the goals it moves, what the project learned, the backlog it feeds |
| This chair | `.claude/master/<slug>/` (local, gitignored) and the vault folder `App Masters/<project>/` | the brief, the cursor, the log, the operator's decisions, one note per session |

`master.mjs boot` returns every row of that table at once. `digest` returns only what changed
since the cursor. A wake that left no ledger row and no episode did not happen; say so instead
of narrating.

## Doors and their preconditions

Reads need only the database. Writes need the app running with the test-automation server:
`node scripts/e2e/sim-app.mjs up` (reuses a healthy instance; a cold launch compiles for
minutes, so start it first and write the questionnaire while it boots). The dev-tools bridge
token comes from `~/.personas/local-http.json`; the test bridge is `:17320`.

```
node .claude/skills/master/master.mjs list                          # every project, with or without a master
node .claude/skills/master/master.mjs boot    --project kp          # the whole memory, JSON
node .claude/skills/master/master.mjs onboard --project kp --brief <brief.json>
node .claude/skills/master/master.mjs say     --project kp --file <msg.md>
node .claude/skills/master/master.mjs wake    --project kp [--off]  # loop on + persona enabled (= a wake request)
node .claude/skills/master/master.mjs asks    --project kp
node .claude/skills/master/master.mjs answer  --review <id> --status approved|rejected|resolved --notes "<why>"
node .claude/skills/master/master.mjs digest  --project kp [--no-advance] [--since <iso>]
node .claude/skills/master/master.mjs end     --project kp --note <note.md> [--slug <short>]
```

`<project>` resolves by id, name, root path, or the slug (the root's last path segment: kp is
"CandiDate" in `dev_projects`, slug `kp`). Every write verifies its effect in the database
before reporting; the test bridge's echo is not evidence (results over 380 chars come back as
`{big: n}`).

## Enter (every invocation)

1. **Pick.** `master.mjs list`. If the user named a project, take it. Otherwise ask ONE
   select question: one option per project that has a master (label `<project> · master
   on/off · N open asks · last: <coverage note, 60 chars>`), then `Create new master`. At most
   four options per question: put the masters with open asks first, and offer `More…` as the
   fourth when there are more. `Create new master` leads to Onboard below.
2. **Boot.** `master.mjs boot --project <ref>`. Read the manifest, the charters with their
   priorities and pacing notes, the goals, the memories, the open asks, the channel tail, the
   last ledger rows, the branches in the repo, the skill state and the last session note in the
   vault (`App Masters/<project>/`). If `state.onboardedAt` is missing for a master that exists,
   it was adopted by a script (the e2e cycles, `/grande`) and has never received an owner's
   brief: offer `Onboard this master` (the questionnaire runs; adoption is idempotent and keeps
   its charters and pacing) or `Continue without a brief`.
3. **Say where it stands** in one paragraph, from the evidence: what it last decided and when,
   what moved on the goals, what it is waiting on (asks, accepts, a broken recipe), whether it is
   enabled, whether the loop is on, machine headroom. Then the mode the user asked for, or ask.

## Onboard (`Create new master`, or a master without a brief)

The questionnaire is four waves of `AskUserQuestion`. Every wave's answers are written into the
brief file at once (`.claude/master/<slug>/brief.json`) so a dropped session loses one wave, not
four. Free text comes through the built-in `Other`; the options are there to make the common
answer one keystroke, never to narrow the operator.

**Wave 1, the product.** Which project (only when creating: the `dev_projects` rows with no
master, plus `Register a new path` which needs `POST /dev-tools/projects` first). What it is
in one sentence (free text, required). Stage: `idea` / `working prototype` / `used daily` /
`live with users`. Who the operator is to this master: `CEO-level counsel` (default; asks only
for scope, money, risk, goal conflicts) / `hands-on reviewer` (asks before every branch) /
`silent owner` (asks only when blocked).

**Wave 2, the key goals.** Up to three, in priority order. For each: the goal in one line
(free text), what would prove it moved (free text; becomes `measure`), a target date or none.
Offer the project's existing open goals as pick-one options first, so an onboarding of a
project with a live goal list adopts rather than duplicates. Each goal becomes a `dev_goals`
row through `dev_tools_create_goal` (skipped by title when it exists).

**Wave 3, the mandate.** Charters (multi-select; defaults on): `project-kpi-stewardship` (1),
`accepted-idea-delivery` (2), `codebase-security-scan` (3), `codebase-static-analysis-sweep`
(3), `codebase-architecture-review` (4), `technical-decision-capture` (unset). Offer the
`/grande` four as a second multi-select when the project has a money or data path:
`service-contract-stewardship`, `gate-authorship`, `threat-and-evidence`,
`acceptance-certification`. Model: `claude-opus-5` (default) / `claude-opus-4-8`. Parallel
workers: `1` / `2` (default). Boundaries (multi-select, then `Other` for more): `never touch
<path>`, `no dependency changes`, `no schema migrations without an ask`, `no new external
services`, `English only in the UI`. Rung is always 2 (branch and PR; the operator merges).

**Wave 4, how you work together.** What counts as an ask (multi-select): scope change, spending
beyond the daily cap, risk on the money or data path, a conflict between two goals, a recipe
failing three runs straight. Pacing: `self-paced` (default; the master picks the next wake,
10 to 240 minutes) / `every hour` / `once a day`. Report style: `plain and short, lead with
what moved` (default) / `narrative, with reasoning` / `numbers first`. Digest cadence in this
terminal while looping: `each wake` / `every 30 minutes` / `only when something needs me`.

Then, in order, with the app up: `master.mjs onboard --project <ref> --brief <file>`. It adopts
(charters with priorities, model, max parallel, rung 2, NOT enabled), writes the goals, appends
the boundaries to the `# Boundaries` law section, posts the rendered brief as the FIRST message
in the master's channel (a cold master otherwise decides against an assumed goal), writes the
skill state, and seeds the vault map. Read the output; quote the persona id, the goals that
landed and the channel message id. Only then `master.mjs wake --project <ref>`: the loop is
switched on if it was off, the persona is enabled, and enabling records a wake request, so the
first decision comes on the next attention tick (within about five minutes) with the brief in
front of it.

## Run (the loop)

The master runs itself inside the app; this chair watches, answers, and speaks. Use the
dynamic loop (`ScheduleWakeup`), never a fixed interval:

1. `master.mjs digest --project <ref>`. When `quiet` is true, say one line and schedule the next
   wake; do not narrate the absence of events.
2. Otherwise print, in this order: what it decided (ledger rows, the coverage note it wrote,
   the next wake it chose), what ran (executions with status, cost, duration; fleet sessions by
   state), what it said in the channel, what it filed (tasks, ideas by status, branches with
   their subjects), what it asked (new asks with their suggested actions), and the goals that
   changed status. Short sentences; one line per item; the persona's own words in quotes when
   they carry the reason.
3. **Asks.** An ask is the operator's unless the brief delegates it. The brief's `askFor` list
   says which kinds the operator wants; anything outside it the chair may answer itself, with
   the reasoning in `--notes`, and must report having done so. For the operator's, present each
   as one select question with the master's own `suggested_actions` as the options, then
   `master.mjs answer` with the choice and the operator's words as the notes. Never leave an ask
   open silently: an unanswered ask is the ceiling the first day hit (delivery starving on the
   human accept).
4. **Speak.** Anything the operator says to the master (a correction, a priority change, a
   new goal, an answer that is not an ask) goes into its channel through `say`, addressed
   plainly and in the operator's words. The master reads its channel on every decision. A
   goal change is also a `dev_tools_create_goal` (or an amendment the master makes through
   its own plan when told).
5. **Pace.** The next wake is the master's `nextWakeMinutes` from the newest pacing note,
   bounded to the brief's digest cadence; 20 to 30 minutes when it has not decided yet; longer
   when the persona is disabled or the app is down (say which).
6. **Harden.** When the digest shows a defect in the master's design rather than in the
   project (a recipe failing repeatedly, a decision that ignored the brief, an ask that should
   have been a decision, a note that contradicts the ledger), record it in the vault map under
   `Open questions` with the evidence, and bring it to the operator as a design question, not
   as a chore. Fixing the loop is Personas work: a worktree, the isolated-index ritual, a
   restart between wakes (`sim-app.mjs down`, then `up`), noted in the log. Never edit under
   `src-tauri/src` during an observation window: the app restarts and the workers die.

## End (every session)

Write the session note (what the master did, what the operator decided, what is open, one
`next:` line) to a scratchpad file and `master.mjs end --project <ref> --note <file> --slug
<short>`: it lands in the vault folder beside the map, never overwriting, and the map gets a
link. Append the operator's decisions to the map's `## Decisions`. Update auto-memory when
something durable about the master's design was learned. Leave the master enabled when it is
mid-cycle and say so; `wake --off` only when the operator asks for quiet or the machine is
needed. Commit skill and doc changes on the current branch with the isolated-index ritual;
never push.

## Guardrails

- The chair never merges, never accepts ideas in bulk, never edits the law beyond the
  boundaries the operator dictated in the questionnaire, and never deletes a goal.
- One master per project. `onboard` on a project that already has one re-adopts idempotently
  and keeps its pacing; it does not mint a second persona.
- Evidence over narration: every claim about what the master did cites a ledger row, an
  execution, a channel message id, a branch, or a goal status.
- Read memory headroom (`machine.usedPct` in every payload) before waking anything; above 60%
  say so and do not wake.
- The test bridge and the dev-tools bridge are loopback and unauthenticated beyond the token;
  never print the token.
- Bring the operator decisions a CEO would be asked; relaunches, restarts and cursor bumps are
  the chair's.
