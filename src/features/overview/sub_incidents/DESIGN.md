# `sub_incidents` — Cross-Source Incidents Inbox (DESIGN)

> **Status:** design proposal · awaiting user approval before implementation.
> **Source:** `/research` run on 2026-04-30 (PokeeClaw walkthrough — Approach B from the three-approach scan).
> **Scope:** new top-level Overview panel that promotes failure-shaped audit rows from 7 existing streams into a single triage inbox with `open → acknowledged → resolved` lifecycle.

---

## 1. Why this lives in its own `sub_*` folder

Per `src/features/overview/README.md`, the Overview module already has a clear three-tier taxonomy:

- `sub_realtime` — live event bus (in-memory)
- `sub_events` — persisted event log (queryable, generic)
- `sub_observability` — trace + healing + metrics (root-cause)

The decision rubric in that README ends with: *"None of the above? Add a new `sub_<domain>/` folder. Do not pile it into `sub_realtime`, `sub_events`, or `sub_observability` because it kind of fits."*

An incidents inbox is **none of those tiers**. It is a *triage workflow* over already-persisted failure-shaped rows — closer to a specialized projection of `sub_events` + `sub_observability` than either alone. It belongs in its own folder so the lifecycle state (`open → acknowledged → resolved`) lives next to the UI that drives it, and so the existing `HealingIssuesPanel.tsx` (which is healing-table-specific by design) is not generalized into something it isn't.

User question this folder answers: *"Across all my personas, what failed and what still needs my attention?"*

This is distinct from:
- `sub_realtime` — *"What is firing right now?"* (no lifecycle, fades in seconds)
- `sub_events` — *"Find me the event where X happened yesterday."* (browsable history, no actions)
- `sub_observability` — *"What went wrong on this trace and is the healer fixing it?"* (per-execution / per-trace, healing-coupled)
- `sub_incidents` (this) — *"What's still open across the fleet, and let me ack/resolve it."*

---

## 2. The 7 source streams

The codebase already has 7 audit-shaped tables. None will be replaced; all stay where they are. This design adds a single `audit_incidents` table that **only stores promoted rows** (severity-worthy failures), with stable `dedup_key`s pointing back to the source row.

| # | Source table | Insert site | Promotion rule | Default severity |
|---|---|---|---|---|
| 1 | `fired_alerts` | `db/repos/communication/alert_rules.rs:232` | every row | row's `severity` |
| 2 | `tool_execution_audit_log` | `db/repos/resources/tool_audit_log.rs:27` | `result_status = 'error'` | `medium` |
| 3 | `credential_audit_log` | `db/repos/resources/audit_log.rs:32` + `commands/credentials/foraging.rs:654` | `operation` is a failure (`*_error`, `decrypt_failure`) | `high` (credentials are sensitive) |
| 4 | `healing_audit_log` | `db/repos/execution/healing.rs:392` + `engine/ai_healing.rs:285` | `event_type` matches `*_error` or `ai_heal_unknown_*` | `medium` |
| 5 | `provider_audit_log` | `db/repos/execution/provider_audit.rs:16` | `was_failover = 1` | `low` (informational, but visible) |
| 6 | `policy_events` | `db/repos/execution/policy_events.rs:36` | `action = 'dropped'` | `low` (configurable) |
| 7 | `persona_healing_issues` | already managed by `HealingIssuesPanel` | every row with `status = 'open'` and `severity >= medium` | row's `severity` |

Pure successes never become incidents. The promotion rule for each source is intentionally **conservative** to avoid an inbox flood; per-source severity floors are tunable from a settings panel (deferred until v2).

**Non-source:** `obsidian_sync_log` is intentionally excluded — sync conflicts already have their own UI in `obsidian-brain` and would generate hundreds of low-value rows here.

---

## 3. Schema decision — new table, not extension

We add a new `audit_incidents` table rather than extending `persona_healing_issues`.

**Why:** `persona_healing_issues` has healing-specific columns (`is_circuit_breaker`, `auto_fixed`, `suggested_fix`, `category`) that do not generalize. Adding a `source_table` column would drift the table's semantics and force every existing healing-only consumer to handle non-healing rows. Keep the narrow table narrow.

### `audit_incidents` schema (proposed migration)

