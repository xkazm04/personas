---
subject: webhook-ingestion
evidence:
  - src-tauri/src/engine/webhook.rs                              # direct listener: mandatory HMAC fail-closed on missing secret (:373-428), constant-time verify with dummy-decode equal-path (:537-559), 1MB body cap (:69,:75), per-trigger tier-aware rate limit (:331-360), graceful shutdown via watch channel (:84-89), log-every-delivery regardless of verdict (:260-273), 422+Retry-After for the retryable refusal class (:430-466)
  - src-tauri/src/engine/smee_relay.rs                           # relay/SSE mouth: bounded SSE buffer (1MB), reconnect backoff with stability reset, dedup ladder (SSE id > sender delivery id > content hash, bounded FIFO 512), Last-Event-ID resume, fail-closed on malformed filter config
  - src-tauri/src/engine/cloud_webhook_relay.rs                  # polling mouth: bounded fetch page with hit-cap warning, per-call timeout + semaphore fan-out cap
  - src-tauri/db/src/repos/resources/webhook_log.rs              # delivery record: 100-per-trigger retention cap enforced by the writer (every 10th insert)
  - src-tauri/src/commands/tools/triggers.rs                     # replay_webhook_request (:1775): re-signs the recorded body with the current secret and re-enters through the live endpoint — replay through the same admission door; webhook_request_to_curl (:1836): export for reproduction
  - src-tauri/db/src/repos/resources/cloud_webhook_watermarks.rs # BOUNDARY: durable restart-safe delivery watermarks — delivery-guarantees' ground; cited as the hand-off artifact, not owned here
counter_evidence:
  - src-tauri/src/engine/smee_relay.rs                           # ALSO the key counter-example: relay authenticity is OPT-IN and fail-OPEN by default (env-var secret unset ⇒ accept unauthenticated), and verification hashes a re-serialized body, not the sender's raw bytes — both documented in-file as deliberate deferrals
deviations:
  - w9-webhook-ingestion   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Webhook Ingestion - evidence

How this codebase measures against the [`webhook-ingestion`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
