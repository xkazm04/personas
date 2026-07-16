# tauri:validation (misc) — code-refactor + perf-optimizer scan (2026-07-16)

> Total: 3 findings (0 critical / 1 high / 1 medium / 1 low)
> Context group: Core Libraries & State | Files read: 5 | Missing: 0

## 1. `validate_config` silently no-ops on unparseable JSON, and two caller paths rely on it alone — webhook_secret requirement bypassable
- **Severity**: High
- **Lens**: code-refactor
- **Category**: fragmented-validation
- **File**: src-tauri/src/validation/trigger.rs:71
- **Scenario**: `validate_config` wraps everything in `if let Ok(parsed) = serde_json::from_str(...)` (line 75) and returns zero errors when the config string is present but malformed JSON. The malformed-JSON case is only caught by the *separate* `validate_config_json`. The command layer (`commands/tools/triggers.rs:41`) calls both, but the repo layer (`db/repos/resources/triggers.rs:106-108`) and the LLM build pipeline (`commands/design/build_sessions.rs:1778-1779`) call only `validate_trigger_type` + `validate_config`. A webhook trigger created through build_sessions with malformed config JSON passes validation: the webhook branch that requires `webhook_secret` never runs (it only fires inside `Ok(parsed)` or when config is `None`), so the HMAC-auth requirement, interval floor, composite window clamp, and cron checks are all silently skipped. LLM-generated configs are precisely the inputs most likely to be malformed.
- **Root cause**: Responsibility for "config must be valid JSON" is split into a sibling function instead of being enforced inside the function that inspects the config; `validate_config` fails open on parse error.
- **Impact**: Validation contract is only as strong as each call site remembering to compose 2-4 functions; today two real call sites don't, producing triggers that violate the documented invariants (webhook without secret, unbounded composite window on pre-clamp rows).
- **Fix sketch**: Make `validate_config` fail closed: on `Some(config)` that is non-empty and unparseable, return the same `("config", "json")` error `validate_config_json` produces, then have `validate_config_json` delegate (or delete it and update the two command call sites). Alternatively add a single `validate_all(trigger_type, config)` aggregate and route the repo + build_sessions paths through it.

## 2. Trigger config JSON parsed up to 4 times per validation pass, with three different parse-failure policies
- **Severity**: Medium
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/validation/trigger.rs:57
- **Scenario**: A single `create_trigger` call runs `validate_config_json`, `validate_polling_url`, and `validate_schedule_has_cron_or_interval` in the command (commands/tools/triggers.rs:41-48), then `validate_config` again in the repo — four independent `serde_json::from_str` calls over the same string. Worse than the (negligible) parse cost, each copy handles parse failure differently: `validate_config` skips silently, `validate_polling_url` swallows via `.ok()` and skips URL-safety checks, `validate_schedule_has_cron_or_interval` treats it as missing config and errors.
- **Root cause**: Each validator was added independently and re-parses `Option<&str>` rather than sharing a parsed `serde_json::Value`.
- **Impact**: Maintenance hazard — new validators must each re-implement parse + failure policy, and the divergent policies are what enabled finding #1. Perf cost is bounded (configs are small, write-path only), so this is structural, not a perf issue.
- **Fix sketch**: Parse once at the top of an aggregate entry point (`fn validate_trigger(trigger_type, config: Option<&str>) -> Vec<ValidationError>`): emit the `json` error on parse failure, otherwise pass `&serde_json::Value` to the per-concern helpers (which become private and infallible with respect to parsing). Keeps the individual test surface, removes 3 redundant parses and 3 divergent failure policies.

## 3. Structured-prompt string-field key list duplicates `KNOWN_STRUCTURED_KEYS`
- **Severity**: Low
- **Lens**: code-refactor
- **Category**: duplication
- **File**: src-tauri/src/validation/persona.rs:151
- **Scenario**: The inline array at lines 151-158 ("identity", "instructions", "toolGuidance", "examples", "errorHandling", "webSearch") is exactly `KNOWN_STRUCTURED_KEYS` (line 100) minus `customSections`. Adding a new string section (e.g. a future "constraints" key) requires editing both lists; updating only `KNOWN_STRUCTURED_KEYS` would pass the unknown-key check but skip the must-be-a-string type check.
- **Root cause**: The type-check loop hardcodes its own copy of the key list instead of deriving it from the canonical constant.
- **Impact**: Silent drift risk — a new key could be accepted with a non-string value and then break the prompt builder downstream; bounded because the list changes rarely.
- **Fix sketch**: Derive the loop from the constant: `for &key in KNOWN_STRUCTURED_KEYS.iter().filter(|k| **k != "customSections")`, or restructure as `const STRING_KEYS: &[&str]` + `const OBJECT_KEYS: &[&str]` with `KNOWN_STRUCTURED_KEYS` built by concatenation (or a chained-iterator check).

---

No perf-optimizer findings met the reporting bar: all five files run only on write/validation paths with small inputs. The redundant JSON parses (finding 2) and the per-call rebuild of the `rules()` catalog are both cold-path and bounded; the hand-rolled Levenshtein runs against only 7 candidate keys. `all_rules()`, `contract::check`, and every chat/memory/trigger validator were verified as used (db/repos/communication/chat.rs, db/repos/core/memories.rs, commands/core/validation.rs, commands/tools/triggers.rs) — no dead code.
