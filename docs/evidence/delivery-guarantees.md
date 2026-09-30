---
subject: delivery-guarantees
evidence:
  - src-tauri/src/engine/background/                          # atomic-claim tick, two-snapshot stuck reaper, EventGateReason typed non-delivery ledger
  - src-tauri/db/src/repos/communication/events.rs              # conditional-write claim_pending, one-UPDATE reap verdict, bounded retry→dead_letter, TOCTOU-guarded manual redrive w/ lineage
  - src/features/triggers/sub_dead_letter/DeadLetterTab.tsx     # triage surface: failure-mode clustering, filters, bulk retry/discard with per-item typed failure reporting
  - src-tauri/db/src/repos/resources/cloud_webhook_watermarks.rs # restart-safe dedup watermark so upstream redelivery doesn't duplicate
counter_evidence:
  - src-tauri/db/src/audit_incidents_promoter.rs                # the parallel failure inbox: promotes without retry/redrive verbs; the voluminous failure class routes here while the DLQ's class never occurs
deviations:
  - w9-delivery-guarantees   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w2-background-jobs   # claims record no holder/timestamp — anonymous claims force the heuristic two-snapshot reaper (anchor in docs/concepts/golden-path-deferred-fixes.md)
---

# Delivery Guarantees - evidence

How this codebase measures against the [`delivery-guarantees`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
