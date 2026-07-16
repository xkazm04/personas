# tauri:db/models [1/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 5 findings (0 critical / 0 high / 3 medium / 2 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Trigger config is decrypted + JSON-parsed multiple times per trigger evaluation
- **Severity**: Medium
- **Lens**: perf-optimizer
- **Category**: repeated-parse
- **File**: src-tauri/src/db/models/trigger.rs:516
- **Scenario**: The scheduler/lifecycle tick evaluates every enabled trigger. `parse_active_window()` (line 531) and `parse_config()` (line 549) each independently call `decrypted_config_json()`, which runs `crypto::decrypt_trigger_config` and then a full `serde_json::from_str`. A tick that checks `is_within_active_window()` and then reads the typed config performs the decrypt + parse twice per trigger, every tick, forever.
- **Root cause**: The doc comment on `TriggerConfig` says "call once, reuse everywhere," but the API shape makes the decrypt-and-parse private and per-accessor — `ActiveWindow` and `TriggerConfig` are extracted through separate entry points with no shared decrypted/parsed intermediate.
- **Impact**: Redundant AES decryption + JSON parsing on the hottest recurring loop in the backend (scheduler tick × trigger count). Bounded per call, but it is pure waste that scales linearly with trigger count and tick frequency.
- **Fix sketch**: Add a single `parse_all(&self) -> ParsedTrigger { config: TriggerConfig, active_window: Option<ActiveWindow> }` (or make `parse_config` also extract `active_window` from the same decrypted `serde_json::Value`), and have `is_within_active_window` take the pre-parsed struct. Callers on the tick path decrypt/parse exactly once per trigger per tick. Verification needed for call sites in `engine::lifecycle`/scheduler (cross-context).

## 2. ~12 hand-rolled Display/FromStr/as_str enum boilerplate blocks duplicated across model files
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/models/persona.rs:17
- **Scenario**: Adding a variant to any status/kind enum requires touching 3–4 hand-written match blocks per enum; a missed arm compiles fine for `FromStr` (falls into the error/fallback arm) and silently misroutes data. The pattern repeats in persona.rs (PersonaTrustLevel, PersonaGatewayExposure, PersonaTrustOrigin, PersonaLifecycle), observability.rs (AlertMetric, AlertOperator, AlertSeverity), automation.rs (AutomationPlatform, AutomationFallbackMode, AutomationRunStatus — each ALSO with byte-identical `rusqlite::FromSql`/`ToSql` impls), trigger.rs (ChainConditionType), lab.rs (LabRunStatus, LabResultKind), review.rs (ManualReviewStatus), team_assignment.rs (3 enums), build_session.rs (BuildPhase).
- **Root cause**: Each enum re-implements the same snake_case string mapping by hand instead of a shared derive/macro; automation.rs additionally repeats the same 8-line FromSql/ToSql bridge three times verbatim.
- **Impact**: Hundreds of lines of mechanical boilerplate across the models module; every mapping is a fresh chance for string drift between `as_str`, `FromStr`, and the `#[serde(rename_all)]` wire format (three sources of truth per enum today).
- **Fix sketch**: Introduce one small declarative macro (or adopt `strum`'s `Display`/`EnumString` with `serialize_all = "snake_case"`) generating `as_str`/`Display`/`FromStr` from a single variant→token list, plus a second macro for the rusqlite `FromSql`/`ToSql` pair. Mechanical migration, no behavior change; keep the few enums with custom fallbacks (`LabRunStatus::from_db` unknown→Failed) as explicit wrappers.

## 3. GlobalExecutionRow duplicates PersonaExecution field-for-field (~25 fields)
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/models/execution.rs:136
- **Scenario**: `GlobalExecutionRow` is `PersonaExecution` minus 5 fields plus 3 joined persona columns, copy-pasted — including the identical 6-line ts-rs workaround comment for `execution_flows`. Adding a column to executions (as `thinking_level`, `business_outcome`, `is_simulation` were) means editing two structs and two row-mappers; `director_score`/`director_review_md` and the cache-token fields already exist only on `PersonaExecution`, showing the drift has begun.
- **Root cause**: The JOIN result was modeled as a second full struct instead of composing the base row.
- **Impact**: ~90 duplicated lines and a guaranteed future desync between the per-persona and global execution views (the cache/director fields are already invisible in the global listing).
- **Fix sketch**: Restructure as `struct GlobalExecutionRow { #[serde(flatten)] #[ts(flatten)] execution: PersonaExecution, persona_name: Option<String>, persona_icon: Option<String>, persona_color: Option<String> }` — the same flatten pattern lab.rs already uses for `LabResultBase`. Update the one row-mapper in the executions repo; the wire JSON stays flat and identical.

## 4. Duplicated timezone-resolution blocks in ActiveWindow
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/models/trigger.rs:169
- **Scenario**: `is_active_at` (lines 169–184) and `seconds_until_next_open` (lines 210–227) each contain the same `match self.resolve_tz() { Some(tz) => ..., None => chrono::Local ... }` block extracting weekday/minute-of-day, differing only in whether seconds are also read.
- **Root cause**: No shared "local time components in the configured tz" helper.
- **Impact**: ~35 duplicated lines; a future tz-handling fix (e.g. DST edge) must be applied twice or the two methods disagree about when a window is open vs. when it next opens.
- **Fix sketch**: Extract `fn local_components(&self, utc_now: DateTime<Utc>) -> (u8 /*weekday*/, u16 /*minutes*/, u64 /*secs-into-minute*/)` that does the `resolve_tz()` match once; both methods consume it (is_active_at ignores the seconds).

## 5. Persona::is_dim_disabled_for_cap re-parses disabled_dims_json on every call
- **Severity**: Low
- **Lens**: perf-optimizer
- **Category**: repeated-parse
- **File**: src-tauri/src/db/models/persona.rs:682
- **Scenario**: The doc comment says the runtime executor calls this per action ("skip iff this returns true"). Each call runs `parsed_disabled_dims()`, which `serde_json::from_str`s the whole column into a fresh `HashMap<String, Vec<String>>` and then discards it — N actions in one execution means N parses of the same string.
- **Root cause**: Convenience accessor hides the parse inside the per-check call instead of exposing the parsed map for reuse.
- **Impact**: Bounded (the JSON is small), but it is allocation + parse work inside the execution dispatch loop that grows with action count; also every check allocates the full map to answer one membership question.
- **Fix sketch**: Have the executor call `parsed_disabled_dims()` once per execution and query the returned map per action (`map.get(cap_id).is_some_and(|d| d.contains(dim))`); keep `is_dim_disabled_for_cap` for one-off call sites. Verification needed at the executor call site (cross-context) to confirm the per-action pattern.
