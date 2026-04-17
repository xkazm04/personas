# Adoption questionnaire

The form the user fills in between clicking "Adopt" and seeing the
Matrix. Renders every question from the template's
`payload.adoption_questions` array with category grouping, vault
auto-detect, dynamic discovery, and a live persona preview.

## Rendering model

Single variant: `QuestionnaireFormFocus.tsx`. (Early Waves shipped a
Grid and Carousel variant with a tab switcher; these were removed in
Wave 6 based on user preference — the shared sub-components still live
in `QuestionnaireFormGrid.tsx` and are `export`ed for reuse.)

```
 QuestionnaireFormFocus
 ├── Header (centered max-w-5xl)
 │     ├── Title + answered/blocked counter
 │     └── Stepper strip (one dot per question, clickable)
 │
 ├── Two-column stage (centered max-w-5xl)
 │     ├── LEFT: one big QuestionCard
 │     └── RIGHT: live persona brief (category-grouped answer summary)
 │
 └── Footer (centered max-w-5xl)
       └── Previous | Next / Submit
```

### Centering

Header, stage, and footer all wrap in `max-w-5xl mx-auto` so on wide
screens (BaseModal uses `max-w-[1750px]`) the question and the preview
stay visually close together. Without this, the two halves sat ~1500 px
apart on 4K monitors.

### Focus column sizing

The stage grid is
`grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]` — the
question panel gets ~60% and the preview ~40%. The preview panel has
a `bg-white/[0.015]` wash and a `sticky top-0` inner wrapper so it
stays visible as the left column scrolls.

## Shared sub-components

Exported from `QuestionnaireFormGrid.tsx`:

| Export | Purpose |
|---|---|
| `QuestionCard` | Renders a single question — status icon, label, optional info-tip toggle, and the appropriate input type |
| `SelectPills` | Pill-based single/multi select with `allow_custom` text input |
| `PillOption` | `{value, label, sublabel?}` type for pills |
| `DynamicSelectBody` | Dynamic-source wrapper showing loading/error/ready states around SelectPills |
| `CATEGORY_META` | Map of category key → `{label, Icon, color, bg, border}` |
| `FALLBACK_CATEGORY` | Neutral meta for unknown categories |
| `groupByCategory` | Groups a question array by `q.category` |

Rule: **always reuse these.** The Focus variant depends on them, and
any new questionnaire variant (if ever added again) should too. Do not
duplicate question rendering logic.

## Question types

Defined in `TransformQuestionResponse` at `src/api/templates/n8nTransform.ts`:

```ts
interface TransformQuestionResponse {
  id: string;
  category?: string;
  question: string;
  type: 'select' | 'text' | 'textarea' | 'boolean'
      | 'devtools_project' | 'directory_picker' | 'source_definition';
  options?: string[];
  default?: string;
  context?: string;               // shown in collapsible tip
  allow_custom?: boolean;         // lets user type a custom value
  vault_category?: string;        // credential category for banner
  option_service_types?: (string | null)[];  // parallel array for auto-detect
  dynamic_source?: {              // live-discovery for pills
    service_type: string;
    operation: string;
    depends_on?: string;
    multi?: boolean;
    include_all_option?: boolean;
  };
}
```

### Input selection

`QuestionCard` picks the input based on `question.dynamic_source` first,
then `question.type`:

1. **`dynamic_source`** → `DynamicSelectBody` — overrides everything.
   Shows the API-loaded pills (or loading/error UI).
2. **`type === 'select'` with `options`** → `SelectPills` with
   `filteredOptions ?? options` (vault-narrowed when 2+ credentials
   match).
3. **`type === 'boolean'`** → `BooleanToggle` — Yes/No.
4. **`type === 'devtools_project'`** → `DevToolsProjectDropdown` —
   picks from registered codebases (local `dev_projects` table).
5. **`type === 'directory_picker'`** → `DirectoryPickerInput` — OS
   native folder picker via Tauri shell API.
6. **`type === 'textarea'`** → `<textarea>`.
7. **`type === 'source_definition'`** → `SourceDefinitionInput`
   (structured picker for agent input sources — URLs, local files,
   directories). `summarizeSourceDefinition` formats the stored value
   for the live preview.
8. **Default** → `<input type="text">`.

### Multi-select + CSV encoding

Multi-select values live in the same `Record<string, string>` answer
map as single-select. They're CSV-encoded:

```
"repo1,repo2,repo3"   // three selected
"all"                 // the ALL_SENTINEL
""                    // nothing selected
```

