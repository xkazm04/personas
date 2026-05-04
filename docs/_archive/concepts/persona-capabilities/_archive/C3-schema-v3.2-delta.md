# C3 — Template Schema v3.2 delta

> This document extends `C3-template-schema-v3.md` and `C3-schema-v3.1-delta.md`
> with the v1.2 messaging & notifications additions that landed in Phase 17.
> **Still `schema_version: 3`** — fully backward compatible, additive only.
> Old templates and old persona rows continue to normalize, serialize, and
> dispatch with zero behavior change.
>
> **Read the base spec first:** `C3-template-schema-v3.md`.
> **Read v3.1 deltas:** `C3-schema-v3.1-delta.md`.
>
> Locked decisions recorded in `.planning/phases/17-schema-v3-2/17-CONTEXT.md`
> (referenced inline as D-01..D-07 below).

---

## 1. Overview

### What v3.2 adds

- **`use_cases[i].sample_output`** on template use cases — a `{title?, body?, format?}` object describing an example output the persona produces when this capability runs. Consumed by the adoption "Test Run" button, the combined-layout sample preview, and (later) template-gallery marketing surfaces. (SCHEMA-01)
- **`event_subscriptions[j].notify_titlebar`** on per-UC event subscriptions — a boolean gating whether this emit event surfaces as a TitleBar bell notification. Template-author default, user-overridable at adoption. (SCHEMA-02)
- **Persona `notification_channels` shape v2** — a new array-of-structs shape with `type ∈ {built-in | titlebar | slack | telegram | email}`, required `use_case_ids: "*" | string[]`, optional `event_filter: string[]`, alongside existing `enabled` / `credential_id` / `config`. (SCHEMA-03)

### What v3.2 does NOT change

- `schema_version` is still `3` — no version bump on the wire.
- `is_v3_shape()` detector in `engine::template_v3` is unchanged — old templates without v3.2 fields continue to be recognized as v3 and normalize identically.
- Legacy persona `notification_channels` shape A (preferences object — `{execution_completed: bool, ...}`) and shape B (channels array without `use_case_ids` / `event_filter`) are NOT migrated, NOT rewritten, and NOT blocked from dispatch (D-02 — transparent dual-path).
- `encrypt_notification_channels` + `decrypt_notification_channels` bodies are unchanged — shape v2 carries no plaintext secrets that are not already in `SENSITIVE_CHANNEL_KEYS`.

### Backward compatibility guarantee

Any template OR persona row persisted before v3.2 normalizes, serializes, and dispatches to exactly the same bytes as it did before. No migrations, no background rewrites, no "re-save to fix" prompts for users. New v3.2 fields are layered on top, not substituted for, existing shapes.

---

## 2. Field Additions

### 2.1 `use_cases[i].sample_output` (SCHEMA-01)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `title` | string | No | (absent) | Short headline for the example output. |
| `body` | string | No | (absent) | Full example body, typically 1–5 sentences or a compact code/JSON snippet. |
| `format` | `"markdown" \| "plain" \| "json" \| "html"` | No | `"plain"` (after normalize) | Locked enum per D-01. Unknown values warn-and-coerce to `"plain"` at `normalize_v3_to_flat()` time; a `tracing::warn!` is emitted with template + use-case context. |

