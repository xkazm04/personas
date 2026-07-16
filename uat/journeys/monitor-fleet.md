---
id: monitor-fleet
title: Watch and steer multiple concurrent CLI sessions (Fleet)
promotion: discovery
primary_contexts: [fleet-management]
surfaces: [team, personas]
relevant_characters: [hobbyist-power, software-developer]
---

## Goal (user POV)
"I've got several agent sessions running at once. I want one screen that shows me which ones need me, and I want to be able to nudge or park them without babysitting N terminals."

## Definition of done
- I spawned more than one session and could see, at a glance, which are running, which are stalled/awaiting input, and which finished — without opening each one.
- I could broadcast a message to multiple sessions and hibernate/wake a session, and the state round-tripped correctly.
- The live-slot concurrency cap never silently killed work in progress — it queued or told me, it didn't just drop it.

## What L1 must check
- Reachability: Fleet is `dev`-build-only / experimental — confirm which Characters can actually reach it (only dev/builder-tier Characters; not a shipped-tier non-technical Character), and don't attribute a Fleet finding to someone who can't open it.
- Spawn → grid tile → per-session status path: does a stalled/awaiting-input session visibly differ from a healthy running one, or do they look identical until clicked?
- The live-slot cap and headless stream-json lane (added 2026-07-13): does the surface model show what happens when the cap is hit — queue, reject, or silent kill?

## What L2 must confirm (l2_priority)
- Spawn several real sessions concurrently and confirm each reaches Running, then drive one into an awaiting-input state and confirm the grid surfaces it without polling/refreshing.
- Broadcast a message to multiple live sessions and confirm all of them actually receive it (not just the ones open in a tab).
- Hibernate a session mid-work and wake it — confirm it resumes rather than losing state.
- Hit the live-slot cap deliberately with concurrent spawns — confirm in-progress work is never silently killed.
