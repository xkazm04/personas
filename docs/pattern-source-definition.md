# Source Definition Pattern

A reusable UI pattern for "where does this data come from?" questions —
lets a user supply a source of truth without having to remember path
syntax, credential IDs, or connector jargon.

## When to use

Any time a template (or other form) needs the user to point at an
external resource as input to an agent: a design brief, a dataset, a
document store, a schema reference, a knowledge base, a contract, a
sitemap, a rule set.

Previously these questions were modelled as free-form textareas or as a
pair of questions (`select(kind)` + `text(path)`) that were awkward to
validate and easy to get wrong.

## How it works

The user picks a **kind** tab and is shown a kind-specific picker:

| Kind       | Input                                           | Resource source                              |
|------------|-------------------------------------------------|----------------------------------------------|
| `local`    | Plain text path                                 | Local filesystem (any path the user types)   |
| `codebase` | Select one Dev Tools project                    | `dev_projects` table (via `listProjects()`)  |
| `database` | Select one credential                           | Credentials whose connector `category === 'database'` |

Tabs are disabled when the user has no matching resources so they never
land on an empty pane. When only one resource exists, the picker
degrades to a single-card "confirm" affordance instead of a dropdown.

## Answer encoding

The answer is stored as a JSON string in the existing
`Record<string, string>` answer map so the adoption questionnaire's
plumbing stays unchanged. Shape:

```ts
// local
{"kind":"local","path":"/Users/me/project/design.md"}

// codebase — a Dev Tools project reference
{"kind":"codebase","projectId":"proj_x","name":"marathon-site","rootPath":"/Users/me/marathon-site"}

// database — a credential reference
{"kind":"database","credentialId":"cred_x","name":"Supabase Prod","serviceType":"supabase"}
```

`parseSourceDefinition(raw)` decodes this. If a legacy plain-string
value is encountered (e.g. from a template upgraded in place), it is
treated as `kind: 'local'` so no data is lost.

`summarizeSourceDefinition(raw, t)` returns a short human-readable
string (`"Local: /path"`, `"Codebase: marathon-site"`, …) used by the
Focus-variant live preview card.

## Adding to a template

In a template JSON's `payload.adoption_questions`, declare:

```json
{
  "id": "aq_brief_source",
  "category": "domain",
  "question": "Where should the brief be extracted from?",
  "type": "source_definition",
  "default": "",
  "context": "Explain what each kind means for this template.",
  "dimension": "use-cases"
}
```

The `default` field becomes the placeholder of the local-path input.
Leave the other fields (`options`, `placeholder`, etc.) off — the
`source_definition` renderer ignores them.

## Files

| Concern                      | File                                                                                         |
|------------------------------|-----------------------------------------------------------------------------------------------|
| Component + helpers          | `src/features/shared/components/forms/SourceDefinitionInput.tsx`                              |
| Question type union          | `src/api/templates/n8nTransform.ts` → `TransformQuestionResponse.type`                        |
| Questionnaire wiring         | `src/features/templates/sub_generated/adoption/QuestionnaireFormGrid.tsx` → `QuestionCard`    |
| Live-preview summarization   | `src/features/templates/sub_generated/adoption/QuestionnaireFormFocus.tsx` → `summarizeAnswer`|
| i18n strings                 | `src/i18n/en.ts` → `templates.adopt_modal.source_*`                                           |

## Future extensions

- **URL kind** — add a fourth tab for HTTP URLs, feeding
  `http_request` at build time. Currently folded into `local` as raw
  path text so the LLM can infer.
- **Read-through credentials** — resolve the chosen credential into
  actual connection config at build time so the downstream agent doesn't
  need to touch the vault directly.
- **Multi-source** — allow the user to pick multiple sources of mixed
  kinds (e.g. "a codebase *and* a Figma URL"). Would require encoding
  an array instead of a single object.
- **Deep links** — when the `database` tab is empty, offer an inline
  "Add credential" button that jumps to the Vault catalog (mirroring
  the pattern used by blocked vault-category questions).
