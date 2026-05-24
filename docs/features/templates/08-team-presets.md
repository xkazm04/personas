# Team Presets — Multi-template adoption bundles

> Read this when authoring a new preset for the gallery, or when
> debugging the bulk-adoption flow.

A **team preset** is a filesystem-shipped manifest that bundles N
persona templates plus the team wiring (PersonaTeam metadata +
members + connections, optionally a PersonaGroup binding) needed to
land them as a working multi-agent setup in one click. Presets live
parallel to single-template `.json` files but in a private folder
(`scripts/templates/_team_presets/`) so the existing template loader
skips them — they're a separate primitive, not a template variant.

## Lifecycle at a glance

```
scripts/templates/_team_presets/<id>.json   (source of truth, hand-authored)
        │
        ▼ engine::team_preset_loader (validates schema + role uniqueness)
list_team_presets / get_team_preset (Tauri IPC)
        │
        ▼ PresetLibraryPage (templates → presets sub-tab)
PresetPreviewModal — graph preview + per-member rows (each row shows the
   template name + one-line description from the adoption schema, and is a
   toggle: click to include / exclude that member from the adoption)
        │
        ▼ user clicks "Adopt N members" (label tracks the selection)
adopt_team_preset IPC  (roles: Option<Vec<String>> — the selected subset,
   or null to adopt every member)
        │
        ├─ groups::create               (optional)
        ├─ teams::create                (always — kept on partial failure)
        ├─ FOR each SELECTED member:
        │    instant_adopt_template_inner
        │    UPDATE personas.group_id   (if bound)
        │    teams::add_member
        │    emit `team-preset-adopt-progress` (queued | adopting | done | failed)
        └─ FOR each connection:
             skip if either endpoint role failed
             teams::create_connection
        │
        ▼ AdoptedTeamPresetResult
PresetPreviewModal renders per-row status, "Open team" CTA
```

## Manifest schema (v1)

See `src-tauri/src/db/models/team_preset.rs` for the canonical typed
shape. Authoring guide:

```jsonc
{
  "id": "backlog-execution",       // matches filename minus .json
  "schema_version": 1,             // bumped if the format ever changes
  "name": "Backlog & Execution",
  "description": "One-line value prop for the gallery card.",
  "icon": "Layers",                // lucide-react icon name
  "color": "#F59E0B",              // hex; used by card stripe + team
  "category": ["productivity", "development"],  // gallery filter tags

  "team": {
    "name": "Backlog & Execution",
    "description": "Optional team subtitle",
    "color": "#F59E0B"             // overrides outer color for PersonaTeam.color
  },

  "group": {                       // OPTIONAL — omit if no group binding
    "name": "Product & Engineering",
    "color": "#F59E0B",
    "shared_instructions": "..."   // stamped via update_group post-create
  },

  "members": [
    {
      "template_id": "idea-harvester",   // must match a real template's id
      "role": "triage",                  // unique within the preset
      "x": 240,                          // canvas coords (set by author)
      "y": 100
    }
    // ...
  ],

  "connections": [
    {
      "from": "capture",
      "to": "triage",
      "connection_type": "data",        // or "feedback" (dashed in preview)
      "label": "ad-hoc captures"        // optional
    }
    // ...
  ]
}
```

## Validation done at load time

`engine::team_preset_loader::list_presets` + `get_preset` validate:

1. **`schema_version == 1`** — newer manifests get a structured error
   so an older build doesn't silently mis-parse.
2. **`members[].role` unique** within a preset — connections
   reference roles by string, so a duplicate would silently bind to
   the first occurrence.
3. **`connections[].from` / `.to` resolve to known roles** — an
   unknown role at load time means the manifest can never wire that
   edge.

Template references (`members[].template_id`) are NOT validated at
load time. Coupling the loader to the template catalog would force
a full read on every list call. The adopter validates per-template at
adoption time and surfaces a precise error per missing template.

Invalid manifests are LOGGED (via `tracing::warn`) and SKIPPED by
`list_presets` — one bad manifest doesn't take the whole gallery
offline.

## Partial-success semantics

`adopt_team_preset` is explicitly not transactional across the
whole flow — too many sub-IPCs to wrap in one tx. The contract:

- **The team shell is created unconditionally.** Even if every member
  fails, the user keeps the team so they can retry from the gallery
  without losing the configured name/color.