```sql
CREATE TABLE IF NOT EXISTS audit_incidents (
    id              TEXT PRIMARY KEY,                -- uuid
    source_table    TEXT NOT NULL,                   -- 'fired_alerts' | 'tool_execution_audit_log' | ... (7 values)
    source_id       TEXT NOT NULL,                   -- id of the row in source_table
    dedup_key       TEXT NOT NULL UNIQUE,            -- "{source_table}:{source_id}" (idempotent insert)
    persona_id      TEXT,                            -- nullable: alerts can fire without a persona
    persona_name    TEXT,                            -- denormalized at promotion time (no join on read)
    execution_id    TEXT,                            -- nullable: not all sources have one
    severity        TEXT NOT NULL,                   -- 'low' | 'medium' | 'high' | 'critical' (normalized)
    kind            TEXT NOT NULL,                   -- short machine token: 'tool_error', 'credential_decrypt_failure', etc.
    title           TEXT NOT NULL,                   -- one-line human summary at promotion time
    detail          TEXT,                            -- optional longer payload (JSON or free text)
    status          TEXT NOT NULL DEFAULT 'open',    -- 'open' | 'acknowledged' | 'resolved' | 'dismissed'
    acknowledged_at TEXT,
    acknowledged_by TEXT,                            -- 'user' (single-user app) or future 'auto-triage'
    resolved_at     TEXT,
    resolution_note TEXT,                            -- free-form, written by user on resolve/dismiss
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ai_status   ON audit_incidents(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_persona  ON audit_incidents(persona_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_severity ON audit_incidents(severity, status);
CREATE INDEX IF NOT EXISTS idx_ai_source   ON audit_incidents(source_table, source_id);
```

### Why `dedup_key`

Two promotion paths can fire for the same source row (e.g., a healer that retries on app restart, or a backfill running concurrently with live writes). The `UNIQUE(dedup_key)` constraint paired with `INSERT OR IGNORE` on the write side gives idempotent promotion at zero coordination cost. The `(source_table, source_id)` shape makes the key human-readable in logs.

### Why denormalize `persona_name`

