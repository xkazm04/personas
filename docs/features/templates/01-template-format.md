# Template JSON format

Every template is a single `.json` file under
`scripts/templates/<category>/<slug>.json`. The schema isn't formally
typed in TypeScript — templates are treated as opaque `payload` objects
by the loading pipeline — but a consistent shape has emerged over 100+
shipped templates. This doc describes the fields that matter.

## Top-level structure

```jsonc
{
  "id": "finance/budget-spending-monitor",
  "name": "Budget Spending Monitor",
  "description": "Weekly cloud billing watchdog with anomaly detection.",
  "icon": "DollarSign",
  "color": "#f59e0b",
  "category": ["finance", "devops"],
  "is_published": true,

  "service_flow": [...],

  "payload": {
    "service_flow": [...],
    "structured_prompt": {...},
    "suggested_tools": [...],
    "suggested_triggers": [...],
    "suggested_connectors": [...],
    "suggested_notification_channels": [...],
    "suggested_event_subscriptions": [...],
    "suggested_parameters": [...],
    "use_case_flows": [...],
    "protocol_capabilities": [...],
    "adoption_questions": [...],
    "full_prompt_markdown": "...",
    "summary": "...",
    "design_highlights": [...]
  }
}
```

Top-level vs `payload` is a historical split: top-level fields are
metadata surfaced in the gallery (`id`, `name`, `description`, `icon`,
`color`, `category`), while `payload` holds the actual agent design the
user will adopt. The adoption flow stringifies `payload` into
`design_result` when seeding.

### Top-level fields

| Field | Type | Purpose |
|---|---|---|
| `id` | string | Unique slug; usually `<category>/<filename-without-.json>`. Becomes `test_case_id` in the DB. |
| `name` | string | Gallery card title (60 char max recommended) |
| `description` | string | Gallery card body text (~200 char) |
| `icon` | string | Lucide icon name |
| `color` | string | Hex color for the card accent |
| `category` | string[] | Gallery filter categories |
| `is_published` | boolean | Set `false` to hide from gallery (dev templates). `templateCatalog.loadAndVerify` skips `is_published === false`. |

## `payload.structured_prompt`

The core of the agent — identity, instructions, tool guidance, error
handling. Rendered by the persona editor as the system prompt once
promoted.

```jsonc
{
  "identity": "You are the Budget Spending Monitor...",
  "instructions": "Your goals:\n1. ...\n2. ...",
  "toolGuidance": "When calling the billing API, always...",
  "errorHandling": "**Rate limits**: back off exponentially...",
  "customSections": [
    { "title": "Reporting format", "content": "..." }
  ]
}
```

### `errorHandling` parsing

`extractDimensionData` in `MatrixAdoptionView.tsx` runs a markdown
section parser on `errorHandling` to populate the "error-handling"
matrix cell. Recognized shapes:

- `**Header**: description on same line`
- `**Header**\n description continuation` (multi-line)
- `- bullet item`

Up to 6 items rendered. Keep headers short and descriptions concise
for the matrix cell to render cleanly.

## `payload.suggested_connectors`

Services the template needs. Drives the vault-credential matching in
the questionnaire and determines which credentials must be connected
before the agent can run.

```jsonc
[
  {
    "name": "sentry",
    "service_type": "sentry",
    "category": "monitoring",
    "purpose": "Fetch error and performance data",
    "optional": false,
    "has_credential": false
  }
]
```

| Field | Purpose |
|---|---|
| `name` | Display name (usually matches service_type) |
| `service_type` | Must match a builtin connector's `name` field in `scripts/connectors/builtin/*.json` |
| `category` | Connector category for grouping in the matrix cell |
| `purpose` | Plain-English description of why the agent needs it |
| `optional` | `true` = skip the blocked-credentials banner for this one (see `HANDOFF-templates-adoption.md` round 4 for the Financial Stocks Signaller fix) |

`has_credential` is populated at runtime by `useConnectorStatuses` —
don't set it in the template JSON.

