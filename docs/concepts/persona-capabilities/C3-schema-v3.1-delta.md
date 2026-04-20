# C3 — Template Schema v3.1 delta

> This document refines `C3-template-schema-v3.md` with product-semantic
> rules that emerged after the first hand-authoring pass
> (2026-04-19/20). **Still `schema_version: 3`** — the wire format stays
> backward compatible, but the authoring contract changes in ways that
> invalidate the first five hand-authored templates. They are queued for
> rewrite; no mechanical migration will produce correct output.
>
> **Read the base spec first**: `C3-template-schema-v3.md`. This file
> documents only the deltas.

---

## 1. Normative principles (from 2026-04-20 review)

These are product laws, not authoring guidelines. Every template and
every UI surface that touches templates MUST satisfy them.

### P1 — Disabled use cases don't exist

If the user turns a use case off in the adoption picker, nothing
downstream sees it. The use case contributes **zero** triggers, zero
connectors, zero events, zero questions, zero matrix cells, zero flow
nodes, zero prompt lines. It's not greyed out — it's gone.

### P2 — Triggers configure per use case with quick-setup + "when"

Each use case that has a trigger declares a default `suggested_trigger`.
At adoption, the user either accepts the default or reconfigures via a
quick-setup picker: `daily | weekly | hourly | custom`. For weekly and
daily the picker additionally collects the "when" (time of day,
weekday). The template may also set `trigger_composition: "shared"` so
that all use cases inherit one shared trigger (Financial-signaller-style
weekly Monday digest) — in which case the picker collapses into a single
choice instead of one-per-UC.

### P3 — Messages configure per use case with compose-together option

Same shape as P2. Each use case declares its delivery. At adoption, the
user picks per-UC delivery OR opts into "compose together" where the
persona emits one combined message per tick instead of N separate
messages. Template's `message_composition: "combined" | "per_use_case"`
seeds the default.

### P4 — Connectors are shared across use cases

Connectors live in `persona.connectors[]`. Use cases reference them by
name. Credentials configured once apply wherever referenced. This is
already the v3 shape; P4 just makes it normative.

### P5 — Questions are scoped to N use cases (N ≥ 0)

A question can be linked to zero, one, or many use cases via
`use_case_ids: string[]`. The visibility rule:

- `use_case_ids` absent or `[]` — persona-level question, always shown.
- `use_case_ids = ["uc_x", "uc_y"]` — shown **if at least one** of the
  listed use cases is enabled.
- If every referenced UC is disabled, the question is hidden.

"Any-enabled OR" (not "all-enabled AND") matches authoring intent: the
question captures config that any of those capabilities needs.

Questions that duplicate the picker's enable/disable (`Track X?` when X
is a selectable UC) MUST be removed — the picker IS the toggle.

### P6 — Use case flow is documentation, not execution

`use_case_flow` is a wireframe for humans: gallery UI, matrix
visualization, onboarding explainers. The LLM executes from the prompt
surfaces (`operating_instructions` + `tool_guidance` + per-UC
`capability_summary`). Flow nodes should tell the story in ≤10 nodes,
not mirror the code path. Drop trivial action→action chains.

### P7 — Events use `<domain>.<subdomain>.<action>` syntax

Every event emitted by a use case uses a three-part dotted namespace.
First part is the domain (stocks, harvester, issue, email, …). Second
is the subdomain within that domain (signals, triage, backlog). Third
is the terminal action (buy, new, accepted, delivered). This shape is
what cross-persona event subscribers rely on — the backend doesn't
enforce it, authoring does.

### P8 — Connectors are required-or-optional; adoption behaves accordingly

`persona.connectors[].required: true | false` (default true). At
adoption:

- **Required connector, user has credentials**: proceeds normally.
- **Required connector, no credentials**: questionnaire step for that
  use case renders an empty-state with a "Create credential" CTA that
  deep-links into the vault. Adoption cannot proceed past that step
  until the credential exists.
- **Optional connector**: questionnaire surfaces a "Use {connector} or
  skip?" step. If skipped, the persona must run with a fallback path
  (documented in `operating_instructions` / per-UC `error_handling`).
  If picked, credential flow continues normally.

