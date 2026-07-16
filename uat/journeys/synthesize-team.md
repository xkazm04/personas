---
id: synthesize-team
title: Build a multi-agent team for a bigger goal
promotion: discovery
primary_contexts: [teams-management, fleet-management, execution-chaining, director-meta-persona]
surfaces: [team, design-reviews]
relevant_characters: [freelance-agency, software-developer, enterprise-admin, hobbyist-power]
---

## Goal (user POV)
"One agent isn't enough — I want a team (e.g. a dev SDLC squad) that hands work between members toward a goal."

## Definition of done
- I synthesized/assembled a team, understood each member's role, and saw how work flows between them.
- I trust it won't silently stall (a disabled member swallowing handoffs, a deadlock).
- I can assign work — either against a goal, or ad hoc via Missions — without needing a dedicated orchestration console that no longer exists.
- I can watch live handoff status via one Monitor surface (Console or Briefing) instead of hunting across retired panes.

## What L1 must check
- Synthesize-team / team-canvas → members → handoff wiring; are roles + flow legible?
- Reachability by tier (Team/Builder) — is this gated above some Characters?
- As of the 2026-07 Teams consolidation: Studio is configuration-only (roster, memory, workspace settings) — "Assign" now lives in the Conversations composer, and the old Orchestration console, Collab pane, and Red Room are retired. Does the journey's expectations still match reality, or does a Character go looking for a surface that's gone?
- Missions (the 4th Goals tab) is the path for goal-less/ad-hoc assignment across teams — is it discoverable from where a Character would naturally look?

## What L2 must confirm (l2_priority)
- A team actually runs and hands off (not a stalled phase).
- Whether Monitor (Console's faceted log, or Briefing's unified conversation stream) communicates health/liveness or hides stalls.
- A disabled/stripped team member produces a visible degraded-run signal (TeamReadinessChip on roster/canvas/goal-table, plus a transcript note) rather than a silent dead-end only findable in the DB.
