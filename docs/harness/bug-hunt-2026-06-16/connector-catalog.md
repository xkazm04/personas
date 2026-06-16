# Bug Hunter — Connector Catalog

> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)
> Context: connector-catalog | Group: Credential Vault & Connectors

## 1. Promote-time readiness is cached on the persona and never recomputed when a credential is deleted, rotated, or fails its healthcheck
- **Severity**: Critical
- **Category**: 🔮 Latent failure / 💀 Silent failure (success theater on "ready")
- **File**: `src-tauri/src/commands/design/build_sessions.rs:2725` (and `:874`, `:2760`); resolver in `src-tauri/src/commands/design/connector_readiness.rs:251`
- **Scenario**: A persona declares a `notion` connector. At promote time `build_persona_setup` runs, `resolve_ready_credential` finds the one usable Notion credential, and the persona is written `setup_status = 'ready'` + an empty-`blockers` `setup_detail`. The user later deletes that Notion credential (or it goes `healthcheck_last_success = false`, or its only field is cleared). Nothing in `commands/credentials/*` (no match for `connector_readiness`/`build_persona_setup`/`setup_status` in that directory) re-evaluates the persona. The persona row still says `ready`.
- **Root cause**: `connector_readiness` resolves against *live* global state, but its verdict is materialized once into `personas.setup_status` / `setup_detail` and treated as durable truth. Credential mutation paths (`credentials::delete`, `save_fields`, healthcheck writes) have no hook to invalidate or recompute dependent personas' readiness.
- **Impact**: A persona promoted as "ready" executes with a connector that resolves to no credential at runtime — exactly the "executes blind" failure the resolver's own comments (lines 281-287, 444-453) were written to prevent. The UI shows a green ready badge; the run fails with an auth error or runs unauthenticated.
- **Fix sketch**: On credential create/delete/field-save/healthcheck-write, recompute `setup_status`/`setup_detail` for every persona whose declared connectors could bind to that credential (or invalidate to a `needs_revalidation` state). Alternatively, recompute readiness lazily on every persona load / before every run rather than trusting the cached column.

## 2. `connector_definitions.name` has no UNIQUE constraint — a custom connector can shadow a builtin and flip its classification/readiness
- **Severity**: High
- **Category**: 🔮 Latent failure (builtin/custom id collision) / Trust boundary (connector definition validation)
- **File**: `src-tauri/src/db/migrations/schema.rs:495` (no UNIQUE on `name`); `src-tauri/src/db/repos/resources/connectors.rs:71` (`create` does no name-existence check)
- **Scenario**: A privileged caller invokes `create_connector` with `name = "codebase"` (or `"notion"`, `"twin"`) and `is_builtin = false`. The table allows it — only `id` is unique. Now two rows share `name = 'codebase'`. `load_connector_metadata` (connector_readiness.rs:189) does `SELECT metadata ... WHERE LOWER(name)=LOWER(?1) LIMIT 1` with no `ORDER BY`, so SQLite returns an arbitrary row. The custom row's metadata (e.g. no `always_active`, an `auth_type`) can win and reclassify `codebase` from `GlobalProbe` to `Credential`, changing what readiness checks and what credential it binds.
- **Root cause**: Connector identity is `name`-keyed throughout readiness/seeding/strategy lookup, but the schema never enforces name uniqueness, and `create` never rejects a colliding/builtin-reserved name. The seed UPDATE is scoped `WHERE name = ?1 AND is_builtin = 1`, so it silently coexists with a shadow row instead of detecting the clash.
- **Impact**: Catalog integrity broken; a shadow definition can silently steer classification, credential binding, and the keyword snapshot. `get_by_name` (`query_row`) also returns only the first of N rows, hiding the duplicate.
- **Fix sketch**: Add a `UNIQUE` index on `LOWER(name)` (or `(name)`), and in `create`/`update` reject names that collide with an existing definition or a reserved builtin name. Make `load_connector_metadata`/`get_by_name` deterministic (`ORDER BY is_builtin DESC` + assert single row).