## `payload.suggested_triggers`

When and how the agent runs.

```jsonc
[
  {
    "trigger_type": "schedule",
    "config": { "cron": "0 9 * * 1" },
    "description": "Weekly Monday 9am"
  }
]
```

`trigger_type` is normalized via `TRIGGER_TYPE_ALIASES` in
`MatrixAdoptionView.tsx`:

- `event`, `event_bus`, `event_sub`, `event_subscription` → `event_listener`
- `cron`, `scheduled`, `timer` → `schedule`
- `poll` → `polling`
- `hook`, `http`, `web_hook` → `webhook`
- `watcher`, `fs_watcher`, `watch` → `file_watcher`
- `focus`, `window_focus` → `app_focus`

Non-matching trigger types pass through unchanged — the backend enum
accepts `manual`, `schedule`, `event_listener`, `polling`, `webhook`,
`file_watcher`, `app_focus`, and a few others (see
`src-tauri/src/db/models/trigger.rs`).

## `payload.use_case_flows`

Scenarios the agent is designed to handle. Populates the "use-cases"
matrix cell.

```jsonc
[
  {
    "name": "Weekly budget check",
    "description": "Run every Monday, fetch billing data, compare to threshold, alert on overruns"
  }
]
```

`extractDimensionData` prefers `use_cases` (an older flat list) but
falls back to `use_case_flows` if the former is absent.

## `payload.suggested_notification_channels`

How the agent talks back to the user. Populates the "messages" cell.

```jsonc
[
  { "type": "slack", "description": "Weekly budget report" },
  { "type": "built-in", "description": "In-app notification" }
]
```

## `payload.suggested_event_subscriptions`

Events this agent listens to (if trigger_type includes
`event_listener`). Populates the "events" cell.

```jsonc
[
  { "event_type": "budget.threshold_breach", "description": "..." }
]
```

## `payload.protocol_capabilities`

Special capabilities the agent requires. Populates "human-review" and
"memory" cells based on `type`.

```jsonc
[
  { "type": "manual_review", "context": "Must approve outbound alerts" },
  { "type": "agent_memory", "context": "Learns recurring spend patterns" }
]
```

Recognized types:
- `manual_review` → "human-review" cell
- `agent_memory` → "memory" cell
- Others are reserved for future use

## `payload.suggested_tools`

Tools the agent can call (HTTP requests, file I/O, browser, etc.).
Not rendered in the matrix directly — becomes part of the
`tool_def_from_ir` generation at build time. See
`docs/arch-persona-matrix-build.md` for the build-session side.

## `payload.adoption_questions`

The array that drives the adoption questionnaire. See
[04-adoption-questionnaire.md](04-adoption-questionnaire.md) for the
full question schema. Summary:

```jsonc
[
  {
    "id": "aq_domain_1",
    "category": "domain",
    "dimension": "connectors",
    "question": "Which Sentry projects should be monitored?",
    "type": "select",
    "default": "all",
    "context": "Loaded live from your connected Sentry org.",
    "vault_category": "monitoring",
    "option_service_types": ["sentry"],
    "dynamic_source": {
      "service_type": "sentry",
      "operation": "list_projects",
      "multi": true,
      "include_all_option": true
    }
  }
]
```

### Category values

Shown as headers in the live preview brief. Use one of:

- `intent` — what specific problem the user is solving
- `domain` — user's context and scope
- `configuration` — thresholds, schedules, formats
- `credentials` — workspace/project selection for connectors
- `boundaries` — what the agent should never do
- `human_in_the_loop` — approval policies
- `memory` — persistent knowledge
- `quality` — output format and detail level
- `notifications` — how and when to notify

Any other value falls through to the neutral `FALLBACK_CATEGORY`.
`CATEGORY_META` in `QuestionnaireFormGrid.tsx` has the icon + color
mapping.

### Dimension values

Declares which of the 8 persona matrix dimensions the question
informs. Use one of:

