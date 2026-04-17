# Adoption answer pipeline

How questionnaire answers flow from the user's screen into the persona's
runtime behavior. This is the bridge between "the user configured it" and
"the agent acts on it."

## The problem this solves

Before this pipeline, adoption answers were cosmetic. The user filled in
the questionnaire, the UI stored answers in frontend state, and the build
+ promote steps read the template's raw `agent_ir` from SQLite — never
seeing the answers. Every adopted persona ran with the generic template
prompt regardless of what the user configured. This is now fixed.

## Architecture

```
 Questionnaire (React)
       │
       │  questionsComplete = true
       ▼
 MatrixAdoptionView
   ├── patchActiveSession({draft: {_adoption_answers}})   ← frontend state
   └── invokeWithTimeout("save_adoption_answers", {       ← IPC to backend
         sessionId,
         adoptionAnswersJson: JSON.stringify({
           answers,          // Record<string, string>
           questions,        // AdoptionQuestionMeta[]
           credential_bindings  // Record<string, string>
         })
       })
       │
       ▼
 build_sessions.adoption_answers (SQLite TEXT column)
       │
       ├────────────────────────────────────┐
       ▼                                    ▼
 test_build_draft                   promote_build_draft_inner
   │                                  │
   │  1. substitute_variables()       │  1. substitute_variables()
   │  2. inject_configuration()       │  2. inject_configuration()
   │                                  │
   ▼                                  ▼
 run_tool_tests()                   update_persona_in_tx()
 (tests with real config)           (persona prompt has real config)
```

## Data shapes

### Frontend payload (TypeScript)

Built in `MatrixAdoptionView.tsx` when `questionsComplete` fires:

```typescript
const payload = {
  // question_id → answer_value
  answers: { aq_domain_1: "Google Cloud Platform", aq_config_1: "500", ... },

  // question metadata (needed to build the User Configuration section)
  questions: [
    { id: "aq_domain_1", question: "Which cloud provider?", category: "domain",
      option_service_types: ["gcp_cloud", "aws_cloud", "azure_cloud"],
      vault_category: "cloud" },
    ...
  ],

  // connector_category → credential service_type
  // derived from vault-category questions where the user's chosen option
  // maps to a specific option_service_types entry
  credential_bindings: { cloud: "gcp_cloud" },
};
```

### Backend type (Rust)

`src-tauri/src/engine/adoption_answers.rs`:

```rust
pub struct AdoptionAnswers {
    pub answers: HashMap<String, String>,
    pub questions: Vec<AdoptionQuestionMeta>,
    pub credential_bindings: HashMap<String, String>,
}
```

## The three operations

### 1. Variable substitution — `substitute_variables(ir, answers)`

Replaces `{{param.KEY}}` placeholders throughout the entire `AgentIr`
with the user's actual answer values. "KEY" matches the question `id`
(e.g. `{{param.aq_config_1}}`).

**How it works**: serializes the `AgentIr` to `serde_json::Value`, walks
all string values recursively (including nested objects in
`structured_prompt`, tool guidance, trigger configs, etc.), performs
string replacement, then deserializes back to `AgentIr`.

**Missing keys**: if a `{{param.X}}` has no matching answer, the
placeholder is left as-is and a warning is logged. This is degraded but
not broken — the LLM sees the placeholder name and can still reason
about it.

**Templates without placeholders** (97 of 106): the substitution walk
finds nothing to replace — pure no-op, zero overhead beyond the
serialize/deserialize round-trip.

### 2. Configuration injection — `inject_configuration_section(ir, answers)`

Appends a `## User Configuration (applied during adoption)` section to
`ir.system_prompt` listing all Q→A pairs in order:

```
## User Configuration (applied during adoption)

- **Which cloud provider do you want to monitor?**: Google Cloud Platform
- **What is your weekly spending threshold?**: 500
- **What currency are your billing costs in?**: USD ($)
```

Also injects into `structured_prompt.configuration` if the structured
prompt exists, so both prompt formats carry the answers.

This ensures the LLM is always aware of the user's choices at runtime,
even for templates that don't use `{{param}}` placeholders.

### 3. Credential bindings — `extract_credential_bindings(answers)`

Returns the `credential_bindings` map for downstream use. When the user
selects a vault-category option (e.g. picks "Google Cloud Platform"
which maps to `option_service_types[0] = "gcp_cloud"`), this records
that the `cloud` vault category should prefer credentials with
`service_type = "gcp_cloud"`.