`parseCsv` / `toCsv` helpers in `QuestionnaireFormGrid.tsx`. The
`ALL_SENTINEL` constant is the literal string `"all"` — used when
`include_all_option` is true. Picking a real option clears the
sentinel; picking "All" clears all real selections.

### Custom values (`allow_custom`)

Single-select + `allow_custom` shows a **Custom…** pill that reveals
a text input. Committing (Enter or blur) replaces the answer with the
typed value.

Multi-select + `allow_custom` shows **+ Custom…** plus an explicit Add
button. Typed values become dismissable primary-colored pills next to
the preset pills. Users can keep adding more custom entries. Dismissing
a custom pill (X button) removes it from the CSV.

### The info tip

`q.context` renders as a collapsible tip. `QuestionCard` shows an
`Info` icon on the right of the question label; clicking toggles a
bordered box below the question with the context text. Default state
is collapsed — the tip only opens on user request so the form stays
visually lean.

## Vault matcher

`src/features/templates/sub_generated/shared/vaultAdoptionMatcher.ts` —
`matchVaultToQuestions(questions, credentialServiceTypes)` returns:

```ts
{
  autoAnswers: Record<string, string>,     // id → auto-selected option
  autoDetectedIds: Set<string>,            // badge these with "auto"
  blockedQuestionIds: Set<string>,         // show "Add credential" banner
  filteredOptions: Record<string, string[]>, // narrowed option lists
}
```

### Dynamic-source branch

If `q.dynamic_source`:
- If `service_type === 'codebases'` → always allowed (no credential
  required).
- Else check `hasMatchingCredential(service_type,
  credentialServiceTypes)` — alias-aware (see below).
- If no match → add to `blockedQuestionIds`.

### Vault-aware select branch (Wave 1 pattern)

If `q.vault_category` + `q.option_service_types` + `q.options`:

1. Walk `option_service_types` in parallel with `options`. Each entry
   is either a service_type string (e.g. `"sentry"`) or `null` (the
   "Other" fallback).
2. Count matching credentials. `null` entries accumulate separately as
   fallback indices.
3. Decide:
   - **1 match** → set `autoAnswers[q.id]` to the matching option,
     add to `autoDetectedIds` (UI shows violet "auto" badge).
   - **0 matches + no null fallback** → add to `blockedQuestionIds`.
     UI shows the question in blocked state + top banner.
   - **2+ matches** → populate `filteredOptions[q.id]` with just the
     matched options + any null fallbacks. Question renders as normal
     pills but narrowed to what the user actually has.
   - **0 matches + has null fallback** → nothing happens. Question
     renders with all options visible; user can pick "Other" and
     supply a custom value.

### Service type aliases

`SERVICE_TYPE_ALIASES` normalizes cloud provider names that get stored
under two spellings depending on creation path:

```ts
{
  gcp_cloud:   ['gcp_cloud', 'google_cloud'],
  aws_cloud:   ['aws_cloud', 'aws'],
  azure_cloud: ['azure_cloud', 'azure'],
}
```

| Creation path | service_type stored |
|---|---|
| Catalog form (built-in connector JSON) | `gcp_cloud`, `aws_cloud`, `azure_cloud` |
| `auth_detect.rs` CLI probes | `aws`, `google_cloud`, `azure` |
| `foraging.rs` file scraping | `aws` |
| `healthcheck.rs` live detection | `aws`, `google_cloud`, `azure` |

The `hasMatchingCredential()` helper walks the alias set before
reporting a match. Extend this map when adding new CLI probe sources.

Without the alias map, a user who `aws configure`'d their shell (so
the CLI probe created a credential named `"aws"`) would silently fail
to match any template that references `"aws_cloud"`. That was the
Budget Spending Monitor bug that surfaced the whole category.

## Credential-required banner

`QuestionnaireFormFocus` iterates `blockedQuestionIds` and groups by
`vault_category` to produce a top-of-form banner:

- Shows each blocked category with the list of blocked questions
  beneath it
- **Add credential** button → `handleAddCredentialForCategory(category)`
- Submit stays disabled until `blockedCount === 0`

### Add credential redirect + resume

`handleAddCredentialForCategory`:

1. Saves current `adoptionAnswers` to `systemStore.adoptionDraft`.
2. Sets `pendingCatalogCategoryFilter` so the Catalog page opens
   pre-filtered to the right category.
3. Switches sidebar to credentials section.
4. Closes the wizard modal.

