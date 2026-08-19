---
layer: application
subject: settings
technique: key-registry
stack: rust
---

# Key registry — the `app_settings` allowlist in Rust

How this repo instantiates [key-registry](../techniques/key-registry.md): one
module, `src-tauri/db/src/settings_keys.rs` (~1,570 lines), is the single
authority for the entire key space of the `app_settings` table, and the repo
layer at `src-tauri/db/src/repos/core/settings.rs` is the one door that
enforces it.

## Both ends of the pipe, concretely

**Caller-side constants** — every key is a `pub const`, documented with its
meaning, units, owner, and reader:

```rust
/// Event retention period in days. Events older than this are purged by the
/// cleanup subscription.
pub const EVENT_RETENTION_DAYS: &str = "event_retention_days";
/// Default retention in days for [`EVENT_RETENTION_DAYS`].
pub const EVENT_RETENTION_DAYS_DEFAULT: i64 = 30;
```

Every key is paired with a `<KEY>_DEFAULT` constant, and the module doc makes
the ownership rule explicit: *"Consumers MUST reference the `_DEFAULT`
constant rather than hard-coding a literal, so that 'what does unset mean for
this key?' has exactly one answer."* Units live in the key name itself
(`_DAYS`, `_MS`, `_USD`) — a rename that changes units must change the name.

**Store-side allowlist** — `ALLOWED_KEYS: &[&str]` enumerates every exact
key, and `validate_key` rejects anything else. Crucially it is enforced in
`repos/core/settings.rs::set`, the repo layer, so *internal* Rust callers
(engine subscriptions, companion ticks, the management HTTP API) pass the
same gate as the IPC surface:

```rust
pub fn set(pool: &DbPool, key: &str, value: &str) -> Result<(), AppError> {
    settings_keys::validate_key(key).map_err(AppError::Validation)?;
    settings_keys::validate_value(key, value).map_err(AppError::Validation)?;
    ...
}
```

Reads are deliberately lenient where writes are strict: `get`, `get_batch`,
and `delete` emit a `tracing::warn!` breadcrumb on an unknown key but still
answer — a typo'd or stale frontend reference surfaces in observability as
"settings::get called with unknown key" instead of crashing a panel, while a
typo'd *write* is refused outright.

## The two-list drift, caught in the wild

The technique's warning that the constants and the allowlist "must not be two
vocabularies" is not theoretical here. A comment inside `ALLOWED_KEYS` marks
the scar:

```rust
// Read by engine/deliberation.rs but was missing here, so `set` rejected the
// write and the autonomous-deliberation toggle could never be enabled.
AUTONOMOUS_DELIBERATION,
```

Exactly the signature failure shape the technique predicts: readable
everywhere, unwritable at the door, feature toggle dead on arrival.

## Governed prefix families

Per-entity keys (`auto_rollback:<persona_id>`, `autopilot_mode:<project_id>`,
`cloud_sync_cursor:<table>`) are not free-form: `ALLOWED_PREFIXES` registers
each family, and `validate_key` requires a non-empty suffix of ASCII
alphanumerics plus `-`/`_` — the documented contract being that downstream
subscriptions "can safely strip the prefix and use the suffix as a
persona_id". Each family carries one audit category (`audit_category` maps
`auto_rollback:*` → `autonomy`, `health_watch:*` → `notifications`) and the
bookkeeping families (`cloud_sync_cursor:*`, `team_slack_bridge_cursor:*`)
are excluded from audit as a family. `get_by_prefix` even escapes `%`/`_`
for the `LIKE` scan so `auto_rollback:` cannot match `autoXrollback:` rows.

## Quarantine before reaping

`deprecated_replacement(key)` implements the two-stage retirement: legacy
keys (`autonomous_message_triage`, `autonomous_review_triage`) stay
allow-listed so existing rows and external writers remain harmless, but
`set` emits a `tracing::warn!` naming what superseded them — "value
persisted but no consumer reads it". The stale writer surfaces in
observability; nothing hard-fails.

## What to check before transplanting

- The allowlist gate must sit at the innermost shared write layer, not in
  the IPC command handler — otherwise internal writers bypass it.
- The constants/allowlist pair here is hand-maintained; nothing generates
  one from the other. The deliberation scar shows the cost. A set-equality
  test (or code generation) is the missing hardening this repo would accept.