The inbox renders rows in lists 50+ at a time. Joining `personas` per row is wasteful when the name is stable. Promotion-time denormalization is a one-time read; if a persona is renamed, existing incidents keep the old name (acceptable — they're historical).

### Severity normalization

Source severities are inconsistent:
- `fired_alerts`: `warning` | `critical`
- `persona_healing_issues`: `low` | `medium` | `high` | `critical`
- `tool_execution_audit_log`: implicit (we map `result_status='error'` → `medium`)
- `credential_audit_log`: implicit (we map credential failures → `high`)
- `provider_audit_log`: implicit (failover → `low`)
- `policy_events`: implicit (drops → `low`)
- `healing_audit_log`: implicit (errors → `medium`)

The normalization map lives in **one place** — `src-tauri/src/db/repos/execution/incidents.rs::normalize_severity()` — and is documented in `codebase-stack.md` after this lands. Mapping rule: `warning → medium`; `error/failure → high` unless the source documents otherwise; pure informational → `low`.

---

## 4. Backend layout

```
src-tauri/src/
├── db/
│   ├── models/
│   │   └── audit_incident.rs                ← new (AuditIncident, CreateAuditIncidentInput, IncidentStatus enum)
│   ├── migrations/
│   │   └── incremental.rs                    ← new migration block (table + indexes)
│   └── repos/
│       └── execution/
│           └── audit_incidents.rs            ← new (CRUD + promote_from_source + dedup logic + normalize_severity)
├── commands/
│   └── execution/
│       └── audit_incidents.rs                ← new IPC commands (list, count_open, acknowledge, resolve, dismiss, backfill)
└── engine/
    └── audit_incidents_promoter.rs           ← new helper module: 7 promote_*() functions, one per source

```

### IPC surface (commands)

| Command | Auth | Notes |
|---|---|---|
| `list_audit_incidents(filters: IncidentFilters, limit, offset)` | `require_auth` | filters: status[], severity[], source_table[], persona_id, since |
| `get_audit_incidents_summary()` | `require_auth` | returns `{ open, acknowledged, by_severity, by_source }` for the inbox header KPIs |
| `acknowledge_audit_incident(id)` | `require_auth` | sets `status='acknowledged'`, `acknowledged_at=now`, `acknowledged_by='user'` |
| `resolve_audit_incident(id, resolution_note)` | `require_auth` | sets `status='resolved'`, `resolved_at=now` |
| `dismiss_audit_incident(id, resolution_note)` | `require_auth` | sets `status='dismissed'`, `resolved_at=now` |
| `bulk_acknowledge_audit_incidents(ids[])` | `require_auth` | for selected-rows actions |
| `bulk_resolve_audit_incidents(ids[], resolution_note)` | `require_auth` | for selected-rows actions |
| `backfill_audit_incidents(since: Option<String>)` | `require_privileged_sync` | one-time historical promotion; reports progress via Tauri event |
| `delete_resolved_audit_incidents_older_than(days)` | `require_privileged_sync` | retention pruning (manual until v2 adds a scheduled job) |

Privileged commands use the existing `require_privileged_sync` pattern (see `byom.rs:62`) so backfill/prune are gated.

### Where promotion fires

Each existing INSERT site becomes an INSERT-and-promote pair:

```rust
// db/repos/resources/tool_audit_log.rs (illustrative)
pub fn record(...) -> Result<(), AppError> {
    // ... existing INSERT into tool_execution_audit_log ...
    if entry.result_status == "error" {
        // best-effort; never fails the parent insert
        let _ = audit_incidents::promote_tool_error(pool, &entry);
    }
    Ok(())
}
```

The promoter is a thin wrapper — it builds the `CreateAuditIncidentInput` from the source row and calls the repo's `INSERT OR IGNORE`. Errors are swallowed and logged via `tracing::warn` per the existing best-effort pattern (mirrors how `hooks_sidecar` and `claude_md_projection` handle their write paths).

**Test-run guard** (per Hermes-run rule from skill iteration log 2026-04-14): the promoter MUST be a no-op during test/lab/eval/evolution/arena executions. Two safe patterns:
1. Reuse whatever existing predicate marks test runs in the runner context (grep `is_test|is_simulation|test_runner` first to find the canonical signal).
2. If no predicate exists, gate behind a feature flag `PERSONAS_INCIDENTS_PROMOTION=1` (default-off during the bake-in window — same pattern as `PERSONAS_HOOKS_SIDECAR`).

### Realtime emission

When an incident is promoted, emit a Tauri event:

```rust
emit_to(emitter, event_name::INCIDENT_OPENED, &IncidentOpenedEvent {
    incident_id, severity, source_table, persona_id, persona_name, title, created_at
});
```

The frontend `useStructuredStream` (or a sibling `useIncidentStream`) subscribes and updates the inbox without polling. Event registry triplet update required (see `codebase-stack.md` Section 2 "Two parallel stream channels"):
1. `engine/types.rs::StructuredExecutionEvent` — new variant
2. `src/lib/types/terminalEvents.ts` — TS interface + union member
3. `src/lib/eventRegistry.ts::ExecutionEventPayload` — TS discriminated-union member

Skipping the third file silently drops the event in the chat surface (run history at 2026-04-25 confirms this).

### Backfill

`backfill_audit_incidents(since)` runs the promotion logic against historical rows in each source table (LEFT JOIN against `audit_incidents.dedup_key` to skip already-promoted). Reports progress via a Tauri event so the UI can show a progress bar. Default `since` is 7 days — tunable. Backfill is **opt-in** (a button in the inbox header reading "Backfill last 7 days from existing audit logs"); we do NOT auto-backfill on first launch because users with large histories would see a multi-second freeze.

---

## 5. Frontend layout

```
src/features/overview/sub_incidents/
├── DESIGN.md                                 ← this file
├── index.ts                                  ← re-exports
├── components/
│   ├── IncidentsInbox.tsx                    ← top-level panel (filters + list + KPI header)
│   ├── IncidentsInboxKpiHeader.tsx           ← open / ack / resolved / by-severity tiles
│   ├── IncidentsFilterBar.tsx                ← status, severity, source, persona, time-range filters
│   ├── IncidentRow.tsx                       ← single row in the list
│   ├── IncidentDetailModal.tsx               ← drill-down with source row + actions
│   ├── IncidentBulkActions.tsx               ← multi-select toolbar
│   ├── IncidentBackfillBanner.tsx            ← "Backfill last 7 days?" prompt for first-time users
│   └── IncidentSourceBadge.tsx               ← visual chip per source_table
└── libs/
    ├── useIncidentsData.ts                   ← list + summary fetcher with cache + realtime subscription
    ├── useIncidentActions.ts                 ← ack / resolve / dismiss / bulk handlers
    └── incidentTaxonomy.ts                   ← severity → color, source → label, kind → icon (uses existing SEVERITY_COLORS)
```

**Anti-pattern compliance** (per `src/features/overview/README.md`):
- ✅ Reuse `SEVERITY_COLORS` from `@/lib/utils/formatters` — do NOT redefine.
- ✅ Reuse `eventVisuals.ts` from `src/features/overview/shared/` for source-table colors where they overlap.
- ✅ NO feature-scoped `i18n/` folder — strings go to `src/i18n/locales/en.json` under a new `incidents` group.
- ✅ NO span-tree rendering or trace-engine calls — those belong in `sub_observability`. The detail modal links to the trace if `execution_id` is present, it does not embed it.

### UI sketch (text)

```
┌────────────────────────────────────────────────────────────────────────┐
│  Incidents                                                  [Refresh]  │
│                                                                        │
│  ┌────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐  │
│  │  12    │  │   3      │  │   42     │  │ severity:               │  │
│  │  Open  │  │  Critical│  │ Resolved │  │  ●●●●● 4 critical · ... │  │
│  └────────┘  └──────────┘  └──────────┘  └──────────────────────────┘  │
│                                                                        │
│  [Backfill last 7 days from existing audit logs]   ← shown once        │
│                                                                        │
│  Filters:  [All][Open][Acked][Resolved]  [All severities▼]  [Source▼] │
│            [Persona: any▼]  [Last 24h▼]                                │
│                                                                        │
│  ☐ Critical · Decrypt failed for slack credential                      │
│      persona: marketing-bot · 2 min ago · credential_audit_log         │
│      [Ack] [Resolve] [Dismiss]                              [Open ▶]   │
│  ─────────────────────────────────────────────────────────────────────  │
│  ☐ High · Tool 'http_get' returned 403                                 │
│      persona: news-summarizer · 14 min ago · tool_execution_audit      │
│      [Ack] [Resolve] [Dismiss]                              [Open ▶]   │
│  ─────────────────────────────────────────────────────────────────────  │
│  ☐ Medium · Healing run could not classify failure                     │
│      persona: code-reviewer · 1 h ago · healing_audit_log              │
│      [Ack] [Resolve] [Dismiss]                              [Open ▶]   │
└────────────────────────────────────────────────────────────────────────┘
```

Selecting checkboxes activates `IncidentBulkActions` for ack/resolve/dismiss across all selected rows.

### i18n keys (all new, under `overview.incidents`)

The keyset goes into `src/i18n/locales/en.json` and the codegen runs once. Non-English locales fall back via deep-merge per project policy.

```jsonc
"overview": {
  "incidents": {
    "title": "Incidents",
    "kpi_open": "Open",
    "kpi_critical": "Critical",
    "kpi_resolved": "Resolved",
    "filter_status_all": "All",
    "filter_status_open": "Open",
    "filter_status_acknowledged": "Acked",
    "filter_status_resolved": "Resolved",
    "filter_status_dismissed": "Dismissed",
    "filter_severity_label": "All severities",
    "filter_source_label": "Source",
    "filter_persona_label": "Persona",
    "filter_persona_any": "any",
    "action_acknowledge": "Ack",
    "action_resolve": "Resolve",
    "action_dismiss": "Dismiss",
    "action_open_detail": "Open",
    "bulk_acknowledge_count": "Ack {count}",
    "bulk_resolve_count": "Resolve {count}",
    "backfill_banner": "Backfill last 7 days from existing audit logs",
    "backfill_running": "Promoting historical rows… {done}/{total}",
    "empty_state_open": "No open incidents — fleet is healthy.",
    "empty_state_filtered": "No incidents match the current filters.",
    "resolved_at": "Resolved {when}",
    "resolution_note_placeholder": "What did you do? (optional)"
  }
}
```

Severity tokens reuse `tokenLabel(t, 'severity', row.severity)` via `src/i18n/tokenMaps.ts` — already wired for `low/medium/high/critical`. Do NOT duplicate severity strings here.

Source-table tokens are new — add `status_tokens.incident_source` group with `fired_alerts → "Alert"`, `tool_execution_audit_log → "Tool"`, etc., and resolve via `tokenLabel(t, 'incident_source', row.source_table)`.

---

## 6. Routing into the Overview sidebar

The Overview module's left sidebar already lists `sub_*` panels. Add `incidents` between `health` and `observability` so the visual grouping stays intuitive (status → incidents → traces). The wiring touches:

- `src/features/overview/components/OverviewSidebar.tsx` (or wherever `SidebarSection` is built — grep first; the entry needs a Lucide icon, label key, and route)
- `src/lib/types/types.ts` (the `OverviewTab` union — add `'incidents'`)
- The router that mounts the panel

If a badge count for unresolved incidents is desired, the sidebar reads `useOverviewStore(s => s.incidentsOpenCount)` — populated by the same hook that drives the KPI tiles.

---

## 7. Migration & rollout plan

1. **Schema migration** lands first. New table + indexes via `incremental.rs`. No write-path changes yet; `audit_incidents` is empty.
2. **Promoter module** lands next, gated behind `PERSONAS_INCIDENTS_PROMOTION=1`. Tests cover each promotion rule + dedup behavior.
3. **Read-only IPC + UI** lands third — list, filter, KPI, detail modal — without lifecycle actions. Behind a hidden settings toggle for early users.
4. **Lifecycle actions** (ack / resolve / dismiss / bulk) ship next.
5. **Backfill button** ships last, after real-world data has flowed for a week and we know typical row counts.
6. **Default-on** the env flag once #1–5 are validated. (Same default-off-then-on pattern as `hooks_sidecar`.)

Each step is its own PR with `research:` prefix per the project's commit conventions.

---

## 8. Risks & open questions

| Risk | Mitigation |
|---|---|
| Inbox flood from over-aggressive promotion rules. | Conservative defaults (only failure-shaped rows). Per-source severity floor configurable in v2. Backfill is opt-in. |
| Test runs writing real incidents and corrupting evaluation. | Test-run guard mandatory at every promote site. Default-off env flag during bake-in. |
| `dedup_key` collision under concurrent inserts. | `UNIQUE` constraint + `INSERT OR IGNORE` is safe under SQLite WAL. No app-side coordination needed. |
| Severity normalization wrong (high-sev events misclassified as low). | Centralize the map in `normalize_severity()` with unit tests per source. Document the mapping in `codebase-stack.md` Section "Memory layers / audit streams" so future runs find it. |
| Realtime event registry triplet drift (Rust → TS terminal events → TS event registry) — silent dropouts in chat. | Update all three files in lockstep per `codebase-stack.md` Section 2 rule. Reviewer checklist item. |
| Backfill freeze on large histories. | Stream progress via Tauri event; chunk by 500 rows; user-initiated only. |
| Two competing UIs (incidents inbox + healing issues panel) confuse users. | Healing panel stays scoped to `persona_healing_issues` — it's the deep-dive for healing specifically. Incidents inbox is the cross-source overview. Document the boundary in this README and in CLAUDE.md. |

**Open question 1:** should `persona_healing_issues` be promoted as a 7th source (current design) or remain its own surface? Two-source overlap is fine if the inbox shows them with a badge linking to `HealingIssuesPanel` for the deep-dive.

**Open question 2:** auto-resolve policy. Should incidents be auto-resolved when the underlying condition clears (e.g., `fired_alert` row dismissed → matching incident resolved)? Out of v1 scope; revisit after lifecycle ships.

**Open question 3:** retention. `audit_incidents` will grow unbounded. v1 has a manual `delete_resolved_audit_incidents_older_than` privileged command; v2 should add a scheduled job (default 90 days). Out of v1 scope.

---

## 9. Effort & validation

**Estimated effort:** 3-4 days of focused work, splittable into 5 PRs (per the rollout steps).

**Validation per PR:**
- Schema PR → `cargo test --lib audit_incidents` (CRUD round-trip), `cargo check`.
- Promoter PR → unit test per source (7 tests), test-run-guard test, dedup test.
- IPC + UI read PR → `npx tsc --noEmit`, `npm run lint`, manual smoke (filter combinations).
- Lifecycle PR → unit tests for ack/resolve/dismiss state transitions, bulk-action tests.
- Backfill PR → integration test with synthetic 1k-row dataset, progress-event assertion.

Each PR is independently revertable; the env-flag default-off keeps production behavior unchanged until step 6.

---

## 10. Cross-references

- `src/features/overview/README.md` — sub-folder taxonomy and decision rubric (this folder is a Step 5 "new domain").
- `src-tauri/src/db/models/healing.rs` — `PersonaHealingIssue` struct (the inspiration for the lifecycle vocabulary; do not extend it).
- `src/features/overview/sub_observability/components/HealingIssuesPanel.tsx` — UX precedent for severity-based row rendering and ack/resolve actions; reuse the visual language but not the data path.
- `src-tauri/src/engine/hooks_sidecar.rs` — best-effort + env-gated pattern that the promoter follows.
- `src-tauri/src/engine/claude_md_projection.rs` — second precedent for the same env-gate / best-effort shape.
- `.claude/codebase-stack.md` Section 2 — structured event registry triplet rule (Rust → terminalEvents.ts → eventRegistry.ts).
- `src/i18n/CONTRACT.md` — i18n four-layer model (this design follows it: machine tokens at Rust, English at en.json).

---

**Next step (when approved):** ship PR 1 (schema migration). It is self-contained, reverts cleanly, and unblocks the rest.
