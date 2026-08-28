---
name: ship-milestone
description: "Execute one Ship milestone end to end: resolve its cut, interview the operator for the missing descriptions and the target state, compute the gaps from the duality (automation-blocked / unrated / rated low), dispatch up to 8 gap-workers, run the repo's own checks, and write a result.json the Personas app ingests through its one gated door (dev_tools_ship_milestone_ingest). Proposes milestone additions rather than writing them. Invoke with `/ship-milestone <milestone-id>`."
argument-hint: "<milestone-id>"
category: Development
contexts: tracked
memory: project
---
# Ship Milestone 🚢

You execute **one milestone** — a convergence cut in the Personas Ship layer
(`docs/features/plugins/dev tools/ship.md`) — and then report back through the
app's one gated door.

> **Why the door is not optional.** The operator chose a skill over an in-app
> Athena op knowing the trade: a CLI session is invisible to the app's progress
> surface and writes no audit ledger. `result.json` is the entire compensating
> control. A run that does good work and writes no result executed a milestone
> **invisibly**, which is the exact risk the choice took on. Phase 7 is the
> deliverable; the code you write is how you earn it.

**You never write `personas.db`.** Not through SQL, not through the management
API's write endpoints. Every finding of yours reaches the app through
`result.json` and the app's `dev_tools_ship_milestone_ingest` command.

---

## 0. Register in the active-runs ledger

Read `.claude/active-runs.md`. If an `## Active` entry declares paths that
overlap the milestone's likely scope, is `started`, and is under 2 hours old,
surface the conflict to the operator before proceeding. Append your own entry
(paths = the contexts you are about to touch). Move it to
`## Recently completed` in Phase 8.

If your scope is more than a single file — it almost always is — work in a
worktree (`git worktree add .claude/worktrees/ship-<milestone-slug>`). Commit
atomically per gap. Never `git stash`; never `git add -A`.

## 1. Resolve the milestone

`$ARGUMENTS` carries the milestone id. Resolve it in this order — the same
fallback `buildGoalAssistPrompt` already uses on the app side:

1. **Management HTTP API**, if `http://127.0.0.1:9420` answers:
   `GET /api/dev/milestones/<id>` with `Authorization: Bearer <key>` returns
   the project, the milestone and its items (`itemKind`, `itemId`, `name`,
   `bucket`, `description`, `rating`, `addedAfterCut`);
   `GET /api/dev/projects/<projectId>/ship` returns the whole roadmap plus the
   use-case and goal registries. This is the live truth. A key comes from the
   pairing ceremony (`POST /pair/request` → approve in the app →
   `GET /pair/claim`) or from `PERSONAS_API_KEY` when the dispatcher set it;
   reads need any valid key. (These routes exist since 2026-08-28 — before
   that this step could only ever fall through to the brief.)
2. **A brief file**, when the API is unreachable: the dispatcher writes
   `.personas/ship-milestone/runs/<run-id>/brief.json` with the same content.
   Read that.
3. If neither exists, **stop and say so.** Do not guess a milestone from the
   repo. A run against an invented cut produces a result the door will refuse
   anyway (it validates every item against real membership).

Note the `run-id` you were given (or mint `YYYY-MM-DD-HHmm`); everything you
write lives in `.personas/ship-milestone/runs/<run-id>/`.

**Members are `use_case` or `goal` only.** KPIs are the outcome layer *above* a
milestone and are never members of one. Never report a KPI as an item.

## 2. Interview the operator — batched, not one at a time

You are a Claude Code session, so your interview is **you asking the operator
directly in this terminal**. Be honest about that: this is NOT the app's
structured build-session elicitation (where the CLI emits a clarifying
question, the runner persists it and blocks on a channel, and
`answer_build_question` resumes it). Nothing here is persisted by the runner,
and nothing blocks on the app. What you ask and what you hear you carry
yourself, and you echo it back in `result.json` under `asked` so the reasoning
that shaped the run survives the terminal scrollback.

Ask in **batches of select-style questions**, never one at a time. Two batches
is the shape:

- **Batch A — the target state.** What does "shipped" mean for this cut
  (internal dogfood / private beta / public release)? What is explicitly out of
  scope? What is the hard deadline, if any? Offer concrete options drawn from
  the milestone's own goal sentence rather than open prose.
- **Batch B — the missing descriptions.** Every core member with no
  `description` gets one question, all in the same batch, each offering 2-3
  plausible "why this is in the cut" readings you inferred from the code plus a
  free-text option. A member the operator cannot justify is a signal in itself
  — record it as a proposed removal in your summary, never act on it.

If the operator declines to answer, proceed with what you have and say so in
`result.json`. Do not stall a run on an unanswered question.

## 3. Compute the gaps from the duality

A milestone member carries two independent readings (`shipDuality.ts`): the
**automation's** (`ShipFeature.ready`, derived from KPI coverage and context
health — nobody types it) and the **operator's** (`rating`, 1..5, `null` =
unrated, which is a state of its own and never a zero).

**The gap rule, stated once. A member is a gap when ANY of these holds:**

1. **Automation-blocked** — `ready === false`. The automation declines to call
   it ready: a critical context in its slice, or no KPI measuring it.
