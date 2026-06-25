# Team Deliberations ("Design D")

A **deliberation** is a moderated, multi-persona conversation a team holds to make
a decision — and then turn that decision into real work. Where the channel
(Collab) is an open-ended event stream, a deliberation is *bounded*: it has a
topic, a live agenda, and a termination — the team's personas debate from their
distinct points of view, a cheap moderator keeps them on track, and the outcome
is a concrete proposal you approve into a team assignment.

> **Default OFF.** The autonomous moderator that drives a deliberation forward is
> gated behind the `autonomous_deliberation` setting. With it off you can open a
> deliberation and read its state, but it won't run rounds on its own. Turn it on
> (Settings → autonomy) to let the team deliberate unattended.

## Where it lives

Open a team's workspace → the **Deliberate** tab (next to Collab). The surface:

- **Left** — a *Start a deliberation* form (topic + optional desired outcome) and
  the list of the team's deliberations with their status.
- **Right** — the selected deliberation:
  - **Header** — status, the round counter, and a **cost meter** (spend vs.
    budget). There is deliberately *no turn meter*: a deliberation is bounded by
    *progress* (its agenda and a stall limit) and by hard cost / idle floors, not
    by a turn count — so a productive conversation can run as long as it stays
    productive.
  - **Agenda** — the open and resolved items. The agenda is the progress bar: the
    deliberation resolves when the agenda is settled (or the moderator converges).
  - **Conversation** — the persona turns, each speaking from their authored
    *core* (a distinct motivation + stance), expected to push back when a
    proposal conflicts with their point of view.
  - **Proposal / escalation card** — when the team converges, it synthesizes a
    concrete proposal (title + objective + summary). **Approve & assign** hands
    that objective to the team-assignment engine (the same path Athena uses), so
    the deliberation *feeds the deterministic engine* — talk becomes shipped work.
    If the team can't settle it, the card becomes **"Your decision needed"** and
    escalates to you.

## How it works (architecture)

The deliberation plane is a separate, budgeted, **moderated** loop that *emits*
work into the existing execution engine — the LLM never enters the deterministic
execution tick loop (the "C-on-B" doctrine). A cheap Haiku moderator routes the
1–3 most relevant personas each round, curates the agenda, judges progress, and
biases toward action; persona turns run on each persona's own model. Loop safety
comes from the agenda (termination), a stall limit (circularity), rate-shaping
(bounded turns per tick), and hard cost / idle floors — *not* a turn budget.

The personas' distinct viewpoints are authored at the **template level** as a
`core` (motivation + stance + typed dials like `riskTolerance` /
`speedVsQuality`), and the team's shared "be #1 in category" motivation as a
`north_star` on the team preset. The SDLC Delivery Team ships with deliberately
divergent cores (product leans ship-to-learn; QA and security lean
verify-first) so the debate is productive rather than bland.

Full design, decisions, and the build phases are in
[`docs/plans/team-deliberation-engine.md`](../plans/team-deliberation-engine.md).

## Commands

`create_team_deliberation`, `list_team_deliberations`, `get_team_deliberation`,
`list_deliberation_agenda`, `list_deliberation_turns`,
`approve_deliberation_proposal` (the gated handoff), `dismiss_deliberation_proposal`.
