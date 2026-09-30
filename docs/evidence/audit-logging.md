---
subject: audit-logging
evidence:
  - src-tauri/db/src/repos/resources/audit_log.rs        # the canonical ledger — one chokepoint, no update/delete, sanitize-on-write, counted best-effort failure
  - src-tauri/db/src/repos/resources/api_key_audit.rs    # per-key count cap enforced inside the insert
  - src-tauri/db/src/repos/execution/provider_audit.rs   # separate ledger per domain, append-only
  - src-tauri/db/src/repos/execution/policy_events.rs    # best-effort domain ledger ("enforcement succeeded; this is just the trail")
  - src-tauri/db/src/audit_incidents_promoter.rs         # origin tagging (source_table) + best-effort promotion that never fails the parent insert
  - src/features/settings/sub_api_keys/components/ApiKeyAuditDrawer.tsx   # in-context per-subject query surface
counter_evidence:
  - src/lib/execution/middleware/auditMiddleware.ts      # named "audit", emits diagnostic log lines, not ledger records — the audit/telemetry boundary blurred in code
deviations:
  - w5-audit-logging   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Audit Logging - evidence

How this codebase measures against the [`audit-logging`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
