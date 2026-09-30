---
subject: hitl-approval
evidence:
  - src-tauri/src/engine/build_session/gates.rs                 # per-capability Closed→Pending→Open FSM enforced in code because the model treats the prompt rule as advisory; intent-derived auto-open; batched question synthesis
  - src-tauri/db/src/repos/communication/manual_reviews.rs      # CAS single-winner verdict flip (lost CAS = loud conflict); resolved_at record; verdicts feed the learning loop; keyset-paginated queue + predicate counts
  - src-tauri/src/commands/tools/triggers.rs                    # resolve_pending_trigger_fire — only the CAS winner publishes the held event; unattended mode auto|dry_run|approval set per trigger
  - src-tauri/src/engine/pipeline_executor.rs                   # per-node approval gate; wait-indefinitely poll (the 1-hour cap force-rejected overnight approvals and was removed)
  - src-tauri/src/companion/dispatcher/                       # ALLOWED_ACTIONS allowlist → approval rows; read-only ops auto-fire by design; every write capability requires approval, locked by test
  - src-tauri/engine/src/autonomy.rs                            # the one front door for "may this act unattended" — 13 named actions, fail-closed reads, precedence unit-tested
  - src/features/triggers/sub_triggers/PendingTriggerApprovals.tsx  # the pending-fires decision surface
  - src/features/triggers/sub_triggers/UnattendedModeSection.tsx    # the per-trigger autonomy dial UI
counter_evidence:
  - src/features/shared/components/overlays/FirstUseConsentModal.tsx  # re-opened consent gate initializes from defaults and overwrites a stored refusal on Accept — the re-ask defect the consent technique exists to prevent
deviations:
  - w2-hitl-approval   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Hitl Approval - evidence

How this codebase measures against the [`hitl-approval`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