2. **Unrated** — `rating === null`. Nobody has weighed in, so there is no second
   opinion to check the sensors against.
3. **Rated low** — `rating <= 2`. The operator distrusts it regardless of what
   the sensors say.

Rank the gaps: disagreements first (`ready && rating <= 2`, or
`!ready && rating >= 4` — where the two readings point opposite ways, per
`itemVerdict`), then automation-blocked, then unrated. A disagreement is the
most valuable thing on the board: either the sensors measure the wrong thing or
the operator carries a belief the evidence does not support, and both are worth
a human look.

Members that agree and are ready are **not** gaps. Do not manufacture work for
them.

## 4. Dispatch at most 8 gap-workers

Take the top gaps and give each one subagent. **The cap is 8**, mirroring
`FLEET_PLAN_MAX_ROWS` (`approval_exec_fleet.rs`) — the same ceiling
`SHIP_MILESTONE_MAX_ROWS` adopts, for the same reason: past eight parallel
threads, nobody reads every result, and a cut with more than eight live gaps is
not a milestone, it is a backlog. If there are more than 8 gaps, work the top 8
and list the rest in your summary.

Each worker brief carries: the member's name and id, its two readings and why
it is a gap, the contexts in its slice, and the target state from Batch A.

Every worker, and you at the end, obey the night-shift worker's discipline:

> Run the repo's own checks/tests before finishing; leave the working tree
> clean — everything committed on your branch. Never commit to the default
> branch and never push to a remote.

Read the repo's `CLAUDE.md` for what "the repo's own checks" actually are, and
run those, not a guess.

## 5. Extending the milestone — propose, never write

Execution reveals work the milestone needs: a use case nobody scoped, a goal
that has to land first. **You propose it. You do not add it.**

Additions go in `result.json` under `proposed_additions` and stop there. The
ingest door surfaces them and refuses to apply them, by design — the cut is an
operator decision made in the Ship tab, and a skill that could widen its own
scope mid-run would make the cut meaningless. The door also refuses any `items`
row that is not already a member, so there is no back way in.

## 6. Suggest ratings and descriptions honestly

For each member you touched, you may suggest:

- **`suggested_rating`** (1..5) — YOUR read after doing the work, in the
  operator's scale. Suggest one only when the work gave you evidence. Never
  suggest `3` to avoid taking a side; leave the field out instead. Never
  suggest a rating for a member you did not actually examine.
- **`suggested_description`** — the "why this is in the cut" note, from Batch B
  or from what the work revealed. ≤1200 characters.

A member you looked at and changed nothing about still belongs in `items` with
`changed` filled in and both suggestion fields omitted. That is a report, not a
write, and the door counts it as such.

## 7. Write `result.json` — the deliverable

Write `.personas/ship-milestone/runs/<run-id>/result.json`:

```jsonc
{
  "schema_version": 1,                  // REQUIRED. A missing or unknown
                                        // version is refused outright.
  "milestone_id": "<the id you were given>",
  "items": [                            // ≤100. Every id MUST already be a
                                        // member of this milestone.
    {
      "item_kind": "use_case",          // "use_case" | "goal" — never "kpi"
      "item_id": "<real id from phase 1>",
      "changed": "what this run actually did for this member",
      "suggested_rating": 4,            // optional, 1..5
      "suggested_description": "why it is in the cut"   // optional, ≤1200 chars
    }
  ],
  "proposed_additions": [               // ≤8. SURFACED, never applied.
    { "item_kind": "goal", "name": "Close the retry budget gap",
      "rationale": "hit it three times while working uc-a" }
  ],
  "asked": [                            // ≤20
    { "question": "What does shipped mean here?", "answer": "private beta" }
  ],
  "summary": "one paragraph: what advanced, what is still blocked, what you could not reach"
}
```

Also write `report.md` beside it for the human — same content in prose. The
door ignores it.

**The door's guards, so you can pre-empt them** (`ship_ingest.rs`):

| Guard | Refuses |
| --- | --- |
| Path confinement | any run dir outside `<repo>/.personas/ship-milestone/runs/` |
| Size cap | `result.json` over 1 MiB |
| Version check | a missing or non-`1` `schema_version` |
| Identity | a `milestone_id` naming a different milestone |
| Membership | an `items` row that is not already a member |
| Range | `suggested_rating` outside 1..5 |
| Caps | >100 items, >8 proposed additions |
| Idempotency | a run dir that already has `ingested.json` |

It validates the **whole file before writing anything**: one bad row refuses the
run and nothing lands. That is deliberate — a milestone report half applied
misdescribes what the run did. If the door refuses you, fix `result.json` and
re-run the ingest; nothing was written, so there is nothing to undo.

Bucket changes are not yours to make. The door replays each member's existing
bucket, so an ingest can annotate a cut but never reshape it.

## 8. Close out

1. Tell the operator the run is ready and where the result is, and that the
   Ship tab's **Ingest run** control is what applies it.
2. Confirm the tree is clean and every gap is committed on its branch.
3. Move your `.claude/active-runs.md` entry to `## Recently completed` with the
   resulting commit SHA (or `aborted (<reason>)`).

Never mark the milestone shipped. Certification is the operator's, in the app,
gated on the exit criteria — a skill that certified its own work would be
grading its own homework.