- **Each member adoption is independent.** A failure on member N
  doesn't abort member N+1; the failure is captured in
  `AdoptedTeamPresetResult.failed_members` with the underlying error
  string.
- **Connections are silently skipped when either endpoint role
  failed.** The edge can't resolve to a member id on at least one
  side; rendering a stale edge would just create UI clutter.
- **Group binding is best-effort.** If the post-adopt
  `UPDATE personas.group_id` fails, the failure is logged but doesn't
  fail the member (the persona itself is still real and usable; the
  group binding just didn't take).

The preview modal handles this contract by rendering `failed_members`
inline next to their role rows so the user can decide whether to
retry the manifest or fix the failing template's prerequisites
(usually missing credentials).

## Locale overlays

Each canonical preset can ship sibling translation files alongside it:

```
scripts/templates/_team_presets/
  ├── backlog-execution.json           ← canonical (English, source of truth)
  ├── backlog-execution.zh.json        ← Chinese overlay (partial)
  └── backlog-execution.de.json        ← German overlay (partial)
```

Overlay files contain ONLY the user-facing strings that differ from
canonical. Anything absent in the overlay falls through to English at
load time, so a translation team can ship `name` + `description` first
and add `group.shared_instructions`, member labels, and connection
labels later without breaking anything.

**Pipeline:**

1. `team_preset_loader::list_presets(language)` / `get_preset(id,
   language)` parse the canonical file into a `serde_json::Value`,
   then recursively merge the matching `<id>.<lang>.json` sibling on
   top (objects: overlay keys override; arrays: zip by index;
   primitives: overlay wins). Result is then deserialized to the
   typed `TeamPreset` model.
2. The frontend wrappers in `src/api/templates/teamPresets.ts` read
   the active language from `useI18nStore` at call time and pass it
   to every IPC. English short-circuits to `null` (no overlay
   lookup) — the canonical file IS English.
3. The same `language` is threaded through `adopt_team_preset` and
   `retry_team_preset_members` so the team / group / member names
   that get persisted to SQLite match what the user saw in the
   preview modal. Switching language AFTER adoption does NOT
   re-translate existing teams; they're frozen at the locale active
   when the adopt button was clicked.

**Authoring rules:**

- Structural fields (`id`, `schema_version`, `member.role`,
  `member.template_id`, `connection.from`, `connection.to`) MUST stay
  identical between canonical and overlay. A drift would fail
  role-uniqueness or unknown-role validation and the loader silently
  skips the whole preset (the gallery still shows English).
- Array overlays zip by index. The overlay's `connections` array, if
  present, must have the same length and the same ordering as
  canonical — only the user-facing fields (`label` today) need
  translation; structural fields can be omitted from each array
  element and they fall through to canonical via the deep-merge.
- Bad overlay files (missing file, parse error, validation failure
  on the merged result) → canonical English is returned and the
  failure is logged via `tracing::warn`. Translation lag never
  breaks the gallery.

If you add a new preset and want to ship a first translation along
with it, copy the canonical, strip everything except user-facing
fields, translate them, and save as `<id>.<lang>.json`. See
`scripts/templates/_team_presets/backlog-execution.zh.json` for a
minimal worked example.

## Combined questionnaire

Member templates ship `payload.adoption_questions[]` — configurable
knobs the single-template adoption flow surfaces in
ChronologyAdoptionView. For a preset (a bundle of N templates with
~5–10 questions each), the **combined questionnaire** aggregates
every member's questions into one form inside `PresetPreviewModal`,
behind a "Customize first" toggle.

### Pipeline

1. **`get_preset_adoption_schema(preset_id, language)`** IPC walks
   every member template, extracts `payload.adoption_questions[]`,
   and returns a per-role schema (`PresetAdoptionSchema` →
   `members[]` with `role`, `template_id`, `template_name`,
   `template_description`, `questions[]`). Members whose template
   file is missing/unreadable are SKIPPED from the schema view
   (logged via `tracing::warn`); the adopter surfaces real
   missing-template errors at adopt time, so the schema endpoint
   is UX-best-effort.

2. **`PresetPreviewModal`** lazy-fetches the schema when the modal
   opens. The "Customize" button only renders when
   `total_question_count > 0`. Clicking it expands
   `PresetQuestionnaireForm` between the team-graph adapter and the
   member-rows section. Sections are collapsed by default — for a
   6-member preset with ~40 questions, expanding everything would
   overwhelm; the user only opens what they intend to change.

3. **Each control renders per question type** (select / number /
   boolean / text/string). Numeric `min`/`max`/`unit` from the
   question schema map to HTML5 input attributes. Validation is
   intentionally minimal in the UI — server-side normalization in
   `populate_persona_parameters_from_design` coerces per the
   question's declared type, so an out-of-range number or a
   misspelled select value falls back to the template default
   rather than crashing.

4. **Override channel** (cycle preset/questionnaire-overrides):
   answers flow through `adoptTeamPreset` →
   `adopt_team_preset` Tauri command → `team_preset_adopter::
   adopt_preset` → `instant_adopt_template_inner` with a new
   optional `parameter_overrides` arg, which forwards to the
   existing `populate_persona_parameters_from_design(answers)`
   path. Crucially, the **design JSON bytes are not mutated** —
   `check_template_integrity` runs FIRST on the design string and
   would reject any pre-mutation. The override rides as a parallel
   channel and lands as `persona.parameters[KEY].value` while
   `default_value` keeps the template original (so a future
   "Reset to defaults" affordance is well-defined).

5. **Same overrides flow through retry** — `retryTeamPresetMembers`
   accepts the same override map, so a customized answer that
   landed correctly on the first attempt's successful members
   also applies to retried failures from the same modal session.

### Override scope (important limitation)

The override channel lands answers via
`populate_persona_parameters_from_design`, which applies them **only**
to questions whose `maps_to` is `persona.parameters[KEY]`. As of this
writing exactly **1 of 109** catalog templates uses that mapping
(`vault-grounded-journal-coach`); the other 105 map to
`use_cases[…].sample_input.*`, which the **instant-adopt path does
not consume** (only the heavier build-session / Glyph flow runs
`substitute_variables` + sample_input seeding).

Concretely: for a preset whose members all use `use_cases`-mapped
questions (e.g. `backlog-execution`), the questionnaire still renders
and collects answers, but those answers have no observable effect on
the adopted personas. The `reflective-journaling` preset exists partly
as a working example of the supported path — its single member is the
one parameter-mapped template, and
`tests/playwright/preset-questionnaire.spec.ts` asserts an override
lands as `persona.parameters[KEY].value`.

**Follow-up:** to make `use_cases`-mapped answers effective in preset
adoption, the adopter would need to apply them into the persona's
persisted `use_cases[UC].sample_input` after `instant_adopt` returns
(seeds test runs + the Use Cases tab), or route preset members through
the build-session flow. Tracked, not yet built.

### Authoring rules

- New preset members automatically pick up the questionnaire — no
  schema bump needed in the preset manifest. The questions come
  from the template's own `payload.adoption_questions[]`. (See the
  override-scope limitation above — only `persona.parameters`-mapped
  questions currently take effect through the preset adopter.)
