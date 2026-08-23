---
layer: application
subject: audit-logging
technique: retention-and-partitioning
stack: rust
---

# Partitioned ledgers with per-domain horizons

The repo runs separate append-only ledgers per domain rather than one
pooled audit table — each with its own repo module, one insert door, and
its own retention shape:

| Ledger | Module | Domain | Retention |
|---|---|---|---|
| `credential_audit_log` | `src-tauri/db/src/repos/resources/audit_log.rs` | credential access (decrypt, CRUD, healthcheck) | 90-day age bound, scheduled sweep |
| `api_key_audit` | `src-tauri/db/src/repos/resources/api_key_audit.rs` | external management-API requests per key | 500-row count cap per key, at insert |
| `provider_audit_log` | `src-tauri/db/src/repos/execution/provider_audit.rs` | model/provider routing, failover, cost | unbounded (aggregated for dashboards) |
| `policy_events` | `src-tauri/db/src/repos/execution/policy_events.rs` | policy enforcement outcomes per execution | tied to execution lifetime |
| CLI session read audit | evicted from `src-tauri/src/engine/subscription/:811-825` | CLI transparency footprint | 24h TTL, scheduled tick |

Obligations genuinely differ — credential access is kept for months, the
CLI transparency trail for a day — and partitioning is what lets each
horizon be stated per ledger instead of averaged.

## The count cap at insert, verbatim

`api_key_audit.rs` is the technique's insert-path form: the module doc
(`:5-7`) says rows "are capped per key on insert (`RETAIN_PER_KEY`) so
the table cannot grow unbounded on a long-lived key";
`RETAIN_PER_KEY = 500` (`:20`), and `insert` (`:26-58`) runs the
`INSERT` and the bounded `DELETE ... NOT IN (SELECT ... ORDER BY at DESC
LIMIT ?)` on the same connection, so admission and expiry are literally
one code path. The scoping is per key — a chatty key trims only its own
history, never a quiet key's evidence. The invariant is pinned by the
test `history_is_capped_per_key` (`:149-160`).

## The age bound as a scheduled sweep — the registered deviation

The credential ledger's 90-day horizon is *not* enforced at insert: the
door exposes `cleanup_old_entries(pool, retention_days)`
(`audit_log.rs:216-226`) and a background maintenance task calls it with
90 (`src-tauri/src/engine/background/:3023-3031`). This is the
technique's named risk shape — a scheduled reaper whose silent death
produces no error, only growth — mitigated here by living inside the
same long-lived maintenance tick as a dozen sibling sweeps, with errors
logged at `error` level. The CLI session audit's TTL eviction takes the
same shape on its own tick (`subscription.rs:811-825`, sharing the
ambient-signal cutoff — "sibling concern, sibling cadence"). The
count-cap ledger shows the insert-path standard; the age-bound ledgers
accept the scheduled shape.

## Origin tagging in two places

- The decrypt records in `credential_audit_log` carry the calling
  subsystem in `detail` via `log_decrypt`'s `caller` parameter
  (`audit_log.rs:191-212`) — "api_proxy", "healthcheck", "db_query" —
  so per-subsystem access counts filter honestly.
- The cross-ledger incidents inbox is fed by per-source promoters
  (`src-tauri/db/src/audit_incidents_promoter.rs`), and every promoted
  row carries `source_table` (`:48`, `:83`) plus a namespaced `kind`
  (e.g. `alert.<metric>`, `:89`) — the aggregate surface can always say
  which ledger a row came from, and a new source shows up as a new tag
  value rather than silently inflating an existing count.

## Common shape across partitions

All ledgers share the core schema the technique asks for — minted id,
door-assigned UTC timestamp, actor (`persona_id` + contemporaneous
`persona_name` snapshot), action/operation token, outcome, and a
correlation handle (`execution_id` on `provider_audit_log` and
`policy_events`) — which is what lets the incidents inbox and the
overview surfaces merge them into one timeline without the ledgers
sharing storage or policy.
