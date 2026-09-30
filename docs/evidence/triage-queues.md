---
subject: triage-queues
evidence:
  - src/features/agents/quick-answer/triage/useUnifiedTriage.ts    # seven-source fusion: adapters, per-source failure ledger, capped-source honesty, optimistic verdicts with restore, CAS-conflict-as-decided
  - src/features/agents/quick-answer/triage/triageQueue.ts         # pure projection: removal-not-index cursor, bounded skip that stands down but stays counted, progress denominator = decided + pending
  - src/features/agents/quick-answer/triage/deck/useDeckControls.tsx  # focus deck: keyboard/gesture verdicts, in-flight lock doubling as the queue, watchdog against a wedged deck
  - src/features/companions/athena/inbox/hooks/useUnifiedInbox.ts  # four-source read-model merge through per-source adapters, newest-first, capped scan surface
  - src/features/overview/sub_incidents/libs/incidentTaxonomy.ts   # nine source tables normalized to one row shape: severity rank, per-source label/icon/guidance
  - src/features/fleet/monitor/grid/fleetGridModel.ts              # the actionable predicate in code (actionBadges / dominantBadge, moved here 2026-08-26 from the retired triage/triageModel.ts, deleted 2026-09-02): failed/review/input/draft counts admit; running-or-queued alone is "busy", hidden
  - src/features/overview/sub_manual-review/hooks/useManualReviewQueue.ts  # badge counts and rows derived from the same server-side filtered source (counts layer + keyset pages)
counter_evidence:
  - src-tauri/db/src/repos/dev_tools.rs   # pending_counts: a hand-enumerated registry of 6 human-decision queues while 13 exist — 314 of 370 waiting items (84.9%) invisible to the badge; the registry-completeness failure this subject warns about
deviations:
  - w4-triage-queues   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-hitl-approval   # the 7-day auto-RESOLVE sweep writes the human verdict vocabulary and takes exactly the population the other exit policy protected — registered in golden-path-deferred-fixes.md
---

# Triage Queues - evidence

How this codebase measures against the [`triage-queues`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