Templates that reference an optional connector MUST have a working
fallback — running without the connector is a supported configuration,
not a degraded mode.

---

## 2. Schema changes

### 2.1 `payload.persona.connectors[i].required`

```jsonc
"connectors": [
  {
    "name": "codebase",
    "label": "Codebase",
    "required": true,                                // NEW — default true
    "auth_type": "local",
    ...
  },
  {
    "name": "alpha_vantage",
    "label": "Alpha Vantage",
    "required": false,                               // optional — skippable
    "fallback_note": "When absent, use Yahoo Finance public endpoints for price data.",
    ...
  }
]
```

- **Default** when the field is missing: `required: true` (back-compat
  with existing authored templates).
- **New sibling field** `fallback_note`: short, i18n-target string that
  appears in the "Skip" UI explaining what the persona will do without
  this connector. Required when `required: false`.

### 2.2 `payload.persona.trigger_composition`, `message_composition`

```jsonc
"persona": {
  "trigger_composition": "per_use_case",             // NEW — or "shared"
  "message_composition": "per_use_case",             // NEW — or "combined"
  ...
}
```

- **Default** when missing: `per_use_case` (what the current templates
  assume).
- `trigger_composition: "shared"` — UI collapses per-UC trigger pickers
  into one picker for the whole persona. All use cases fire on the
  shared tick; their individual `suggested_trigger.config` is ignored.
- `message_composition: "combined"` — UI offers one delivery target for
  the whole persona; capabilities' outputs are concatenated into one
  message per tick.

These are template-author presets. User can override at adoption via the
trigger/message questionnaire step.

### 2.3 `payload.adoption_questions[i].use_case_ids`

```jsonc
// OLD
{
  "id": "aq_stale_days",
  "scope": "capability",
  "use_case_id": "uc_stale_triage",
  ...
}

// NEW
{
  "id": "aq_stale_days",
  "scope": "capability",                             // unchanged — the enum value stays
  "use_case_ids": ["uc_stale_triage"],               // array replaces singular
  ...
}
```

- `use_case_id` (singular) is **deprecated**. The v3.1 normalizer
  auto-migrates it to `use_case_ids: [<id>]` at load time for
  backward-read compat, but new templates MUST author the plural field.
- `scope` enum keeps its existing values: `persona | capability |
  connector`. Renaming to `use_case` was considered and rejected —
  `capability` already appears in the UI, store slices, and prompt
  builder, and the schema vocabulary is stable enough that the rename
  costs more than it pays.
- A question MAY appear with `scope: "capability"` and
  `use_case_ids: []` — this is a schema error, flagged by the checksum
  tool at build time.

### 2.4 `payload.use_cases[i].input_schema[j].ui_component`

```jsonc
"input_schema": [
  {
    "name": "target_codebase",
    "type": "connector_ref",                         // NEW type
    "ui_component": "CodebaseSelector",              // NEW — names a registered component
    "connector": "codebase",                         // required when type = connector_ref
    "required": true,
    "description": "Which codebase this capability analyzes."
  }
]
```

- `ui_component` is a string key registered in a frontend component
  registry (`src/features/templates/inputSchemaComponents.ts` —
  new file). If the key is unknown, UI falls back to the default
  renderer for the field's `type`.
- The new `type: "connector_ref"` says "this input is a selection from
  instances of the named connector" — e.g., pick which of your
  configured Codebase connectors to use. Useful when the user might
  have multiple instances of the same connector type.

### 2.5 `payload.use_cases[i].event_subscriptions[j].event_type` syntax

No schema change — documentation update. Authoring convention:
`<domain>.<subdomain>.<action>`. Linter-level check in the checksum
tool optional (not in this delta).

### 2.6 `payload.persona.output_assertions[]` + `payload.use_cases[i].output_assertions[]`

**Addendum — 2026-04-21 (Phase 6 of EXEC-VERIF-PLAN):**

Declarative post-execution checks against the LLM output. Evaluated by the
existing `output_assertions.rs` engine; `critical`-severity failures downgrade
the execution status from `Completed` → `Incomplete`, which Phase 5's
notification bridge surfaces as a `warning` in the TitleBar bell.