**Semantics.** `sample_output` is the canonical example the adoption UI renders for Test Run, the per-UC preview, and the combined-layout single preview (when `persona.message_composition === "combined"` falls back to the first enabled UC's `sample_output`). It is persisted verbatim through the adoption + promote path into `persona.design_context.use_cases[i].sample_output`.

**Why all fields are optional (D-04):** template authors can declare just a `title`, or just a `body`, or just a `format` when the shape is obvious. The schema layer does not enforce minimum content; UI/rendering layers cap length at display time if needed.

**Format enum (D-01):** the four values cover every realistic agent output — human prose (`plain`), rich text with headings/lists (`markdown`), structured data (`json`), and rendered docs (`html`). Unknown values are rejected at `SampleOutput` deserialize time by `serde_json::from_str`; the normalizer ALSO warn-and-coerces in case a future code path reaches the hoist function with a raw JSON string that bypassed strict deserialize (defense in depth).

**Example — template with sample_output:**

```json
{
  "schema_version": 3,
  "use_cases": [{
    "id": "uc_morning_digest",
    "title": "Morning Digest",
    "sample_output": {
      "title": "Daily digest: 3 urgent, 12 normal",
      "body": "### Urgent\n- CEO asked about Q3 numbers\n- Hotfix deploy failed\n\n### Normal\n- 12 routine emails, auto-triaged.",
      "format": "markdown"
    }
  }]
}
```

**Example — template WITHOUT sample_output (backward compat):**

```json
{
  "schema_version": 3,
  "use_cases": [{ "id": "uc_morning_digest", "title": "Morning Digest" }]
}
```

Both templates normalize cleanly. The second template's missing `sample_output` is treated as "no preview available" downstream; the adoption UI falls back to `{title: uc.name, body: uc.capability_summary}` when absent (ADOPT-04).

### 2.2 `event_subscriptions[j].notify_titlebar` (SCHEMA-02)

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `notify_titlebar` | boolean | No | `false` (D-03) | Inserted by `hoist_notify_titlebar_flags()` when absent on `direction: "emit"` subscriptions. Listen-direction subscriptions are untouched — the flag has no meaning there. |

**Semantics.** `notify_titlebar: true` means "when this emit event fires, add an entry to the TitleBar bell notification center." False means "emit the event (for delivery fanout, for inbox) but do NOT ping the bell."

**Why `false` by default (D-03):** conservative opt-in. Users adopting templates that predate v3.2 get zero surprise bell chatter. Template authors who want an event in the bell must explicitly set `notify_titlebar: true` on that subscription. Phase 22 applies a conservative heuristic when backfilling: `*.error` / `*.delivered` / `*.completed` → `false` (execution-failed bell already covers errors); `*.at_risk` / `*.sector_shift` / `*.buy` / `*.sell` / `*.anomaly` → `true`.

**Scope — emit-direction only:** `notify_titlebar` is preserved/defaulted only on `direction: "emit"` subscriptions. `direction: "listen"` entries never reach the TitleBar (the persona receives those events, doesn't emit them), so the field is silently ignored by the normalizer there.

**Example:**

```json
{
  "use_cases": [{
    "id": "uc_stock_digest",
    "event_subscriptions": [
      { "direction": "emit",   "event": "stock.signal.buy",        "notify_titlebar": true  },
      { "direction": "emit",   "event": "stock.digest.delivered"                            },
      { "direction": "listen", "event": "market.session.open"                                }
    ]
  }]
}
```

After normalize:

```json
{
  "use_cases": [{
    "id": "uc_stock_digest",
    "event_subscriptions": [
      { "direction": "emit",   "event": "stock.signal.buy",        "notify_titlebar": true  },
      { "direction": "emit",   "event": "stock.digest.delivered",  "notify_titlebar": false },
      { "direction": "listen", "event": "market.session.open"                                }
    ]
  }]
}
```

### 2.3 Persona `notification_channels` — shape v2 (SCHEMA-03)

Shape v2 is a new discriminated-union branch layered on top of the existing shape-A object / shape-B array parsers. Discriminator: **presence of `use_case_ids` on the first array element**. Shape A (object) and shape B (array without `use_case_ids`) continue to be parsed by their existing paths with zero behavior change.

**Field spec:**

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `type` | `"built-in" \| "titlebar" \| "slack" \| "telegram" \| "email"` | Yes | — | Wire values use kebab-case. `"built-in"` routes to the `personas_messages` connector (Phase 18); `"titlebar"` emits `titlebar-notification` Tauri events (Phase 19). |
| `enabled` | boolean | No | `true` | Standard enable toggle. |
| `credential_id` | string | Conditional | absent | Optional when `type == "built-in"` or `"titlebar"` (no credential needed); required for `"slack"` / `"telegram"` / `"email"` by UI enforcement, not by schema. |
| `use_case_ids` | `"*"` OR `string[]` | Yes | — | Sentinel `"*"` matches all UCs; array matches only listed UC IDs. Empty array `[]` is REJECTED by `validate_notification_channels` at persona save (error code `empty_use_case_ids`). |
| `event_filter` | `string[]` | No | absent | When present, only these event types trigger external delivery for this channel (gates `EmitEvent`-derived fanout only per milestone decision 3; `UserMessage` and `ManualReview` always flow). |
| `config` | object | No | absent | Channel-specific config (e.g., slack `{channel: "#alerts"}`, telegram `{chat_id: "..."}`). Same encrypt rules as shape B — `SENSITIVE_CHANNEL_KEYS` values are encrypted at rest. |

**Multi-instance (D-05):** A persona's `notification_channels` array may contain multiple entries with the same `type`. Examples:
- Two `slack` entries routed to different UCs.
- A `built-in` entry with `use_case_ids: "*"` plus a `titlebar` entry for specific UCs.

Uniqueness is NOT enforced at the schema layer. UI can guide users against redundant configs, but the data model permits them.

**`credential_id` optionality:** `built-in` and `titlebar` channels resolve implicitly — the `personas_messages` connector (Phase 18) backs `built-in`, and `titlebar` is a local Tauri event with no credential backing. Other channel types still require `credential_id` at UI-enforcement time.

**`use_case_ids` sentinel:** the string `"*"` means "this channel reaches every UC on this persona." This is stored as a JSON string (not an array containing `"*"`). The empty array `[]` means "this channel reaches NO UCs," which is a silent no-op and therefore a validation error — the validator rejects it with code `empty_use_case_ids` at persona save time.

**Example — shape A (preferences, legacy):**

```json
{ "execution_completed": true, "approvals": false }
```

**Example — shape B (legacy channels array):**

```json
[
  { "type": "slack", "enabled": true, "credential_id": "cred_xyz", "config": { "channel": "#alerts" } }
]
```

**Example — shape v2:**

```json
[
  { "type": "built-in", "enabled": true, "use_case_ids": "*" },
  { "type": "titlebar", "enabled": true, "use_case_ids": ["uc_stock_buy", "uc_risk_alert"], "event_filter": ["stock.signal.buy", "stock.signal.risk"] },
  { "type": "slack", "enabled": true, "credential_id": "cred_xyz", "use_case_ids": ["uc_stock_buy"], "config": { "channel": "#alerts" } }
]
```

All three shapes coexist in the column. The parser picks the right branch based on JSON shape:

| JSON starts with | First element has `use_case_ids`? | Parser |
|------------------|----------------------------------|--------|
| `{` | — | `parse_prefs` → shape A |
| `[` | No | `parse_channels` → shape B (`Vec<ExternalChannel>`) |
| `[` | Yes | `parse_channels_v2` → shape v2 (`Vec<ChannelSpecV2>`) |
| `[` | (empty array) | `parse_channels_v2` → `Some(vec![])` — v2 with zero channels |

---

## 3. Normalizer Changes (`template_v3.rs`)

Three new functions appended to the `normalize_v3_to_flat()` call chain, directly after the v3.1 additions block. Marker comments `// v3.2 —` tag every new function and the call-chain extension, matching the v3.1 precedent (SCHEMA-04).

| Function | File | Purpose |
|----------|------|---------|
| `hoist_sample_outputs` | `src-tauri/src/engine/template_v3.rs` | Apply `format: "plain"` default (D-04); warn-and-coerce unknown `format` values (D-01). Idempotent. |
| `hoist_notify_titlebar_flags` | `src-tauri/src/engine/template_v3.rs` | Default `notify_titlebar: false` on emit-direction subscriptions (D-03). Leaves listen-direction entries untouched. Idempotent. |
| `hoist_channel_shape_v2_in_template` | `src-tauri/src/engine/template_v3.rs` | No-op placeholder. Shape v2 lives on the persona row; `flatten_notification_channels` already copies object keys verbatim so template-declared defaults pass through. Documented hook for future template-side validation. |

Idempotency guarantee: calling `normalize_v3_to_flat` twice on any v3.2 payload produces identical output (covered by `test_v32_idempotent`).

The public signature `pub fn normalize_v3_to_flat(payload: &mut Value)` is unchanged — return type remains `()`. The warn-and-coerce approach for unknown format values avoids touching the 17 existing call sites (2 in `build_sessions.rs`, 15 in the module's own tests).

---

## 4. Persona-row shape v2 readers

A new `parse_channels_v2(json: Option<&str>) -> Option<Vec<ChannelSpecV2>>` in `src-tauri/src/notifications.rs` reads shape-v2 JSON. Returns `None` when the input is shape A, shape B, malformed, or absent — callers fall through to the existing `parse_prefs` / `parse_channels` paths with zero behavior change (D-02 transparent dual-path invariant).

The existing `parse_channels(json) -> Vec<ExternalChannel>` function body is unchanged. Phase 19 will update `resolve_notification_channels` and `deliver_to_channels` to call `parse_channels_v2` first and fall back to the legacy parsers. In Phase 17, the parser is in place and tested — but no call site consumes its output yet.

---

## 5. Validator changes

`src-tauri/src/validation/persona.rs::validate_notification_channels` gains one new guard:

```
if an entry has `use_case_ids` as an empty array [] → error "empty_use_case_ids"
```

The `"*"` sentinel is a JSON string (not an array) and therefore skipped by the empty-array check. Non-empty arrays are accepted. Shape-B legacy channels (no `use_case_ids` key at all) are untouched by the new guard and continue to be validated by the existing slack/telegram/email `config.*` required-field rules.

---

## 6. Migration notes for template authors

- **`sample_output`**: add to any use case that has a Test Run button consumer (Phase 20). Keep bodies concise (1–5 sentences); the adoption UI caps at display time. Format defaults to `"plain"` if omitted — explicitly set `"markdown"` / `"json"` / `"html"` when the output benefits from rich rendering.
- **`notify_titlebar`**: add to each emit event subscription. Recommended heuristic (enforced by Phase 22 backfill): execution-noise events (`*.error`, `*.delivered`, `*.completed`) → `false`; high-signal events (`*.at_risk`, `*.sector_shift`, `*.buy`, `*.sell`, `*.anomaly`) → `true`. Users can override at adoption.
- **`notification_channels`**: not declared on templates in shape-v2 form. Templates declare `persona.notification_channels_default` as a hint; shape v2 is written at adoption time by Phase 20 from the user's channel picker selections. Template authors do not need to understand the shape-v2 wire format.

---

## 7. Backward compatibility — guarantee details

### For templates

- A template JSON without any v3.2 fields normalizes to a flat IR identical (byte-for-byte) to its v3.1 flat IR.
- A template with v3.2 fields present normalizes with defaults applied; new fields survive to the flat IR and on to promote.
- `is_v3_shape()` detector is unchanged — v3.2 templates are recognized as v3.

### For persona rows

- A persona row with shape-A `notification_channels` dispatches via the existing `parse_prefs` path. No rewrite, no migration.
- A persona row with shape-B `notification_channels` dispatches via the existing `parse_channels` + `deliver_to_channels` path. No rewrite, no migration.
- A persona row with shape-v2 `notification_channels` (written by Phase 20 adoption flow) is readable by `parse_channels_v2`. Phase 19 wires the delivery consumer.
- Pre-v3.2 persona rows that need to be re-edited in the v2 agent-editor (Phase 21) render as "Legacy — re-save to edit" read-only; the dispatch path for those rows is untouched. (Legacy-persona editor migration is explicitly deferred per `.planning/REQUIREMENTS.md` Future Requirements.)

### For the encryption layer

- `encrypt_notification_channels` / `decrypt_notification_channels` bodies are unchanged. Shape-v2 entries with `type: "built-in"` / `"titlebar"` have no `config` map keys in `SENSITIVE_CHANNEL_KEYS`, so the iteration is a no-op on those entries.

---

## 8. Test coverage

Verified in Phase 17, Plan 01:

- **`template_v3.rs`**: 10 new tests covering sample_output pass-through, format defaulting, unknown-format warn-and-coerce, notify_titlebar defaulting on emit, explicit-value preservation, listen-direction skip, v3.2 idempotency, v3.1 regression, SampleOutput serde roundtrip, unknown-format deserialize error.
- **`notifications.rs`**: 11 new tests covering parse_channels_v2 round-trip, `"*"` sentinel, specific-array scope, shape-A/shape-B rejection, empty-array handling, None input, multi-instance same-type, built-in without credential_id, legacy parse_prefs / parse_channels regression.
- **`validation/persona.rs`**: 5 new tests covering `"*"` acceptance, non-empty-array acceptance, empty-array rejection, legacy shape-B validation unchanged, disabled-channel validation skip.
- **`db/repos/core/personas.rs`**: 3 new tests covering shape-v2 encrypt/decrypt round-trip (built-in + titlebar pass-through; slack with external credential_id; parse-back via parse_channels_v2).

Run command (scoped to avoid pre-existing workspace-wide cargo failures on unrelated crates — see `.planning/STATE.md`):

```bash
cd src-tauri && cargo test -p personas --lib engine::template_v3
cd src-tauri && cargo test -p personas --lib notifications
cd src-tauri && cargo test -p personas --lib validation::persona
cd src-tauri && cargo test -p personas --lib db::repos::core::personas
```
