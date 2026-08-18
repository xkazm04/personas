---
layer: application
subject: import-normalization
technique: import-validation
stack: rust
---

# The workflow-import backend — caps with one authority, nonce fencing, and an atomic commit door

The service half of the workflow-import pipeline:
`src-tauri/src/commands/design/n8n_limits.rs` (bounds),
`src-tauri/src/commands/design/n8n_transform/prompt_sanitizer.rs`
(sink sanitization for the model-transformation stage), and
`src-tauri/src/commands/design/n8n_transform/confirmation.rs` (the commit
door). Together they are the repo's fullest rendition of "an imported
definition is untrusted input".

## Confirmed against the technique

- **Caps defined once, enforced server-side, mirrored by codegen**
  (`n8n_limits.rs`): `MAX_WORKFLOW_JSON_BYTES` (5 MB, single raw export)
  and `MAX_TRANSFORM_PAYLOAD_BYTES` (10 MB, combined transform payload)
  live as Rust consts, exported to the client via ts-rs plus
  `scripts/generate-n8n-limits.mjs` → `src/lib/n8nLimits.generated.ts`,
  with CI verifying the generated file — the one-authority pattern for a
  cross-boundary bound. The module doc *derives* both numbers (realistic
  exports under 200 KB; the transform cap must be ≥ 2× the session cap
  with headroom) and a unit test pins the 2× relationship
  (`transform_cap_must_exceed_workflow_cap`). A cap with its rationale
  recorded and its invariant tested.
- **Sink-aware sanitization at the model boundary**
  (`prompt_sanitizer.rs`): imported workflow text bound for a
  model-transformation prompt passes seven layers — length truncation
  (name 200 / JSON 50k / free text 10k), zero-width and non-BMP Unicode
  stripping (homoglyph defence), section-delimiter and role-override
  stripping, dangerous-tag removal via a single precompiled
  case-insensitive regex (the doc comment records that the previous
  per-tag loop was quadratic and "exploitable as a CPU DoS vector"), then
  **structural isolation**: XML boundary tags with a random 16-byte
  nonce, plus a canary instruction asking the model to report
  manipulation attempts. Structure over blocklists, per the module's own
  OWASP citation — the prompt-safety subject's doctrine landing as
  import machinery.
- **The client-side twin declares its purpose**
  (`src/lib/utils/sanitizers/workflowSanitizer.ts`): allowlist name
  characters, per-field length caps, and injection-pattern stripping
  shared with the variable sanitizer through one module "so the two
  sanitizers can't drift apart again" — a one-authority fix applied
  after a measured drift.
- **Atomic commit with a staged receipt** (`confirmation.rs`):
  `create_persona_atomically` first inserts an `import_transactions` row
  in status `'staged'`, then opens the real transaction for the persona
  plus its triggers, tools, and connector rows. Any entity failure rolls
  back the whole transaction — "no partial persona exists" — while
  per-entity errors are collected into `EntityError { entity_type,
  entity_name, error }` so the frontend can render "3 of 5 tools failed:
  X, Y, Z — fix and retry". The receipt flips to committed/failed with
  `entity_results` and `error_summary` at the end (`:460-465`).
- **Credentials as requirements, not values**: the commit returns
  `connectors_needing_setup: Vec<String>` — named, valueless slots the
  user fulfills through the credential flow afterwards. No secret-shaped
  value from the foreign file rides the import into the store.

## Where it diverges from the technique — honestly

- **The receipt does not enumerate what was created.** `entity_results`
  stores only the *error* list, so every fully-successful import writes
  `'[]'` — measured on a live install at 155 of 155 rows (the legacy
  untrusted-definition-validation census). The staged→committed skeleton
  is exactly right; the enumeration the technique demands (entities
  created, source, grades) has a column and no writer.
- **No loss ledger reaches this layer at all.** Nothing in the commit
  door knows which foreign nodes failed to map upstream, so the durable
  record cannot answer "why is this import missing behavior" — the
  disclosure chain ends at the wizard UI.
- **Draft normalization fills gaps silently but harmlessly**
  (`types.rs:53-67`): empty name/color/icon get defaults. Display-only
  fields, so this stays on the right side of the default-construction
  line — but it is the pattern to watch if semantic fields ever join the
  list.