```jsonc
"persona": {
  ...
  "output_assertions": [
    {
      "name": "No silent PR abort",
      "description": "Fires when the LLM admits it opened a PR without green tests.",
      "type": "not_contains",                  // regex | json_path | contains | not_contains | json_schema | length
      "config": {                              // shape depends on type — see output_assertions.rs
        "patterns": ["opening PR despite test failures", "skipped running tests"],
        "case_sensitive": false
      },
      "severity": "critical",                  // info | warning | critical  — only `critical` downgrades status
      "on_failure": "log",                     // log | review | heal
      "enabled": true                          // default true
    }
  ],
  // Opt out of the baseline NotContains assertion that the normalizer
  // otherwise auto-injects (credentials-missing / no-access phrases).
  // Use only when the baseline's phrase set conflicts with legitimate output
  // (e.g. a security-audit persona that NEEDS to say "I don't have access to").
  "output_assertions_opt_out_baseline": false
}

"use_cases": [
  {
    "id": "uc_backlog_scan",
    ...
    "output_assertions": [ /* per-UC additions; same shape as above */ ]
  }
]
```

**Baseline injection** (always active unless the persona-level opt-out is
set) — `template_v3::baseline_not_contains_assertion` adds:

```jsonc
{
  "name": "Baseline blocker detection",
  "type": "not_contains",
  "severity": "critical",
  "config": {
    "patterns": [
      "credentials are not configured",
      "cannot proceed without",
      "skipping this step because",
      "I don't have access to",
      "is not available in this environment"
    ],
    "case_sensitive": false
  }
}
```

**Persist path:** normalizer's `hoist_output_assertions` merges persona + per-UC
entries into `payload.suggested_output_assertions[]`, which deserializes into
`AgentIr.output_assertions`. At promote time,
`build_sessions.rs::create_output_assertions_in_tx` inserts one row per
entry into the `output_assertions` table — joining automatically with the
existing evaluation pipeline.

**Runtime downgrade:** `engine/mod.rs::handle_execution_result` now evaluates
assertions *before* the status write. If `summary.critical_failures > 0`, the
execution is persisted as `Incomplete` with the first critical failure's
explanation as the error message.

**Per-UC scope:** the `use_case_id` field on each entry is populated by the
normalizer (null for persona-level, the UC id for per-UC). The evaluation
engine currently ignores this field — all enabled assertions run against
every execution. Per-UC targeting is a follow-up (tracked in EXEC-VERIF-PLAN
Phase 10).

### 2.7 Removals

- **`payload.adoption_questions[i]` — remove any question whose
  intent is "toggle this use case on/off"**. The picker owns that.
- **Internal/helper use cases** that aren't user-selectable get folded
  into a single parent UC. The rule: a use case is a user-facing job
  the user would say "turn X off" about. If the user wouldn't, it's
  not a use case. (Re-iterating `C3-template-schema-v3.md §2.3`.)
- **`payload.use_cases[i].use_case_flow.nodes` density** — cap at ~10
  nodes. The diagram illustrates the story; it doesn't document the
  code.

---

## 3. Adoption flow implications

### 3.1 UseCasePickerStep (already exists)

- Must be shown whenever `payload.use_cases.length > 1`. For
  single-UC templates, picker is skipped.
- Picker selection drives:
  - which questions render (P5),
  - which matrix cells render (P1),
  - which triggers/channels/events are included in the built persona
    (P1),
  - which connector-empty-state gates activate (P8 — only required
    connectors whose owning UCs are still enabled).

### 3.2 Questionnaire step

New filtering rule applied before rendering each question:

```typescript
function shouldShowQuestion(q: AdoptionQuestion, enabledUcIds: Set<string>): boolean {
  if (!q.use_case_ids || q.use_case_ids.length === 0) return true; // persona-level
  return q.use_case_ids.some(id => enabledUcIds.has(id));
}
```

Connector-scope questions additionally check that the named connector's
owning UCs aren't all disabled (if every UC that references the
connector is off, don't ask for its config).

### 3.3 Trigger/message composition step (new)

When the template's `trigger_composition` or `message_composition` is
set (or the default applies), adoption renders a dedicated step after
UC selection:

- **Trigger**: for each enabled UC (or once, if composition=shared),
  show a quick-setup widget: `daily | weekly | hourly | custom`, with
  time-of-day and weekday selectors when appropriate. Default from
  `suggested_trigger.config.cron`. "Shared" composition collapses the
  list into a single widget and stamps the chosen cron onto every UC at
  promote time.
- **Message**: for each enabled UC (or once), pick a delivery
  (in-app / email / slack / webhook). "Combined" composition
  concatenates outputs before delivering.

Rendering this step requires a new component —
`src/features/templates/sub_generated/adoption/TriggerCompositionStep.tsx`
and `MessageCompositionStep.tsx`. Deferred from this session.

### 3.4 Connector gate (new)

Before rendering a question whose `scope === 'connector'`, check if
the user has at least one credential for that connector's service_type.
If not:

- **Required connector** → render an empty-state card with the
  connector's `setup_instructions`, a "Create credential" CTA that
  opens the vault create flow, and a "Return to adoption" callback.
  Progression past this step is blocked.
- **Optional connector** → render a pick-or-skip card. "Skip" sets a
  session flag that's passed to the promote pipeline, which strips the
  connector from the persona and verifies the fallback path exists in
  the prompt.

Deferred from this session. Current behavior: the question step
renders but the user sees an empty picklist (dropdowns from
`dynamic_source` return zero options). Not great UX, but not broken.

### 3.5 Matrix view

`PersonaMatrixBlueprint` / `PersonaMatrixGlass` / `PersonaChronologyChain`
already read `design_context.useCases[]`. v3.1 requires them to filter
by the enabled set:

- Read the promoted persona's enabled UC list.
- Render only cells whose UC is enabled.
- For shared-composition triggers: render one trigger cell with a
  "shared across X capabilities" affordance.

The filtering belongs in `useUseCaseChronology.ts`. A one-line filter
over the produced cell list, given the enabled set. Minor change.

---

## 4. Prompt contract changes

### 4.1 Prompt only includes enabled capabilities

The promote pipeline walks the v3 template, produces the flat IR, and
builds the prompt. v3.1 requires:

- `Active Capabilities` section in the prompt lists ONLY the enabled
  UCs. Disabled UCs are invisible — not `[disabled]`, not a footnote.
- `Operating Instructions` sections are filtered to drop any step
  scoped to a disabled UC (authors should write `operating_instructions`
  with explicit per-UC sub-sections so filtering is clean).

### 4.2 Flow diagrams never enter the prompt

`use_case_flow.nodes[].label/detail` do not go to the LLM. They're UI
only. This removes a common source of prompt bloat in templates
authored so far. The `operating_instructions` text is authoritative.

---

## 5. Worked example — Financial Stocks Signaller (v3.1)

**Unifying goal:** provide valuable data for investment decisions.

### Persona-level

```jsonc
"persona": {
  "identity": {
    "role": "Investment research agent that turns noisy market data into weekly, reviewed decisions.",
    "description": "Aggregates signals, congressional disclosures, and sector dives into one weekly briefing. Every data point is cited; every recommendation carries a confidence score and an explicit uncertainty disclaimer."
  },
  "trigger_composition": "shared",                   // all UCs fire on the same weekly tick
  "message_composition": "combined",                 // one weekly briefing, not three
  "connectors": [
    { "name": "market_data",     "required": true,  ... },
    { "name": "quiver_quant",    "required": true,  ... },  // congressional disclosures
    { "name": "alpha_vantage",   "required": false, "fallback_note": "When Alpha Vantage is absent, fall back to Yahoo Finance public endpoints — historical coverage is reduced but current-price checks still work.", ... },
    { "name": "messaging",       "required": true,  ... }
  ]
}
```

### Use cases (3)

1. **`uc_signals` — Weekly signal fetcher**
   - Purpose: RSI/MACD/momentum signals on user-selected tickers.
   - Review policy: `always`. Reviewed decisions persist as simulated
     trades in memory → the trade is included in the weekly briefing.
   - Memory: simulated-trade ledger keyed by ticker + date.
   - Events emitted: `stocks.signals.buy`, `stocks.signals.sell`,
     `stocks.signals.hold`.
   - Default trigger: weekly Monday 08:00 (overridden by shared
     composition).
   - Questions linked: `aq_tickers` (which tickers to watch),
     `aq_signal_weighting` (how to weight RSI vs MACD vs momentum).

