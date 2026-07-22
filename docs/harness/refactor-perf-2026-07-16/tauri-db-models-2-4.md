# tauri:db/models [2/4] — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 1 medium / 1 low)
> Context group: Backend Data & Commands | Files read: 18 | Missing: 0

## 1. Three-state (omit/clear/set) update semantics silently broken on most `Option<Option<T>>` fields — only 4 team fields use the `double_option` deserializer

- **Severity**: High
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/models/team.rs:60 (also identity.rs:206, exposure.rs:130, credential.rs:93, tool.rs:144, skill.rs:68)
- **Scenario**: Serde's default `Deserialize` for `Option<Option<T>>` maps JSON `null` to the **outer** `None` (via `visit_none`), i.e. "preserve", not `Some(None)` ("clear"). The `double_option` deserializer exists precisely to fix this, but it is applied only to the 4 workspace-facet fields of `UpdateTeamInput` (team.rs:70-77). Every other IPC-deserialized update input using the same double-Option pattern — `UpdateTeamInput.description/canvas_data/team_config/icon`, `UpdateTrustedPeerInput.notes`, `UpdateExposedResourceInput.description/expires_at`, `UpdateCredentialInput.metadata`, `UpdateToolDefinitionInput` (4 fields), `UpdateSkillInput.description/category` — cannot represent "clear via null": sending `null` from the frontend silently preserves the old value.
- **Root cause**: The three-state pattern was copy-adopted across ~6 model files without the `#[serde(default, deserialize_with = "double_option")]` attribute that makes it actually work; team.rs even documents it duplicated `double_option` from group.rs "to avoid a cross-module re-export", guaranteeing further drift.
- **Impact**: Latent clear-a-field bugs on frequently used update commands (a user deleting a team description/icon or peer note may see it reappear), plus a misleading type signature — readers assume `Some(None)` is reachable when it is not. Verification needed: whether any frontend caller actually sends `null` intending to clear (cross-context; frontends may work around it by sending `""`).
- **Fix sketch**: Promote `double_option` to a shared helper (e.g. `db/models/serde_util.rs`, `pub(crate)`), delete the copies in team.rs and group.rs, and apply `#[serde(default, deserialize_with = "double_option")]` to every `Option<Option<T>>` field on a `Deserialize`-derived update input. Add one unit test asserting `{"description": null}` deserializes to `Some(None)` and `{}` to `None`.

## 2. Ten hand-rolled enum⇄string conversions with five different conventions; only two implement FromSql/ToSql

- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/db/models/identity.rs:120 (also event.rs:35, audit_incident.rs:41, n8n_session.rs:24, chat.rs:29, exposure.rs:26, skill.rs:17, artist.rs:34)
- **Scenario**: This context alone defines 10 DB-persisted string enums (`TrustLevel`, `AccessLevel`, `ResourceType`, `PersonaEventStatus`, `IncidentStatus`, `IncidentSeverity`, `SessionStatus`, `ChatRole`, `SkillComponentType`, `AssetType`), each with a hand-written `as_str` match plus a parse function — but the parse API differs per file: `FromStr -> AppError` (identity, exposure), inherent `from_str -> Option` (audit_incident), `from_str -> Result<_, String>` (skill), `from_str_checked` (chat), `from_token -> Option` (artist), and a lenient `from_db` that silently coerces unknown values to `Pending` (event.rs:37). Only `SessionStatus` and `ChatRole` implement `FromSql`/`ToSql`; the other 8 force manual string conversion at every repo call site.
- **Root cause**: Each enum was added ad hoc with no shared macro/trait, so the round-trip boilerplate (~25 lines per enum) was re-invented with a fresh error-handling convention each time.
- **Impact**: ~250 lines of mechanical duplication; adding a variant requires touching 2-3 match arms per enum with no compiler help across the string tables; the inconsistent parse semantics (error vs Option vs silent-default) make repo-boundary behavior unpredictable — e.g. a corrupt `persona_events.status` silently becomes `Pending` and re-enters the queue, while a corrupt `chat_messages.role` hard-fails the row read.
- **Fix sketch**: Introduce one `macro_rules! db_str_enum` (variants + string tokens) that emits `as_str`, `FromStr` (with `AppError::Validation`), `Display`, `FromSql`, and `ToSql` in one place, then migrate the 10 enums to it. Keep `PersonaEventStatus::from_db`'s lenient fallback only if the event bus deliberately wants it — and document that as an explicit opt-out rather than a divergent default.

## 3. `ExposedResource` returns raw JSON strings for `fields_exposed`/`tags` while its inputs take `Vec<String>` — `Json<T>` wrapper exists but is unused here

- **Severity**: Low
- **Lens**: code-refactor
- **Category**: structure
- **File**: src-tauri/src/db/models/exposure.rs:106
- **Scenario**: `CreateExposedResourceInput`/`UpdateExposedResourceInput` accept typed `Vec<String>` for `fields_exposed` and `tags`, but the read model `ExposedResource` exposes the same data as raw `String` ("JSON array of field names"), so the repo serializes manually on write and the frontend must `JSON.parse` on read — with the ts-rs export lying about the shape (`string`, not `string[]`).
- **Root cause**: The model predates (or ignored) the purpose-built `Json<T>` wrapper in json_column.rs, which sibling models (test_run.rs, memory.rs, execution.rs, lab.rs) already use for exactly this: transparent typed serde + validated FromSql/ToSql.
- **Impact**: Asymmetric contract on one resource type; malformed stored JSON is only discovered at the frontend parse site rather than at the DB boundary; the generated TS type is wrong for consumers.
- **Fix sketch**: Change `ExposedResource.fields_exposed`/`tags` to `Json<Vec<String>>`, drop the manual serialize/parse in the exposure repo and frontend callers, and re-export the ts-rs bindings. Verify the P2P `ExposureManifest` wire format tolerates the (unchanged) serialized shape — `Json<T>` serializes transparently, so the manifest JSON should be identical apart from the array now being a real array instead of a string.

---

**Perf-optimizer lens**: no findings reported. All 18 files are pure type/DTO definitions with trait impls; the only runtime code paths (`Json<T>` serde bridge, `N8nSessionResponse::from` parsing 4 JSON columns once per detail fetch, enum `to_sql` conversions) are appropriately bounded, and the remaining candidates (e.g. `ChatRole::to_sql` allocating a `String` per write where `SessionStatus` borrows) are negligible micro-optimizations.
