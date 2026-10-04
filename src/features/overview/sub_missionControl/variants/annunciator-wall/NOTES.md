# Annunciator Wall

## The dimensions

Eight operator questions found under the section list (shared with tense-horizon, cut differently there):

- **Outcomes** - are runs succeeding? `MissionControlHome.tsx:105` (success rate), `:255` (daily points)
- **Agents** - is any agent struggling? `sections/MissionStatusMonitor.tsx:47` (`useStatusPageData` grades)
- **Waiting on you** - reviews, alerts, memory, reports. `MissionControlHome.tsx:252-254`, `:308`
- **Self-healing** - open issues, auto-paused, fixes held. `cards/FleetOptimizationCard.tsx:241`, `sub_health/components/heartbeats/HealingEffectivenessPanel.tsx:47`
- **Spend** - cost, burn, anomaly days. `cards/FleetOptimizationCard.tsx:245`, `libs/fleetOptimizer.ts:231`
- **Autonomy** - scheduled routines + attention loop. `cards/UpcomingRoutinesCard.tsx:53`, `cards/AttentionLoopCard.tsx:52`
- **Vault** - failed rotations, audit events. `cards/VaultActivityCard.tsx:75`
- **Instruments** - is this page itself up to date? `MissionControlHome.tsx:281`

Leaderboard, heatmap, trend and ticker are not dimensions; they are evidence and live in layer 2.

## Layer 1

A 4x2 wall of kit `Tile`s, one annunciator per question: lamp, state word, one big figure, a drawn trace, one line of evidence. It bets that the operator wants every subsystem at equal weight and lets colour do the triage: a steady cell goes quiet, a cell that needs you lights its whole band.

## Layer 2

A swap. Choosing a lamp folds the wall into a rail of the same eight lamps down the left (still lit, still keyed) and the dimension's detail takes the rest of the window. Crumbs and Esc go back; 1-8 jump; Up/Down walk the rail. The rail is why: you never lose sight of the other seven while you read one.

## What makes this different from my other two

Equal-weight grid of subsystems; detail replaces the wall. tense-horizon sorts by time and keeps layer 1 beside the detail; agent-lattice sorts by agent and drills.

## The drop-in line

`src/features/overview/sub_missionControl/index.ts:5` becomes:
`export { default } from './variants/annunciator-wall/AnnunciatorWall';`

## Known limits

- Layer 2 was verified by type and lint only; the harness shoots layer 1.
- "Waiting on you" is gated on the alert-history fetch; review/report counts have no settled flag in the store, so before that fetch they show "Measuring", not 0.
- The four card sources (loop, triggers, vault, healing ledger) are read once more for the layer-1 headline; opening their detail mounts the original cards, which fetch again.
- The success rate (65%, from the loaded executions) and the optimizer's 93% (dashboard totals) disagree on the tape; that is the baseline's own discrepancy, kept, not fixed.