2. **`uc_congressional_scan` — Congressional disclosure scan**
   - Purpose: detect recent congressional trading disclosures in user's
     sectors of interest.
   - Review policy: `always`. Reviewer tags report as useful / not useful
     → memory note influences next scan's filter tightness.
   - Events emitted: `stocks.congress.disclosure`,
     `stocks.congress.sector_shift`.
   - Questions linked: `aq_sector_interest` (shared with `uc_gems`).
   - NOT linked: `Track congressional disclosures?` — removed per P5.

3. **`uc_gems` — Sector gem discovery**
   - Purpose: find under-covered names with strong signals in user's
     interest sectors.
   - Review policy: `always`. Reviewer tags report usefulness →
     memory adjusts next scan's thresholds.
   - Events emitted: `stocks.gems.discovered`, `stocks.gems.filtered_out`.
   - Questions linked: `aq_sector_interest`.

### Adoption questions (5, down from 8)

```
- aq_tickers           — use_case_ids: [uc_signals]
- aq_signal_weighting  — use_case_ids: [uc_signals]
- aq_sector_interest   — use_case_ids: [uc_congressional_scan, uc_gems]
- aq_message_channel   — use_case_ids: [] (persona-level)
- aq_alpha_vantage_pick — scope: connector, connector_names: [alpha_vantage]
                          — renders as pick-or-skip per P8
```

Questions removed from the current template:
- `aq_lookback_hours` — rolled into `suggested_trigger.config` via P2.
- `aq_max_digest_items` — lives in prompt, not adoption.
- `aq_strategy_backtest_enabled` — use case removed.

### Descope: `uc_strategy_backtest`

Removed entirely. Paper-trading backtest capability is not in this
template's scope.

---

## 6. Worked example — Idea Harvester (v3.1)

**Unifying goal:** extract valuable backlog items from noisy sources.

### Persona-level

```jsonc
"persona": {
  "identity": {
    "role": "Backlog intelligence agent that mines ideas from wherever the user works and funnels them through human triage.",
    "description": "Watches sources the user chooses (Slack, email, Notion, codebase), extracts structured backlog candidates, triages through user review, and promotes accepted ones into the configured backlog system."
  },
  "trigger_composition": "per_use_case",             // each UC has its own trigger
  "message_composition": "per_use_case",
  "connectors": [
    { "name": "codebase",  "required": true,  ... },  // hard requirement for uc_codebase_analysis
    { "name": "slack",     "required": false, "fallback_note": "Source disabled; uc_harvest runs without Slack input.", ... },
    { "name": "notion",    "required": false, "fallback_note": "Source disabled; uc_harvest runs without Notion input.", ... },
    { "name": "messaging", "required": true,  ... }
  ]
}
```

### Use cases (3)

1. **`uc_harvest` — Idea harvesting**
   - Purpose: scan configured sources for candidate backlog items.
   - Review policy: `never` (triage is a separate UC).
   - Memory: source yield stats per source (volume, accept rate).
   - Events emitted: `harvester.idea.new`.
   - Default trigger: weekly Monday 09:00.
   - Questions linked: `aq_sources` (which sources to harvest),
     `aq_content_types` (what kinds of content),
     `aq_ideas_per_source` (max harvested per source per tick).

2. **`uc_triage` — Triage pipeline**
   - Purpose: present harvested items for user accept/reject with
     memory-based auto-suggestion over time.
   - Review policy: `always`. Accept/reject decisions persist in
     memory as pattern training data.
   - Events emitted: `harvester.triage.accepted`,
     `harvester.triage.rejected`.
   - Default trigger: event-listen on `harvester.idea.new` (fires
     whenever `uc_harvest` emits).
   - Questions linked: `aq_backlog_format` (how accepted items are
     structured).

3. **`uc_codebase_analysis` — Codebase feasibility analysis**
   - Purpose: for each accepted backlog item, analyze codebase
     feasibility (affected files, estimated effort, risk flags).
   - Review policy: `never`. The analysis is advisory output attached
     to the backlog item.
   - Events emitted: `harvester.backlog.new`.
   - Default trigger: event-listen on `harvester.triage.accepted`.
   - Questions linked: `aq_target_codebase` (mandatory, uses
     `ui_component: "CodebaseSelector"`), `aq_analysis_depth`.
   - Connector: `codebase` (required). If the user has no codebase
     credential, adoption blocks at this UC's question step.

