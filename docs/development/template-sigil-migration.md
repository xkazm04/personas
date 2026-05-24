# Template sigil-driven adoption migration

Per the 2026-05-17 design pass: the View/Adoption surface now renders **one
glyph per capability** with mini-sigil tabs in the header, and each petal
becomes an interactive edit control. Every adoption question must bind to
a specific capability, not a `persona` or `connector` scope.

This doc is the rubric the migration subagents and humans both follow.
Authoritative; if a template doesn't conform, the loader treats it as
schema-invalid and the integrity check fails in release builds.

## What changes

### 1. Every `adoption_question` gets a `use_case_id` (singular)

Field name: `use_case_id` (singular, required).

Rules (LLM judgment, per question):

- Pre-existing `use_case_ids: ["uc_X"]` (single entry) → `use_case_id: "uc_X"`.
- Pre-existing `use_case_ids: ["uc_A","uc_B",…]` → judge: does the question's
  ANSWER need to differ per capability?
  - **Probably not** (same value works for all caps, e.g. shared connector
    pick, shared retention window): pick the capability that semantically
    owns the setup — usually the first cap that *needs* the value or
    references the connector in its `tool_hints`. Use that single id.
  - **Yes** (each cap genuinely wants a different answer): split the
    question into N records with distinct ids (suffix the question id
    with `__<uc_id>`, e.g. `aq_categories` → `aq_categories__uc_morning_digest`).
    Each split record gets one `use_case_id`. Splitting is the fallback —
    expect most templates need 0 or 1 split.
- Pre-existing `scope: "persona"` (no `use_case_ids`) → bind to a capability.
  For templates with one capability the choice is trivial; for multi-cap,
  pick the capability whose purpose most relates to the question (voice
  tone → first capability is fine).
- Pre-existing `scope: "connector"` (vault credential pick) → bind to the
  capability that uses that connector (`tool_hints[]` contains the
  connector's `service_type` or equivalent identifier). If multiple caps
  use the connector, pick the first; the connector itself is template-wide
  so the answer applies regardless.

Do not delete the legacy fields (`use_case_ids`, `scope`, `connector_names`)
in this migration — additive only. A future clean-up commit removes them
once the loader stops reading them.

### 2. `dimension` field must be set and match the canonical 8-dim vocabulary

Canonical values: `trigger | task | connector | message | review | memory | event | error`.

Routing table — if the question's current `dimension` is missing or one of
the legacy values, normalize:

| Legacy / category value | Canonical dimension |
| --- | --- |
| `connectors` | `connector` |
| `messages` | `message` |
| `use-cases` | `task` |
| `voice` | `task` |
| `events` | `event` |
| `error-handling` | `error` |
| `human-review` | `review` |
| (absent) + `category: credentials` | `connector` |
| (absent) + `category: notifications` | `message` |
| (absent) + `category: memory` | `memory` |
| (absent) + `category: quality` | `memory` |
| (absent) + `category: human_in_the_loop` | `review` |
| (absent) + `category: boundaries` | `error` |
| (absent) + `category: configuration` / `domain` / `intent` | `task` |

If a question's `category` and intent point at a clearly different
dimension than the routing table suggests, follow the *content* — the
table is a heuristic for the common case.

### 3. Per-capability `use_case` body fields drive default sigil state

No new field is added to the schema. The existing per-use_case fields
**already encode** sigil defaults — the migration step is to verify the
data matches the intended UX state, not to add new structure.

| Sigil | Active iff... | Source field on `use_case` |
| --- | --- | --- |
| trigger | populated | `suggested_trigger` |
| connector | populated | `tool_hints[]` non-empty |
| message | populated | `notification_channels[]` non-empty |
| memory | on | `generation_settings.memories === "on"` |
| review | on | `generation_settings.reviews ∈ {"on","trust_llm"}` |
| event | populated | `event_subscriptions[]` non-empty |
| error | on | `generation_settings.error_handling === "on"` (new field) |
| task | always | n/a |

For templates that use `recipe_ref` to inline a use case from
`_recipe_seeds.json`, the recipe seed is the source of truth for these
fields; no template-side edit is needed unless the template overrides
specific fields via `bindings`.

> **Post-migration correction (2026-05-24).** §3 was specified but **never
> written into any template or recipe-seed data** — the Phase 1 fan-out only
> applied §1 (`use_case_id`) and §2 (`dimension`). No use case carried
> `generation_settings`, so the memory/review/event petals stayed dark across
> the entire recipe-ref catalog even when review was configured via the
> legacy `review_policy` / `memory_policy` fields. Fix:
> `displayUseCase.deriveDimensions` now **falls back** to
> `review_policy.mode ∈ {always, auto_triage}` → review petal and
> `memory_policy.enabled` → memory petal when `generation_settings` is
> absent — mirroring the fallback `engine/prompt/capabilities.rs` already
> does on the backend. So configured-but-unmigrated capabilities light
> correctly with no data migration. New/edited recipe seeds should still
> carry explicit `generation_settings` (Dev Clone's four capabilities now
> do); the fallback is the safety net for everything that predates §3.

### 4. Connector questions stay where they are

Connector-pick questions belong to the Apps petal of the capability that
uses the connector. The Apps modal renders them inline. Don't hoist them
or duplicate them across capabilities unless the capability genuinely
needs a different account (e.g. read-only Gmail for one cap, send-as
Gmail for another — rare).

## Migration steps per template

1. Walk `adoption_questions[]`:
   - Set `use_case_id` (singular) per the rules above.
   - Set `dimension` per the routing table.
   - Leave legacy fields untouched.
2. For each `use_case`:
   - If the use case relies on `recipe_ref`, no per-use_case edits unless
     `bindings` overrides a relevant field.
   - Otherwise, verify each per-dim field aligns with the intended default
     sigil state (use the table above).
3. Output the modified JSON to its original path.
4. **Do NOT** regenerate `template_checksums.rs` — the human aggregator
   batches all migrations and regenerates once.

## Anomalies to surface in the batch report

Note any of these for human review:

- Templates where a question has `use_case_ids` with >3 entries — splitting
  produces clutter; user may want a different approach.
- Templates where `category` and the routed `dimension` disagree by content
  (e.g. a `category: quality` question about retry policy → should be
  `error`, not `memory`).
- Templates with capabilities that have zero adoption questions (fully
  preset — no schema change needed, just flag for visibility).
- Templates where `recipe_ref` is used but the user clearly wants overrides
  that aren't in `bindings` — out of scope, just flag.

## Validation gate (post-fan-out)

After all batches land:

1. `cargo test --manifest-path src-tauri/Cargo.toml -p personas-desktop template`
2. Regenerate `template_checksums.rs` via the embed script.
3. `npx tsc --noEmit`
4. `node scripts/i18n/check-coverage.mjs`
5. Spot-check 3 random templates through the adoption flow in dev.