- If a template has no `adoption_questions`, its member section
  renders "No configuration needed" rather than being hidden, so
  the user sees the full member list and understands the
  questionnaire's scope.
- Question-label localization is handled by the existing template
  overlay system (`<id>.<lang>.json` siblings in the template's
  category dir, not in `_team_presets/`). The frontend reads the
  passthrough question JSON; translated labels arrive through the
  same lazy-load pathway the single-template flow uses.

## End-to-end test

`tests/playwright/preset-team-adoption.spec.ts` drives the live app
(via the existing test-automation HTTP bridge on :17320) through the
full adoption flow for `backlog-execution`:

```bash
npm run tauri:dev:test   # start the app with --features test-automation
npx playwright test preset-team-adoption  # in a second terminal
```

The spec waits for every member row to settle on `done` or `failed`
(via the `data-status` attribute on each `[data-testid="preset-row-
<role>"]` element, which the modal updates from
TEAM_PRESET_ADOPT_PROGRESS events), then reads back via `list_teams`
/ `list_groups` / `list_team_members` / `list_team_connections` to
verify the wiring landed correctly.

The spec deliberately accepts partial failure — when the test vault
lacks credentials for a template's required connectors, the persona
adopts but lands in `setup_status=needs_credentials`, which is a
wiring success (and what this test verifies), not a runtime success.