### Adoption questions (6)

```
- aq_sources            — use_case_ids: [uc_harvest]
- aq_content_types      — use_case_ids: [uc_harvest]
- aq_ideas_per_source   — use_case_ids: [uc_harvest]
- aq_backlog_format     — use_case_ids: [uc_triage]
- aq_target_codebase    — use_case_ids: [uc_codebase_analysis]  (ui_component: CodebaseSelector)
- aq_analysis_depth     — use_case_ids: [uc_codebase_analysis]
```

No persona-level questions — the persona's behavior is defined by the
unifying goal plus the per-UC questions.

### Per-UC trigger composition UI

Because `trigger_composition: "per_use_case"`, the adoption step
renders three triggers with quick-setup presets:

- `uc_harvest`: weekly / Monday / 09:00 (default)
- `uc_triage`: event-listen on `harvester.idea.new` (not
  user-configurable — event triggers hide the quick-setup picker)
- `uc_codebase_analysis`: event-listen on `harvester.triage.accepted`
  (same — hidden from user)

---

## 7. Status of existing hand-authored templates

All five templates authored under the first v3 pass now need rewrites
or partial updates to comply with v3.1:

| Template | Status under v3.1 | Action |
|---|---|---|
| `productivity/email-morning-digest` | Violates P6 (flow density), needs `scope` rename | Light edit |
| `finance/financial-stocks-signaller` | Violates P1/P5/P6, wrong UC count, includes descoped `uc_strategy_backtest` | **Full rewrite this pass** |
| `hr/onboarding-tracker` | Unknown — not re-reviewed | Revisit later |
| `content/youtube-content-pipeline` | Uses `scope: "capability"` (old), flow density excessive | Light edit |
| `development/autonomous-issue-resolver` | Uses singular `use_case_id`, flow density excessive | Light edit |

The 13 translation overlays for `autonomous-issue-resolver` continue to
apply — v3.1 field renames happen at the canonical level and the
overlay merge is schema-agnostic.

**For the Financial Signaller rewrite, the 13 existing overlays
authored under the old 4-UC shape MUST be deleted.** Re-translation
happens after the canonical English is stable.

---

## 8. Deferred items (explicit non-goals for this delta)

1. **TriggerCompositionStep / MessageCompositionStep UI components** —
   documented in §3.3. Current behavior: per-UC trigger from
   `suggested_trigger` is used as-is; user can't reconfigure at
   adoption. Good enough for an internal test pass; ship before
   external users.
2. **Connector gate empty-state** — documented in §3.4. Current
   behavior: unconfigured connectors surface as empty dropdowns. UX
   regression acknowledged; not blocking.
3. **Quick-setup trigger presets** — ride with §3.3.
4. **UI component registry (`CodebaseSelector` et al)** — documented in
   §2.4. For now `ui_component` is a hint string that the UI can look
   up; fallback to default renderer if unknown.
5. **Event name linting** — documented in §2.5. Authors are on the
   honor system for now.

---

## 9. Normalizer changes (backend)

`src-tauri/src/engine/template_v3.rs::normalize_v3_to_flat` requires:

1. **Read both `use_case_id` (deprecated) and `use_case_ids` (new)** on
   adoption questions. Emit a `use_case_ids` array in the flat IR
   regardless of the input shape. Log a warning when the deprecated
   form is used.
2. **Preserve `required` on connectors** into the flat IR's connector
   list so the adoption UI can branch on it.
3. **Preserve `trigger_composition`, `message_composition`** on the
   persona-level object in the flat IR.
4. **Strip `use_case_flow`** from flat IR output destined for the prompt
   builder (it's UI-only). Keep it on the side of the IR meant for the
   chronology view.

Unit tests additions (`template_v3.rs`):
- Deprecated `use_case_id` is migrated to `use_case_ids: [id]`.
- Multiple `use_case_ids` preserved as array.
- `required` preserved on connectors with default `true` when missing.
- Composition fields preserved with defaults.