When the user returns to the template (via the banner), the defaults
effect checks `adoptionDraft.reviewId === review.id` and merges the
saved answers back in. Draft is cleared once restored.

## Progress + submission

`answeredCount = questions.filter(q => !!userAnswers[q.id]).length`
`canSubmit = answeredCount === questions.length && blockedCount === 0`

The Submit button:
- **Disabled** until all answers set and no blocks
- **Primary CTA** at the end step; Next button otherwise

Clicking Submit calls `onSubmit()` which flips `questionsComplete =
true` in `MatrixAdoptionView`, triggering the seed effect. See
[03-adoption-flow.md](03-adoption-flow.md) Phase 4.

## Keyboard navigation

Focus variant handles four global shortcuts:

- **Arrow Right** → Next question (ignored while typing so textareas
  can still use arrows for caret movement)
- **Arrow Left** → Previous question (same ignore-while-typing guard)
- **Enter** → Advance to next question. Works from a plain text input
  OR a textarea WITHOUT Shift (so Shift+Enter still inserts a newline
  inside textareas). This is the "quick path" — users can tab through
  the questionnaire without reaching for the mouse. Enter is ignored
  for non-text `<input>` types (button, submit, checkbox, ...).
- **Escape** (inside custom input within `SelectPills`) → Cancel the
  custom input draft.

The guard checks `target.tagName === 'INPUT' || 'TEXTAREA' ||
isContentEditable` before firing arrow keys, and separately routes
Enter through the input/textarea branch to keep typing hotkeys natural.

## Live preview (right column)

Renders a persona "brief" card that mirrors the template's category
structure. Each question appears as a row grouped under its category:

- **Answered** → emerald checkmark + full-color value summary
- **Auto-detected** → adds a tiny "auto" badge in violet
- **Blocked** → rose alert icon + red question label
- **Pending** → amber circle + italic muted "Not yet set"

Every row is clickable and jumps the Focus left column to that
question. `summarizeAnswer` formats CSV answers compactly:
- `""` → empty
- `"all"` → "All"
- `"repo1"` → "repo1"
- `"repo1,repo2"` → "repo1 and repo2"
- `"repo1,repo2,repo3,repo4"` → "repo1, repo2 +2 more"

## How answers reach the persona

Answers are persisted to `build_sessions.adoption_answers` via the
`save_adoption_answers` IPC command when the questionnaire completes.
During `test_build_draft` and `promote_build_draft_inner`, the backend
reads these answers and applies two transformations to the `AgentIr`:

1. **Variable substitution** — `{{param.aq_config_1}}` placeholders in
   the prompt get replaced with actual values.
2. **Configuration injection** — a `## User Configuration` section is
   appended to `system_prompt` listing all Q→A pairs.

This means every adopted persona's prompt carries the user's configured
values, and tests run against real config rather than template defaults.
See [07-adoption-answer-pipeline.md](07-adoption-answer-pipeline.md)
for the full mechanics.

## Adding a new question type

1. Add the type literal to the `type` union in
   `TransformQuestionResponse`.
2. Add a render branch in `QuestionCard` (in
   `QuestionnaireFormGridParts.tsx`) before the default text input fallback.
3. Add a default-answer handler if the type needs special
   initialization (most don't — `q.default` is a string).
4. Update the audit script if you want the new type classified
   differently (currently `audit-adoption-questions.cjs` buckets
   unknown types as "text candidates").
5. No Rust changes needed for rendering — the backend treats
   `design_result.adoption_questions` as opaque JSON. The answer
   pipeline reads answers by question ID regardless of type.

## Anti-patterns

- **Don't create a new variant file** for a UX experiment. Early Waves
  had Grid + Carousel variants — both got deleted once Focus proved
  superior. If you need to try a new layout, fork Focus, test, and
  replace rather than adding a switcher.
- **Don't bypass the shared `QuestionCard`.** Rendering a question any
  other way means re-implementing dynamic-source, vault-aware
  filtering, blocked states, info tips, auto-detect badges, and the
  allow_custom pattern. It's ~300 LOC you don't want to copy.
- **Don't store multi-select answers as arrays.** The answer map is
  `Record<string, string>` throughout the adoption pipeline (including
  the backend build-session serialization). CSV-encode at the UI
  boundary; decode if/when you need array semantics.
- **Don't block submission for questions without `default`.** Some
  questions (`type: textarea`, `type: text`) legitimately start empty.
  `allAnswered` only counts truthy values, so missing-but-required
  questions bubble up naturally.