## 3. Healthcheck-driven readiness ignores credential field staleness vs. last-success timestamp ordering
- **Severity**: High
- **Category**: ⚡ Race condition (readiness racing credential edits) / 💀 Silent failure
- **File**: `src-tauri/src/commands/design/connector_readiness.rs:459` (`credential_is_usable`)
- **Scenario**: A credential's last healthcheck succeeded (`healthcheck_last_success = Some(true)` in the ledger) against an old API key. The user then edits the key field to a new (wrong/typo'd) value via `save_fields` without re-running a healthcheck. `credential_is_usable` sees `field_count > 0` and `healthcheck_last_success != Some(false)` → returns true → connector is "Ready" off a stale success that does not correspond to the current field values.
- **Root cause**: Readiness trusts the *last* healthcheck verdict as a property of the credential, but the verdict is not invalidated when the underlying field values change. There is no comparison of "healthcheck timestamp vs. fields-updated timestamp."
- **Impact**: A credential edited to a broken value is promoted Ready; the run fails at execution. Conversely the inverse (never-probed = allowed) is documented as intentional, but the edited-after-success case is silently wrong.
- **Fix sketch**: In `credential_is_usable`, treat `healthcheck_last_success` as valid only if the healthcheck ran at/after the most recent field mutation; otherwise downgrade to "unverified" (not Ready, or flag for re-probe).

## 4. `simulateRevocation` failover suggestions and revenue total trust unfiltered/unhealthy credentials and unbounded burn rates
- **Severity**: Medium
- **Category**: 🕳️ Edge case / 💀 Silent failure (graph showing misleading relationships)
- **File**: `src/features/vault/sub_dependencies/credentialGraph.ts:298` and `:292`
- **Scenario**: When simulating revocation of a credential, `failoverSuggestions` lists every other credential with the same `service_type` — including ones whose own `healthcheck_last_success === false`. The panel presents an already-broken credential as a viable failover. Separately, `estimatedDailyRevenueLost` sums `dailyBurnRate` across affected personas with no sanity bound; a single corrupted/huge `dailyBurnRate` health signal produces an alarming dollar figure presented as fact.
- **Root cause**: Failover candidates are filtered only by `service_type` and id-inequality, not by health. Burn-rate aggregation has no validation of the upstream signal.
- **Impact**: Operator chasing a revocation incident is steered to a dead failover credential, or shown a wildly wrong "$ lost" number — misleading exactly when decisions are urgent.
- **Fix sketch**: Exclude `healthOk === false` candidates from `failoverSuggestions` (or sort healthy-first and badge unhealthy). Clamp/validate `dailyBurnRate` before summing, and label the revenue estimate as an estimate with its assumptions.

## 5. Empty / non-array `services` and `events` JSON on a connector definition is never validated on create/update
- **Severity**: Low
- **Category**: 🕳️ Edge case (malformed connector def) / Trust boundary
- **File**: `src-tauri/src/db/repos/resources/connectors.rs:71` (`create`) and `:119` (`update`)
- **Scenario**: `create_connector` / `update_connector` accept `fields`, `services`, `events`, `metadata`, `healthcheck_config` as raw `String`s. Only `name`/`label` non-emptiness is checked. A caller can store `fields = "not json"` or `services = "{}"` (object, not the expected array). The value round-trips into the catalog and is only discovered later when a consumer (`parse_tool_name_array`-style readers, the resources picker, prompt assembly) tries to parse it.
- **Root cause**: No JSON-shape validation at the trust boundary; the columns are typed `TEXT` and the repo trusts the input verbatim.
- **Impact**: A malformed definition silently corrupts the catalog and fails far from the source — the connector renders, may even pass classification, then breaks at resource-listing or runtime prompt assembly with an opaque error. Defensive gap rather than an exploit.
- **Fix sketch**: Validate `fields`/`services`/`events`/`resources` parse as JSON arrays and `metadata`/`healthcheck_config` as JSON objects in `create`/`update` before insert, returning `AppError::Validation` on malformed input.