- `use-cases` — core capabilities and behavior
- `connectors` — which services and credentials
- `triggers` — when and how it activates
- `messages` — notification channels and formats
- `human-review` — approval gates and oversight
- `memory` — knowledge persistence and learning
- `error-handling` — failure recovery
- `events` — inter-persona coordination

The `dimension` field is informational (currently not rendered
anywhere in the Focus variant) but required for the LLM transform
path. Keep it accurate so future LLM regeneration works correctly.

## `payload.full_prompt_markdown`

Optional large-format system prompt as a markdown document. Usually
~5–15 KB. `summarize_design_result` in `template_adopt.rs` explicitly
skips this field when building the LLM prompt summary because it
duplicates `structured_prompt` content and would blow the prompt
budget.

Keep this field out of any code path that serializes the template for
IPC or LLM use — read `structured_prompt` instead.

## `payload.summary` + `payload.design_highlights`

Compact descriptive strings used by the gallery cards and the test
report modal. `summary` is a single paragraph; `design_highlights` is
an array of 3–5 bullet points.

## `payload.suggested_parameters`

Free parameters that survive the build process as adjustable knobs
(e.g. "lookback_hours", "error_count_threshold"). These appear in the
persona editor's parameter panel after promotion, letting the user
tune them without rebuilding.

```jsonc
[
  {
    "name": "lookback_hours",
    "type": "number",
    "default": 24,
    "description": "How far back to scan"
  }
]
```

`aq_config_*` questions in the questionnaire typically map 1:1 with
`suggested_parameters` — the questionnaire answer sets the parameter's
initial value.

## Validation

The loading pipeline doesn't validate template structure against a
schema — fields are accessed defensively with `?.` and array checks.
If you add a new template and it doesn't render correctly:

1. `node scripts/audit-adoption-questions.cjs` to see the question
   breakdown for your template
2. Open the browser console and look for
   `template-catalog: Integrity mismatch...` warnings (usually means
   you forgot to run `generate-template-checksums.mjs`)
3. `extractDimensionData` logs the raw matrix data — you can
   `console.log` it from `MatrixAdoptionView` to see which dimensions
   ended up populated

## Conventions shipped templates follow

- **IDs are `<category>/<slug>`** matching the file path. Keeps the
  seed loop's conflict key stable.
- **Question IDs start with `aq_`** — `aq_domain_1`, `aq_config_1`,
  `aq_boundaries_1`, etc. Not enforced but consistent.
- **`default` is always a string** even for numeric-looking questions
  (`"5"` not `5`). The answer map is `Record<string, string>`.
- **`dimension: "use-cases"`** is the most common — error on the side
  of use-cases when unsure.
- **Optional connectors have `optional: true`** so the blocking banner
  stays clean.
- **Secrets never appear in template JSON.** Credentials live in the
  vault; templates only reference `service_type`.

## Adding a new template — checklist

1. Copy an existing template in the closest category as a starting
   point.
2. Update `id`, `name`, `description`, `icon`, `color`, `category`.
3. Rewrite `payload.structured_prompt` (identity + instructions +
   toolGuidance + errorHandling).
4. List needed `suggested_connectors` with matching `service_type`
   values from `scripts/connectors/builtin/*.json`.
5. Add 3–8 `adoption_questions` covering required categories (intent,
   domain, configuration, boundaries at minimum).
6. Mark optional connectors with `optional: true`.
7. Add `vault_category` + `option_service_types` OR `dynamic_source`
   on credential-sensitive questions.
8. Run `node scripts/generate-template-checksums.mjs` to update both
   checksum manifests.
9. Restart `npm run tauri dev` so the Rust binary picks up the new
   compiled-in checksum.
10. Verify in the Generated tab + run the full adoption → test →
    promote flow once.

Existing templates in `scripts/templates/devops/sentry-production-monitor.json`,
`scripts/templates/finance/budget-spending-monitor.json`, and
`scripts/templates/development/autonomous-issue-resolver.json` are
good references — they exercise every pattern in this doc.