Currently stored in the payload for future use by the runtime credential
resolver (Tier 0 preference). The binding derivation happens in the
frontend:

```typescript
// For each question with vault_category + option_service_types:
const selectedIdx = q.options.indexOf(answer);
const serviceType = q.option_service_types[selectedIdx]; // e.g. "gcp_cloud"
credentialBindings[q.vault_category] = serviceType;      // cloud → gcp_cloud
```

## When operations run

| Backend function | Calls | Effect |
|---|---|---|
| `test_build_draft` | `substitute_variables` + `inject_configuration_section` | Tool tests run against user-configured prompt (not generic template) |
| `promote_build_draft_inner` | `substitute_variables` + `inject_configuration_section` | Promoted persona's `system_prompt` and `structured_prompt` carry the configured values permanently |

Both call sites are in `src-tauri/src/commands/design/build_sessions.rs`,
right after parsing `agent_ir` from the DB and before any downstream
processing. This placement ensures all downstream operations (trigger
creation, tool creation, design_context generation, version snapshots)
see the substituted values.

## Database

Column `adoption_answers TEXT` on `build_sessions` table:

- **Schema**: `src-tauri/src/db/migrations/schema.rs`
- **Incremental migration**: `src-tauri/src/db/migrations/incremental.rs`
  (PRAGMA table_info check + ALTER TABLE for existing DBs)
- **Nullable**: NULL for sessions without adoption questions (zero
  behavioral change for non-adoption builds)

## Backward compatibility

| Scenario | Behavior |
|---|---|
| Template without adoption questions | `adoption_answers` is NULL → all `if let Some(ref raw) = ...` guards skip → no change |
| Template with `aq_*` questions but no `{{param}}` placeholders | Variable substitution is no-op; configuration section is appended (answers visible to LLM) |
| Old build sessions created before the migration | NULL column → no crash, no behavioral change |
| Frontend `save_adoption_answers` IPC | Fire-and-forget best-effort; failure logged but doesn't block the build flow |

## Adding `{{param}}` placeholders to a template

To make a template's prompt use specific answer values inline (rather
than relying on the appended configuration section):

1. Pick the question ID (e.g. `aq_config_1`)
2. Insert `{{param.aq_config_1}}` anywhere in the template's
   `structured_prompt`, `system_prompt`, `full_prompt_markdown`,
   tool guidance, trigger configs, etc.
3. The substitution engine will replace it with the user's answer at
   both test time and promotion time

Example in a structured prompt:

```json
{
  "structured_prompt": {
    "identity": "You monitor {{param.aq_domain_1}} cloud spending...",
    "instructions": "Alert when weekly spend exceeds ${{param.aq_config_1}}..."
  }
}
```

## Files

| File | Role |
|---|---|
| `src-tauri/src/engine/adoption_answers.rs` | Core engine: types, substitute_variables, inject_configuration_section, extract_credential_bindings |
| `src-tauri/src/engine/mod.rs` | Module registration |
| `src-tauri/src/commands/design/build_sessions.rs` | `save_adoption_answers` IPC command; answer application in `test_build_draft` and `promote_build_draft_inner` |
| `src-tauri/src/db/models/build_session.rs` | `BuildSession.adoption_answers` field |
| `src-tauri/src/db/repos/core/build_sessions.rs` | Read/write `adoption_answers` column |
| `src-tauri/src/db/migrations/schema.rs` | Column definition |
| `src-tauri/src/db/migrations/incremental.rs` | Migration for existing DBs |
| `src/features/templates/sub_generated/adoption/MatrixAdoptionView.tsx` | Frontend: calls `save_adoption_answers` IPC + derives credential_bindings |

## Anti-patterns

- **Don't read `_adoption_answers` from the frontend `buildDraft` in
  Rust code.** The authoritative copy is in
  `build_sessions.adoption_answers` (SQLite). The frontend `buildDraft`
  keeps a copy for display purposes only.
- **Don't skip the configuration injection thinking `{{param}}`
  substitution is enough.** Most templates (97 of 106) don't have
  `{{param}}` placeholders. The configuration section is the universal
  fallback that makes answers visible to the LLM in all cases.
- **Don't store answers in `agent_ir`.** Answers are the user's
  customization layer on top of the template's design. Keeping them
  separate means you can diff template defaults vs user config, re-apply
  answers after template edits, and audit what the user chose vs what
  the template shipped with.
