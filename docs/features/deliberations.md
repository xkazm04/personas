# Team Deliberations ("Design D")

A **deliberation** is a moderated, multi-persona conversation a team holds to make
a decision — and then turn that decision into real work. Where the channel
(Collab) is an open-ended event stream, a deliberation is *bounded*: it has a
topic, a live agenda, and a termination — the team's personas debate from their
distinct points of view, a cheap moderator keeps them on track, and the outcome
is a concrete proposal you approve into a team assignment.

> **Default OFF — but you can drive it by hand.** The *autonomous* moderator that
> advances a deliberation in the background is gated behind the
> `autonomous_deliberation` setting; with it off, the team won't run rounds on its
> own. **Regardless of that flag, the deliberation header has a *Run a round*
> button** that advances the conversation one moderated round on demand — that's
> the way to test or step through a deliberation. Turn the setting on
> (Settings → autonomy) to let the team also deliberate unattended.

## Where it lives

Open a team's workspace → the **Deliberate** tab (next to Collab). The surface:

- **Left** — a *Start a deliberation* form (topic + optional desired outcome +
  an optional **budget** in USD) and the list of the team's deliberations with
  their status.
- **Right** — the selected deliberation:
  - **Header** — status, the round counter, a **cost meter** (spend vs.
    budget), a **Run a round** button (advances one moderated round on demand),
    and a **Run to budget** toggle that auto-advances round after round until the
    budget is spent, the team converges/escalates, or it hits an action gate
    (then it stops on its own; press **Stop** to halt early). Both work whether or
    not autonomous deliberation is enabled. There is deliberately *no turn meter*:
    a deliberation is bounded by *progress* (its agenda and a stall limit) and by
    hard cost / idle floors, not by a turn count.
  - **Agenda** — the open and resolved items. The agenda is the progress bar: the
    deliberation resolves when the agenda is settled (or the moderator converges).
  - **Conversation** — the persona turns, each speaking from their authored
    *core* (a distinct motivation + stance), expected to push back when a
    proposal conflicts with their point of view. Approved capability outputs are
    posted back here (prefixed 🛠) so the next turns build on real results.
  - **Capability action card** — when a persona decides an open point is better
    answered by *doing* than discussing, it requests one of its real capabilities
    and the deliberation parks at status **"Needs approval"** with an
    **Approve & run / Skip** card (decision 8 — capability use is always gated).
    Approve runs the capability for real (full tools/connectors), posts its output
    back as a turn, and resumes the discussion on top of it; Skip declines and
    continues. This is the conversation↔action↔conversation loop.
  - **Split into tracks** — when the agenda has ≥2 open items, **Split into
    tracks** partitions it into parallel sub-sessions (see below). The parent then
    shows a **track board** — one card per track with its status + cost — plus
    **Run all tracks** (advances them all concurrently), and **Merge tracks**
    (once they're all done) to fold them into one proposal. Click a track to drill
    into it; a breadcrumb returns to the board.
  - **Proposal / escalation card** — when the team converges, it synthesizes a
    concrete proposal (title + objective + summary). **Approve & assign** hands
    that objective to the team-assignment engine (the same path Athena uses), so
    the deliberation *feeds the deterministic engine* — talk becomes shipped work.
    If the team can't settle it, the card becomes **"Your decision needed"** with
    an inline decision: type a steer and **Send & resume** (the team continues
    with your direction and a fresh stall budget), **Wrap up now** (synthesize a
    proposal from where it landed), or **Abort**.

## How it works (architecture)

The deliberation plane is a separate, budgeted, **moderated** loop that *emits*
work into the existing execution engine — the LLM never enters the deterministic
execution tick loop (the "C-on-B" doctrine). A cheap Haiku moderator routes the
1–3 most relevant personas each round, curates the agenda, judges progress, and
biases toward action; persona turns run on each persona's own model. Loop safety
comes from the agenda (termination), a stall limit (circularity), rate-shaping
(bounded turns per tick), and hard cost / idle floors — *not* a turn budget.

**Conversation ↔ action.** A persona turn isn't limited to talk: a persona is
shown its *real* enabled capabilities and may request one (`invoke_capability`
with a real `use_case_id`). That parks the deliberation at `awaiting_action` with
a `pending_action` and waits for the user (the autonomous loop never side-effects
unattended — decision 8). On approval, `approve_deliberation_action` runs that
capability through the normal single-execution engine (`execute_persona_inner`,
full tools/connectors), waits for its output, posts it back into the channel as a
turn, rolls its cost into the deliberation meter, and flips the status back to
`open` so the discussion continues on top of the real result. Hallucinated
capability ids are dropped (the turn degrades to a plain message).

**Parallel tracks (sub-sessions).** A multi-item agenda doesn't have to be worked
serially. **Split into tracks** runs a Haiku planner that partitions the open
agenda into 2–4 independent tracks (each a focus + its agenda items + key
personas); each becomes a *child* deliberation (`parent_id` set, agenda items
moved in, an optional `roster_ids` scope), and the parent parks at `tracking`.
Tracks are ordinary deliberations, so they advance through everything above (Run
a round / Run to budget / the autonomous tick). Parallelism is real: **Run all
tracks** fires every track's advance concurrently (each is its own command), so K
tracks progress at once, bounded by each track's share of the budget. When all
tracks are terminal, **Merge tracks** synthesizes one combined proposal on the
parent (Sonnet) — the normal Approve & assign gate then takes over. The
one-active-per-team invariant counts only top-level deliberations (`parent_id IS
NULL`), so a parent and its tracks don't collide.

The personas' distinct viewpoints are authored at the **template level** as a
`core` (motivation + stance + typed dials like `riskTolerance` /
`speedVsQuality`), and the team's shared "be #1 in category" motivation as a
`north_star` on the team preset. The SDLC Delivery Team ships with deliberately
divergent cores (product leans ship-to-learn; QA and security lean
verify-first) so the debate is productive rather than bland.

Full design, decisions, and the build phases are in
[`docs/plans/team-deliberation-engine.md`](../plans/team-deliberation-engine.md).

## Commands

`create_team_deliberation` (accepts an optional `cost_budget_usd`),
`list_team_deliberations`, `get_team_deliberation`, `list_deliberation_agenda`,
`list_deliberation_turns`, `advance_team_deliberation` (one on-demand round),
`approve_deliberation_action` / `skip_deliberation_action` (the gated capability
loop), `resolve_deliberation_escalation` (resume / wrap up / abort an escalated
deliberation), `split_team_deliberation` / `list_deliberation_tracks` /
`merge_deliberation_tracks` (parallel tracks), `approve_deliberation_proposal`
(the gated handoff), `dismiss_deliberation_proposal`.
