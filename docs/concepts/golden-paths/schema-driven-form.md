# Golden path — the schema-driven form

> Situation node: `ui-system/controls-and-forms/schema-driven-form` · [situation spine](../situation-spine.md)
> recurrence **16** · risk **medium** · sides **client** (**contradicted — §12.2**) · convergence **diverged**
> (**contradicted, and in the doctrine's tenth mode — §12.3**)
> dimensions: **ui · function · code-quality · resilience · security**
> Composed 2026-08-17 against `master` @ `50d736f6c`.
>
> **Subject.** A form generated from a *declaration* rather than hand-written JSX: connector field
> definitions, trigger configs, tool parameter schemas, questionnaire/adoption questions, recipe
> input schemas, plugin settings. The declaration, the renderer, and the validator — and whether the
> three agree about what a field is.
>
> **Sweep.** All **4,829** `.ts`/`.tsx` files under `src/` (the census engine's own `walked` count,
> reproduced independently by this composer's own walker: 4,829). **13** field-declaration formats
> hand-enumerated by reading every file. **8** renderers read end to end. Read in full:
> `McpToolInputForm.tsx`, `McpToolsTab.tsx`, `ToolDetail.tsx`, `EditFormFields.tsx`,
> `FieldCaptureRow.tsx`, `CredentialSchemaForm.tsx`, `SchemaFormFields.tsx`, `ExtraFieldRenderers.tsx`,
> `schemaFormTypes.ts`, `StructuredField.tsx`, `useUseCaseDetail.ts`, `parameterEditing.tsx`,
> `QuestionnaireFormGridParts.tsx`, `ConfigureStep.tsx`, `PresetQuestionnaireForm.tsx`,
> `RecipeInputSection.tsx`, `RecipeEditor.tsx`, `SchemaFieldBuilder.tsx`, `parameterCoverage.ts`,
> `triggerConstants.ts`, `ConnectorCredentialModal.tsx`; on the Rust side
> `engine/src/recipe_parameters.rs`, `commands/recipes/recipe_parameter_coverage.rs`,
> `engine/mcp_tools.rs`, `db/src/repos/resources/credentials.rs`, `db/src/credential_fields.rs`,
> `core/src/models/persona.rs`.
>
> **Measured by executing, not reading.** Five results below came from running something:
>
> 1. **The real renderers were mounted in jsdom** (vitest 4.1.8, the repo's own `src/test/setup.ts`,
>    a private scratch config) and fed **123 real JSON Schemas** and **196 real field declarations**
>    read out of read-only copies of the live databases, plus **17 hostile declarations** and **13
>    hostile type tokens**. §0 and §7 are that output. **No form was submitted anywhere** — no IPC,
>    no network, no DB write; the harness drives render and the app's own pure coercion function only.
> 2. **Read-only copies of both live SQLite databases** (`personas.db` 347,054,080 bytes / 244
>    tables; `personas_data.db` 17,502,208 bytes / 71 tables, copied 2026-08-17 with their
>    `-wal`/`-shm`) censused for the declarations this install actually holds: **134 connector
>    definitions carrying 196 field declarations, 170 tool definitions, 316 recipe definitions, 351
>    trigger configs, 123 event schemas, 78 personas / 29 use cases.**
> 3. **`engine::recipe_parameters::params_from_schema` was transliterated and replayed** over the
>    **594** field declarations in the seeded recipe catalog. It reproduces the repo's own documented
>    figures exactly — 594 declared / 572 derived / 22 skipped — which is what validates the port
>    before it was pointed anywhere new.
> 4. The §9 rule was built, counted by **two structurally independent implementations** (a regex
>    walker and a string/comment/regex-literal-aware character scanner) which **disagreed, were
>    reconciled to an exact match on count *and* membership**, overlap-checked at **site level**
>    against all **73** `src`-rooted rules in the registry, exercised through **five** of the runner's
>    fail-loud modes, then **re-extracted from this finished document and re-run**. The full registry
>    was **not** run, per the doctrine.
> 5. All five sibling checkouts were swept clause by clause. The independent cohort is **2**, not 5,
>    and one sibling's lineage runs **the opposite way** from what the corpus has assumed (§12.4).
>
> **`cargo` was NOT run.** Every Rust claim is static and traceable to a file read during
> composition, or to a transliteration validated against the repo's own published numbers.
> **No secret value, prefix, or length appears below.** Findings are shape, column, and count.
>
> ### Sibling boundaries, settled in prose
>
> [**form-field-and-validation**](./form-field-and-validation.md) owns **the one field** — `FormField`,
> the label/id/error association, the blur-then-validate rule. It already names this leaf as the
> adjacent one and points at three of my renderers. This path owns the layer above: **the declaration
> that decides there is a field at all, and which control it becomes.**
>
> [**untrusted-definition-validation**](./untrusted-definition-validation.md) owns *a definition
> arrived and will be executed*; its P2 (validate by reconstruction) is the floor this path builds
> on. The discriminator: that path asks **may this definition be stored**; this one asks **can the
> thing that renders it and the thing that validates it agree on what it says.**
>
> [**dropdown-and-select**](./dropdown-and-select.md) owns `ThemedSelect`/`Listbox` internals.
> [**credential-capture-form**](./credential-capture-form.md) owns *a human typing a secret*, and its
> §0.1 measured the backend sensitivity classifier against the form (45 of 196 disagree). **§0.3 here
> is a different measurement on the same 196 rows** — the *declaration's own key set* versus what any
> renderer can see — and it is cited, not re-derived.
> [**least-privilege-scope-grant**](./least-privilege-scope-grant.md) owns the scope ratio, including
> the connector that requests **6 scopes across 3 Google products** for one product (its §850). A
> credential form is where scopes are chosen; that finding is **cited here, not re-derived.**
> [**json-blob-column**](./json-blob-column.md) owns the storage shape.
> [**client-rule-mirroring**](./client-rule-mirroring.md) owns two artifacts that must agree; §0.2 is
> a new instance of its central result, in a layer it did not sweep.
>
> The **Deviations** section is a fix backlog. **Nothing in it was applied** — the operator uses this
> app daily.

---

## 0. The headline, before anything else

**This repo has thirteen ways to declare a form field and no two of them agree.** Of the nine that
declare a closed control-kind vocabulary, **zero of the 36 pairs are identical** and **8 pairs are
completely disjoint**. The identifier is spelled **`key`** in six formats, **`id`** in four,
**`name`** in two, and is an object key in the thirteenth. Nineteen distinct control-kind tokens
exist across the tree. **Not one of them is generated from anything.**

```
FORMAT                        WHERE                                                  ID KEY   KINDS
CredentialTemplateField       src/lib/types/types.ts:358                              key      4   closed union
UseCaseInputField             src/lib/types/frontendTypes.ts:213                      key      4   closed union
AdoptionQuestion              src/lib/types/designTypes.ts:165                        id       3   closed union
AdoptionRequirement           src/lib/types/designTypes.ts:146                        key      7   closed union
AdoptionQuestion (a 2nd one)  .../sub_presets/PresetQuestionnaireForm.tsx:21          id       6   ANNIHILATED by `| string`
ExtraFieldDef                 .../schemas/schemaFormTypes.ts:26                       key      3   closed DISCRIMINATED union
SchemaField                   .../recipes/sub_editor/SchemaFieldBuilder.tsx:8         key      —   `type: string`
TransformQuestion             .../sub_n8n/hooks/useN8nImportReducer.ts:52             id       4   closed union
ConfigField                   .../health/ConfigurationPopup.tsx:12                    key      2   closed union
TriageQuestionField           .../quick-answer/triage/triageTypes.ts:192              id       —
(inline) build input_schema   src/lib/types/buildTypes.ts:123                         name     —   `type: string`
JSON Schema `properties`      .../playground/tabs/McpToolInputForm.tsx:26         <object key>  6   Record<string, Record<string, unknown>>
params_from_schema (Rust)     src-tauri/engine/src/recipe_parameters.rs:66            name     8   match arms, `_ => None`
```

### 0.1 — One declaration, two renderers, three types versus eight

`AdoptionQuestion` (`designTypes.ts:165`) declares `type: 'text' | 'select' | 'boolean'`. Two
components render it:

| | recognises | tokens |
|---|---:|---|
| `ConfigureStep.tsx:90,:104,:114` | **3** | `text`, `select`, `boolean` |
| `QuestionnaireFormGridParts.tsx:304-307,:422-486` | **8** | + `textarea`, `long_text`, `source_definition`, `devtools_project`, `directory_picker` |

**Five of the eight tokens the grid handles are not in the declared union at all.** They are legal
only because the value crosses a serialization boundary — `PresetMemberAdoptionSchema.questions` is
typed **`any`** on the Rust side, and the file that renders it says so at
`PresetQuestionnaireForm.tsx:14-15`: *"The Rust binding types these as `any` … questions are
passthrough JSON values from the template's design file."*

So the same stored question, in the same install, is a `directory_picker` in one surface and — via
`ConfigureStep`'s final `else` — a single-line text box in the other. Neither says anything.

### 0.2 — Executed: the declared type never reaches the payload

`McpToolInputForm.tsx` is the app's only JSON-Schema form renderer, and the MCP path is the **only**
place in this repo where one declaration drives both halves: the same `input_schema` renders the form
*and* is validated in Rust before the call leaves (`engine/mcp_tools.rs:1192-1198` and `:1532-1539`,
both calling `validate_arguments_against_schema` at `:1695`, which compiles the schema with
`jsonschema` 0.28).

The two halves are fed by **`McpToolsTab.tsx:51-55`**, which is the entire coercion:

```ts
const args: Record<string, unknown> = {};
for (const [key, val] of Object.entries(inputValues)) {
  if (!val.trim()) continue;
  try { args[key] = JSON.parse(val); } catch { args[key] = val; }
}
```

**It never consults the declared type.** Executed — the app's own function, verbatim, its output
validated against the same schema that rendered the form:

```
a `string` property, user types 123          sent {"a":123}       INVALID  data.a should be string
a `string` property, user types true         sent {"a":true}      INVALID  data.a should be string
a `string` property, user types null         sent {"a":null}      INVALID  data.a should be string
a `string` property, user types {"a":1}      sent {"a":{"a":1}}   INVALID  data.a should be string
a `string` property, user types hello        sent {"a":"hello"}   valid
a `number` property, user types 5            sent {"a":5}         valid
a `boolean` property (select emits "true")   sent {"a":true}      valid
a REQUIRED property left blank               sent {}              INVALID  should have required property 'a'
a REQUIRED property with only whitespace     sent {}              INVALID  should have required property 'a'
an `enum` property, user types off-enum      sent {"a":"zzz"}     INVALID  should be equal to one of the allowed values
`format: uri`, user types "not a uri"        sent {"a":"not a uri"} INVALID  should match format "uri"

=> 8 of 11 produce a payload the SAME declaration rejects.
```

The renderer reads `type` to pick a widget and then throws it away. The `required` array is
**rendered** (`:40,:49` — the word "required" in amber) and **never enforced**: the submit control is
`disabled={executing}` (`ToolDetail.tsx:63`), so the user presses Execute and the failure comes back
from the validator as an error string. And `if (!val.trim()) continue` means a blank required field
is *omitted from the payload entirely*, which is the one case where a `Record<string, string>` value
bag cannot distinguish "not filled in" from "deliberately empty".

> The validation and the rendering read the same bytes and disagree about what they mean, because
> **only one of them is derived from the declaration.** This is
> [`client-rule-mirroring`](./client-rule-mirroring.md)'s result reached from a new direction: not
> two ladders that could drift, but **one artifact with two consumers where only one consumer
> actually consumes it.**

Two further executed results from the same corpus (123 real event schemas, 984 declared properties):

- **123 properties declare `enum` and every one of them renders a free-text `<input>`.** The renderer
  has no `enum` arm at all.
- **123 properties declare `format` and no rendered row contains any trace of it.**
- `369` declared `required` entries produce `369` "required" labels — a 1:1 render, and 0 enforcement.
- **All 162 parsed `persona_tool_definitions.input_schema` rows in the live DB are byte-identical:**
  `{"type":"object","properties":{},"additionalProperties":true}`. A declaration that declares
  nothing and permits everything, 162 times. Fed to the renderer it produces *"This tool takes no
  input parameters."*

### 0.3 — The declaration carries a key the declaration's type does not have, and the backend reads it

`connector_definitions.fields` holds **196 field declarations across 115 connectors**. The TypeScript
type `CredentialTemplateField` (`types.ts:358`) declares seven keys. The data carries eight:

```
keys NOT in the declared CredentialTemplateField interface:   sensitive   ×184 of 196
```

`sensitive` appears in **no binding**, in **no renderer**, and in **no TS declaration of a connector
field**. It is read on exactly one side — Rust, at
`db/src/repos/resources/credentials.rs:104-108`, step 2 of `is_field_sensitive`, where it decides
**encryption at rest** (`:269`). It is written on exactly one side too:
`db/src/builtin_connectors.rs`, the Rust seed literals.

Executed: all 196 declarations rendered through the real `EditFormFields`/`FieldCaptureRow`:

```
field declarations rendered:                       196
declared `type` vocabulary in the DATA:            password 119 · text 55 · url 19 · select 3
rendered with a masked control:                    119   (exactly the `password` ones)
declaration says `sensitive: true`:                150
declared sensitive AND rendered as a VISIBLE control:  37
```

Thirty-seven declarations tell the backend *encrypt this* and tell the renderer nothing, because the
renderer's only input is `type`, which encodes **which widget**, not **how secret**. That is the
doctrine's **Q1** in its purest form: `type: "text" | "password" | "url" | "select"` is a correctly
closed union that constrains exactly what it names, and the security property lives in the key beside
it that no client type declares.

> The neighbouring [`credential-capture-form`](./credential-capture-form.md) §0.1 measured the
> *classifier* against the form and found 45 of 196 disagreeing. This is a different question with a
> different comparator and it lands one layer up: **the declaration format has no owner.** Its widest
> key set exists only as Rust string literals in a seed file; its narrowest exists as the TS type;
> and the app's own connector-creation form (`CredentialSchemaForm.tsx:121-125`) reconstructs
> **seven** named keys on write, so a connector created through the product's own UI **cannot express
> the flag its own storage format uses.**

### 0.4 — Executed: what the renderers do with a declaration they do not recognise

```
McpToolInputForm.tsx — 17 hostile declarations
  unknown property type ("secret")           -> input[type=text]        (silent)
  property type ABSENT                       -> input[type=text]        (silent)
  property type ["string","null"]            -> input[type=text]        (silent)
  property is NOT an object (a string)       -> input[type=text]        (silent)
  property is null                           -> THREW  "Cannot read properties of null (reading 'type')"
  properties is an ARRAY                     -> 1 input, labelled "0"
  properties is a STRING "a,b,c"             -> 5 inputs, labelled 0,1,2,3,4     <- Object.keys of a string
  required is a STRING not an array          -> renders; `required.includes` on a string
  enum declared                              -> input[type=text]        (silent)
  default with the WRONG type                -> input[type=number]      (default never used)
  __proto__ as a property name               -> dropped, not copied
  description carries markup                 -> escaped by React, no raw markup in the DOM
  schema is an ARRAY / STRING / NUMBER       -> "This tool takes no input parameters."

StructuredField.tsx — 13 declared type tokens
  'select' -> select   'number' -> NumberStepper   'boolean' -> button
  'text' 'password' 'url' 'string' 'json' 'directory_picker' '' undefined null 42  -> ALL textarea
```

Two things follow. First, **the fallback is never neutral**: `StructuredField.tsx:62`'s `default:`
turns a declared `password` into a resizable plain-text `<textarea>`, and it does so with a
five-line comment explaining why the default is a textarea — a decision made for *text*, silently
inherited by everything the union does not name. Second, **the one input that crashes is the one
whose shape is closest to legal**: `properties: {a: null}` throws inside render at
`McpToolInputForm.tsx:41`, uncaught by anything in that panel.

### 0.5 — And the one place that gets it right, which is generated

```ts
// src/lib/bindings/ParamType.ts  (ts-rs, "Do not edit this file manually")
export type ParamType = "number" | "string" | "boolean" | "select";
// src/lib/bindings/PersonaParameter.ts
export type PersonaParameter = { key, label, type: ParamType, default_value, value,
                                 description, options, min, max, unit };
```

```tsx
// src/features/agents/sub_design/components/parameterEditing.tsx:158
switch (param.type) {
  case 'number':  … case 'boolean': … case 'select': …
  case 'string':
  default: { … }          // :222 — the default is FUSED to a declared member
}
```

**One declaration format in this repo has its control-kind union generated from the code that
produces the declarations** (`core/src/models/persona.rs:218`, `#[derive(TS)]`), and it is the only
one whose renderer cannot drift from it. Its default arm is not a fallback — it is `case 'string'`
wearing a second label, which is the difference between "anything unknown becomes a text box" and
"the union has four members and `string` is one of them."

Everything in §7 is a place where the vocabulary is hand-maintained beside the renderer instead.

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its warrant. No file path, primitive name or count appears below this line until
the head ends.

> **P1 — physics, and the subject.** *A field declaration is a contract between three parties: the
> thing that writes it, the thing that renders it, and the thing that validates what comes back.* A
> schema-driven form is not a rendering convenience; it is a small language, and it has at least
> three interpreters. Every defect in this leaf is two interpreters disagreeing about one word.
>
> **P2 — physics, and the clause everything else follows from.** *Generate the control-kind
> vocabulary from the one place that produces the declarations; never restate it beside the
> renderer.* A hand-written union next to the renderer and a hand-written union next to the writer
> are two lists, and two lists drift in both directions at once: the renderer grows arms the
> declaration cannot name, and the declaration grows members no renderer implements. Neither drift
> produces an error, because both lists are individually well-typed.
>
> **P3 — physics.** *A union that also admits the base type is not a union.* Writing `'a' | 'b' |
> string` produces `string`: the members survive as autocomplete and vanish as constraint. This is
> the cheapest possible way to disarm an exhaustiveness check while leaving the appearance of one,
> and it is invisible in review because the intent is legible on the line.
>
> **P4 — physics, and the most-replicated shape here.** *A closed declaration whose values live in an
> open string-keyed map has an open key namespace.* The declaration constrains what fields exist; the
> value bag constrains nothing. Everything downstream of the bag — the submit payload, the
> persistence, the diff — is keyed by strings the declaration no longer governs, and a key that the
> declaration dropped survives in the bag indefinitely.
>
> **P5 — physics.** *The fallback arm is a decision about every type you have not thought of, and it
> is always made for one type you have.* Whatever the last `else` renders, it renders for a declared
> type the author of the declaration believed was supported. Choose between three answers
> deliberately — refuse the field, render it disabled with an explicit "unsupported" affordance, or
> fall through — and write down which and why. Silently falling through is the only one that teaches
> the user something false.
>
> **P6 — physics, the corollary that decides two-sided cases.** *If one artifact drives both the form
> and the validator, the form must consume it for more than widget selection.* A declaration that
> chooses the control and is then discarded before the value is assembled has been read once and
> obeyed zero times. The test is mechanical: take a filled-in form, produce the payload, and validate
> it against the very declaration that rendered it. Any failure is a client that stopped reading.
>
> **P7 — ergonomics, and where the silence is worst.** *A declared field the renderer cannot render
> must be reported, not dropped.* The user was promised a setting by whatever wrote the declaration.
> Dropping it makes the promise disappear, and the person who looks for it has no way to learn that
> the system saw the field and declined it. Publishing the residue costs one array and is the single
> highest-value thing this leaf can do.
>
> **P8 — ergonomics, the trap inside P7.** *The report must cover the fields you ignore as well as
> the fields you skip.* A parser that `continue`s on a malformed entry before it reaches the
> "unsupported" branch reports nothing at all, and a coverage report that shows zero missing is
> indistinguishable from full coverage. The `continue` you wrote for hygiene is the hole in the
> instrument you wrote for honesty.
>
> **P9 — function.** *`required` is a claim in the declaration; it becomes a rule only where submit
> is gated.* Rendering an asterisk is presentation. If the submit gate is a busy flag, every required
> field is optional and the user learns it from the server.
>
> **P10 — security.** *A declaration may carry a key that decides a security property, and the
> renderer will not know.* Widget choice and sensitivity are different questions; a format that
> answers both from one field answers one of them by accident. Ask, of every key in the declaration,
> *which consumer reads this* — and if the answer is "only the one on the far side", the other side
> is rendering a decision it cannot see.
>
> **Scale condition.** P1–P2 bite at the second renderer. P3 and P4 are correctness from the first
> field. P5 bites the first time a declaration is authored by someone who is not you — a model, a
> template, an outside CLI. P6 bites the first time client and server share a schema. P7/P8 bite the
> first time a declaration outgrows its renderer, which is always. P9 bites at the first empty
> submit. P10 bites the first time a credential is captured.

### Warrant evidence — the five siblings, censused independently

`personas-web` (Next.js), `brainiac` (Rust workspace + Next.js console), `personas-cloud` (TS
orchestrator + Python facade, **zero `.tsx` files**), `vibeman` (Next.js + Tauri), `ascent` (Next.js
+ Prisma). All five reachable and swept.

**The independent cohort is 2, and one exclusion runs the opposite way from the corpus's standing
assumption. See §12.4 — this is the most important thing in the sweep.**

- **The situation is absent in three of five, and that must be reported as silence.**
  `personas-web`, `personas-cloud` and `ascent` have **no declaration-driven form renderer of any
  kind** — not a weak one, none. `personas-web`'s three forms are hand-written JSX; its nearest
  descriptor arrays (`CreateVisual.tsx:12`, `TileValue.tsx:84`) render `<div>`s and `<span>`s, not
  inputs. `personas-cloud` has no `.tsx` file to render anything. `ascent`'s descriptor arrays are
  tab/filter/legend lists with no `type` key and no value collection. Across all five repos there are
  **zero** uses of `react-hook-form`, `@rjsf`, `uniforms`, `formik`, or any zod-to-form bridge,
  verified against every lockfile. **The whole cohort hand-rolls.**
- **P2 has no external warrant, and this is silence, not refutation.** Nobody generates a
  control-kind vocabulary. `brainiac` comes closest and from the other end: `FacetKey` is derived
  from one `as const` array (`console/app/console/modules/memories/archive-data.ts:47-48`) and then
  consumed through `Record<FacetKey, …>` (`:306,:314,:344`) — an **exhaustive** record, so adding a
  facet breaks the build. That is the inverse of P4 and it works, but the rail is homogeneous: one
  widget for every facet, so it has no control-kind union to generate. **Personas is ahead of the
  fleet on P2 in exactly one format (`ParamType`) and behind its own best answer in twelve.**
- **P3 is untested externally.** `ascent` deliberately widens one vocabulary and writes down why —
  `src/lib/llm/schema.ts:20`, `IMPACT_LEVELS: string[]`, *"Kept a mutable `string[]` so the JSON
  Schema `enum` type matches what the Bedrock Converse tool spec expects."* A documented widening at
  a boundary is not the same failure as `'a' | 'b' | string` in a declaration.
- **P4 is convergent as a defect, in the only sibling that has forms.** `vibeman`'s
  `PreviewModal.tsx:70,:77-80` collapses a typed `PropConfig[]` into
  `useState<Record<string, unknown>>({})` the instant it leaves the declaration, and updates it with
  an open spread at `:85-87`, so a key dropped from `propsConfig` persists in state forever. Its
  server does the same to the union: `src/app/api/triage-rules/route.ts:9-10` declares
  `VALID_FIELDS: string[]` — annotated `string[]`, not the `TriageConditionField` union that exists
  three files away.
- **P5 is convergent as a defect, and this is the sharpest result in the sweep.** The only two
  declaration-driven renderers in the entire fleet **both fail open, silently**:
  `vibeman/src/app/features/HallOfFame/components/previews/PropsControl.tsx:43` — an if-chain with no
  default that ends `return null`, where the declared member `'color'` has **no arm at all** in a
  three-member union restated in three files; and
  `vibeman/src/lib/triage/triageRulesEngine.ts:49-51,:68-69,:105-106` — `default: return false`,
  three times, so an unrecognised declared field makes the whole rule silently never fire. Neither
  logs, throws, nor shows an unsupported-field affordance. **Two repos have this situation and both
  answer it the same wrong way** (§12.3).
- **P6 has no external warrant** — no sibling has one declaration driving both a form and a
  validator. `brainiac` has the two halves and no form between them: `mcp.rs:456` declares 18 tools
  with full `inputSchema`s, `:147-153` / `:169` / `:783` hand-write the validators, and
  `grep tool_definitions` across all crates returns **3 hits** — the definition, the serve, and one
  comment. **No test binds the declaration to the handlers.**
- **P7/P8 have no external warrant and Personas owns the fleet's only answer** — a coverage command
  that reports the residue (§6). Nobody else publishes what their renderer declined.
- **P9 is convergent as a defect.** `vibeman` twice: a triage rule's `name` is required three times
  by hand on the client (`TriageRulesPanel.tsx:193,:409`) and passed unchecked to the repository
  (`route.ts:104-113`); a goal's `title` renders a red `*` and a "Title is required" hint while the
  server schema is `title: z.string()` with **no `.min(1)`** (`src/lib/api/schemas/goals.ts:34`), so
  `""` validates and persists. `personas-cloud` is the counter-example and shows what P9 costs to get
  right: `.min(1, '… is required')` lives *in the declaration* (`schemas.ts:234-235,:256,:276`) and
  is enforced at one chokepoint (`httpApi.ts:2393-2412`) — **and there is no form on the other side
  of it.**
- **P10 has no external warrant.** No sibling declaration carries a security-relevant key its
  renderer ignores, because no sibling captures credentials through a declaration.
- **Unknown-key handling splits, and the split is instructive.** Reject: `personas-cloud`, **18
  `.strict()`** with exactly one deliberate `.passthrough()` (`schemas.ts:250-253`) — the only repo
  in the fleet that refuses an undeclared key. Reconstruct-only-declared: `ascent`
  (`sanitizeGatePolicy`, `validateAssessment` — zero spreads, zero passthrough anywhere in the repo),
  `brainiac` (`Module.tsx:63-70,:76-85`). Strip silently: `personas-web` (`route.ts:121`), `vibeman`
  (`route.ts:133`, plus an explicit `.passthrough()` at `goals.ts:15`). Personas is in the last group.

---

## 1. Trigger

You are in this situation when you are about to type or say:

- "render the connector's fields" / "the credential form should come from the schema"
- "the tool declares its parameters — build the form from `input_schema`"
- "add a question type to the adoption questionnaire"
- "let the user define the recipe's inputs, then render them in the playground"
- "the trigger config panel should show the right fields per trigger type"
- "the plugin declares its settings; just map over them"
- **The "about to write X" test:** you are about to type `fields.map((field) => …)`,
  `field.type === 'select' ? … : …`, `switch (question.kind)`, `const [values, setValues] =
  useState<Record<string, string>>({})`, `type: 'text' | 'select' | string`, a new member on an
  existing field-type union, or a new `case` in a renderer for a token that union does not contain.

You are **not** in this situation when you are writing one labelled control by hand — that is
[form-field-and-validation](./form-field-and-validation.md), and it owns what your renderer should
emit *per field*. You are not in it when the question is whether a stored definition is safe to
persist ([untrusted-definition-validation](./untrusted-definition-validation.md)) or which component
may render a model's object ([model-composed-ui](./model-composed-ui.md)).

**The discriminator: something other than this component decides how many fields there are.**

---

## 2. The one way

**Generate the control-kind union from the single place that produces the declarations, and make the
renderer switch on it exhaustively with the default arm fused to a real member.** `ParamType`
(`core/src/models/persona.rs:218` → `src/lib/bindings/ParamType.ts`) is the pattern and the only
instance in the tree: a `#[derive(TS)]` enum beside the code that mints the parameters, consumed by
`parameterEditing.tsx:158` as `switch (param.type)` whose last arm is `case 'string': default:` —
so a new member is a compile error at the renderer, not a text box at runtime. **Never restate the
vocabulary beside the renderer, and never write `'a' | 'b' | string`** — that annihilates the union
and leaves the autocomplete, which is worse than `string` because it reads as a constraint
(`PresetQuestionnaireForm.tsx:26`). **Reconstruct the declaration on the way in**, reading each key by
name and emitting a new object, the way `useUseCaseDetail.ts:40-64` normalizes both the widget shape
and the JSON-Schema shape into one and drops entries with no usable key — and put the normalizer at
the boundary, not in the component, so every renderer of that format shares it. **Report what you
could not render** — `params_from_schema` (`engine/src/recipe_parameters.rs:93-143`) returns
`(Vec<DerivedParam>, Vec<SkippedParam>)` and a command surfaces the second half
(`recipe_parameter_coverage.rs`), which is the best idea in this leaf and the fleet's only instance
of it; **and count the entries you `continue` past, because the residue report is blind to those**
(`:103-109`). **Derive the submit gate from the same declaration that renders the asterisk** —
`useFieldValidation` (`EditFormFields.tsx:54-80`) does this and produces an error for **151 of 151**
required declarations over an empty value map; the MCP tool form does not, and its Execute button is
`disabled={executing}` (`ToolDetail.tsx:63`). **If one declaration drives both a form and a
validator, make the form consume it past widget selection** — type-aware coercion, `enum` as a
select, `required` as a gate — because the MCP path's `JSON.parse(val)` fallback
(`McpToolsTab.tsx:51-55`) sends **8 of 11 test payloads that the very same schema rejects**. **Keep
the value bag's keys governed:** seed it from the declaration and, on submit, emit only declared keys
rather than spreading the bag. And **when the declaration carries a key your renderer does not read,
either read it or delete it** — `sensitive` is on **184 of 196** live field declarations, decides
encryption at rest in Rust (`credentials.rs:104-108`), and is absent from every TypeScript type and
every renderer in `src/`.

---

## 3. Mandated primitives

**Exist today — use them:**

| Primitive | What it gives you |
| --- | --- |
| **`src-tauri/core/src/models/persona.rs:218` — `ParamType`** + **`src/lib/bindings/ParamType.ts`** | **The generated control-kind union, and the one thing in this repo to copy.** A four-member `#[derive(TS)]` enum beside the Rust that mints parameters, exported by ts-rs into the single bindings tree. Adding a member breaks the renderer at compile time. It is the only field-type vocabulary in the tree that nobody maintains twice. |
| **`src/features/agents/sub_design/components/parameterEditing.tsx:158`** | **The exhaustive renderer.** `switch (param.type)` over the generated union, with `case 'string': default:` fused at `:222` — the default is a declared member, not a catch-all. Each arm uses a real primitive (`NumberStepper`, `Slider`, `ThemedSelect`) rather than a raw control. |
| **`src-tauri/engine/src/recipe_parameters.rs:93` — `params_from_schema(&[Value]) -> (Vec<DerivedParam>, Vec<SkippedParam>)`** | **The reconstructing parser that publishes its residue.** Reads seven keys by name, emits a fresh `DerivedParam`, and returns the fields it could not map **with the declared type that caused the drop**. Its doc comment (`:86-92`) states why it is public: *"the single source of truth for 'which declared settings actually become knobs' — the coverage command reports off it, so the supported-type list never has to be mirrored (and drift) in TypeScript."* |
| **`src-tauri/src/commands/recipes/recipe_parameter_coverage.rs`** + **`src/features/templates/sub_recipes/libs/parameterCoverage.ts:22`** | **P7 made real, and the fleet's only instance.** A pure read that answers *how many settings does this declare, how many became editable, and exactly which did not*. The module header records what it replaced: *"until this command existed the only trace of the skip was a `tracing::debug!` line. A recipe author declared a knob that never became editable and nobody was told."* |
| **`src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:40-64`** | **The reconstructing normalizer at a boundary.** Accepts *both* live shapes of one declaration (`{key,type:'text'}` and the tool/JSON-Schema `{name,type:'string'}`), maps foreign type tokens onto the widget enum, emits a new five-key object, and drops entries with no usable key. Its comment at `:34-39` is the clearest statement of this leaf's problem in the tree: *"the type is a lie the orphaned renderer never handled."* |
| **`src/features/vault/sub_catalog/components/schemas/schemaFormTypes.ts:26` — `ExtraFieldDef`** + **`ExtraFieldRenderers.tsx:15`** | **The closed discriminated union with a matching switch**, and the only declaration/renderer pair in `src/` whose vocabularies are equal (3 = 3). Adding a `kind` without an arm is caught by TypeScript wherever the return type is constrained. |
| **`src/features/vault/sub_credentials/components/forms/EditFormFields.tsx:54-80` — `useFieldValidation(fields)`** | **The submit gate derived from the declaration.** `validateAll(values)` walks the same `fields` array the renderer walked. Executed over all 115 live connectors with an empty value map: **151 of 151** `required: true` declarations produce an error. This is P9 done correctly. |
| **`src/lib/utils/platform/triggerConstants.ts:461` — `parseTriggerConfig(triggerType, config)`** | **The config reconstructor**, and the pattern for a per-variant declaration: a `switch` on the *column*, each arm building a fresh object from named keys. It warns when the blob's own `type` disagrees with the column and uses the column as discriminant (`:468-473`) — the definition never gets to choose its own variant. |
| **`src/features/vault/sub_catalog/components/schemas/CredentialSchemaForm.tsx:121-125`** | The **write-side reconstruction**: field declarations are rebuilt into seven named keys before `JSON.stringify` into the connector's `fields` column. Correct in shape — and see §7.C for what its key list cannot say. |
| **`src/features/shared/components/forms/`** — `FormField`, `Listbox`, `AccessibleToggle`, `NumberStepper`, `ThemedSelect` | The per-field primitives your arms should emit. Owned by [form-field-and-validation](./form-field-and-validation.md) and [dropdown-and-select](./dropdown-and-select.md) — this path does not restate their contracts, it says every arm of your switch must reach one. |

**Do not exist — this path names them:**

- **A shared declaration type for "one form field."** There are **13** (§0), and adding a fourteenth
  is currently the path of least resistance.
- **Any generator for a control-kind vocabulary except `ParamType`.** The tour path's
  `gen-tour-anchors.mjs` proves the repo knows how to emit a closed vocabulary into both languages
  from one scan; no form declaration has one.
- **A shared "render a declared field" component.** Eight renderers each re-implement the mapping,
  recognising 2, 3, 3, 3, 3, 3, 5 and 8 tokens respectively.
- **Any `enum` or `format` support in the JSON-Schema renderer.** 123 real declarations of each are
  ignored (§0.2).
- **Any type distinguishing "a declaration we authored" from "a declaration we received."** Named
  independently as a missing newtype by
  [structured-output-extraction](./structured-output-extraction.md) §8,
  [model-composed-ui](./model-composed-ui.md) §8 and
  [untrusted-definition-validation](./untrusted-definition-validation.md) §3 — **four paths now.**
- **An "unsupported field" affordance.** No renderer in `src/` has one. Every one of the eight falls
  through silently.

---

## 4. Steps

1. **Write down who authors the declaration.** A Rust seed literal; the app's own builder UI; a
   template design file; a model; a remote MCP server; an outside CLI. Only the first is trusted, and
   §0.3 shows it is also the only one that can currently express the full key set.
2. **Find the existing format before you add one.** Thirteen exist. If one of them already describes
   your field, extend it; if you extend it, the next step is not optional.
3. **Make the control-kind vocabulary generated, not written.** One `#[derive(TS)]` enum (or one
   `as const` array) beside the producer, exported into `src/lib/bindings/`. This is the whole
   prescription; everything below is what you do because it is generated.
4. **Never widen the union.** `'a' | 'b' | string` is `string`. If you need an escape hatch, add a
   member named for the escape (`'custom'`) so the renderer must handle it.
5. **Reconstruct at the boundary, once, for all renderers of that format.** Read each key by name,
   normalize foreign spellings (`key` vs `name`, `string` vs `text`), emit a new object, drop
   unusable entries. `useUseCaseDetail.ts:40-64` is the shape; put it in a module, not a component.
6. **Switch, do not chain.** `switch (field.type)` over a closed union with the default fused to a
   member (`parameterEditing.tsx:222`). A `? :` chain cannot be exhaustiveness-checked and its last
   arm is a decision nobody wrote down.
7. **Decide the unsupported-field answer explicitly and write it in a comment.** Refuse / render
   disabled with an explicit affordance / fall through. Then make the fallback *visible* — a disabled
   control labelled with the declared type beats a text box that pretends.
8. **Publish the residue, and count what you ignore.** Return the fields you could not render
   alongside the ones you could, and make sure the `continue`-before-classification path also lands
   in a counter — otherwise the honesty instrument reports full coverage for a declaration it never
   parsed (`recipe_parameters.rs:103-109`, §7.E).
9. **Seed the value bag from the declaration and emit only declared keys.** `Record<string, T>` is
   fine as a transport; it is not fine as the authority on which keys exist.
10. **Derive the submit gate from the declaration that renders the asterisk.** One predicate, two
    consumers — `useFieldValidation` is the shape.
11. **If a validator on the other side reads the same declaration, close the loop mechanically.**
    Take a filled form, build the payload, validate it against that declaration in a test. §0.2 is
    that test, run once, by hand.
12. **And then stop.** What one field looks like, how its error is associated, and when it validates
    is [form-field-and-validation](./form-field-and-validation.md). Whether the declaration was safe
    to store is [untrusted-definition-validation](./untrusted-definition-validation.md).

### Can the type make the wrong call impossible? — asked before §9

**Yes, and the repo already contains the answer once.** The edit is to give every field-declaration
format a **generated** control-kind union, the way `ParamType` has one, and to make the renderer
`switch` on it. Held against the doctrine's seven qualifications:

- **Q1 (a type carries only what it encodes).** The critical one, and the reason this is not a
  complete fix. `CredentialTemplateField.type` is *already* a correctly closed 4-member union, and it
  did not prevent §0.3, because sensitivity lives in a different key. A generated union closes
  *vocabulary drift* and closes nothing else. Say so.
- **Q2 (requiredness ≠ closedness).** Applies to `PresetQuestionnaireForm.tsx:26`, where the field is
  already optional and already "closed"-looking; the fix is neither — it is deleting `| string`.
- **Q3 (a type nobody constructs constrains nothing).** `ParamType` has real consumers: 1 renderer,
  1 Rust producer, and the coverage command. The formats that most need this have 1–2 renderers
  each — small, enumerable, real.
- **Q4 (a type anyone can construct authenticates nothing).** **This is where a generated union runs
  out.** `PresetMemberAdoptionSchema.questions` is `any` on the Rust side; the value arrives as JSON.
  A union at the TS boundary is a claim about bytes nobody checked — doctrine §1 item 5, exactly. The
  union must be paired with a **runtime membership check at the reconstruction step**, or it is
  documentation. `useUseCaseDetail.ts:47-54` is what that check looks like.
- **Q5 (withholding beats requiring).** The withholding form here is **not exporting a raw `<input>`
  from your field renderer at all** — every arm reaches a primitive. Eight renderers currently hand-
  roll their controls; that is the freedom to withhold.
- **Q6 (withhold the dangerous freedom, not the answer).** The dangerous freedom is *choosing the
  token set*, not *choosing the control*. A renderer must still decide what a `select` looks like.
- **Q7 (relaxing a requirement is inert when the caller supplies the bad value voluntarily).**
  Applies to §7.C: nothing forces `CredentialSchemaForm` to drop `sensitive`; widening its input type
  changes nothing. The fix is to add the key to the reconstruction, or to remove it from the format.

**Where the type does not reach**, and these are findings, not failures:

1. **Through the `any` binding.** `PresetMemberAdoptionSchema.questions` is `any` by design (the
   Rust comment says the questions are passthrough JSON from a design file). No TS union survives
   that; only a runtime check does.
2. **Inside a `TEXT` column.** `connector_definitions.fields` is a string on both sides of the IPC
   boundary. The `sensitive` key's existence is not expressible in any signature — it is expressible
   only in a schema for the column, which does not exist.
3. **Across the JSON-Schema `properties` map.** `Record<string, Record<string, unknown>>`
   (`McpToolInputForm.tsx:26`) is the absence of a type by construction: each property has a shape,
   and the map erases it. A union of 6 JSON-Schema types would have to be re-established by narrowing
   at the property, which is a runtime check, not a type.
4. **Between the builder and the player of the same format.** `SchemaFieldBuilder`'s `FIELD_TYPES`
   (`:18`) is a `string[]`, not `as const`, so even *within* one feature the offered set and the
   rendered set are unlinked (§7.D). `as const` fixes this one, and it is a four-character edit.

So: **ship the generated unions as the fix, ship the runtime membership check beside each one because
Q4 says the union alone is a claim, and ship §9 as the ratchet on the drift the unions do not yet
cover.**

---

## 5. Anti-patterns

| Anti-pattern | Failure mode |
|---|---|
| **`type: 'a' \| 'b' \| string`** | The union is `string`. Autocomplete survives, checking does not. `PresetQuestionnaireForm.tsx:26` — and the file that carries it is the one whose data is `any` on the wire, so it is the exact place a real union would have paid. |
| **Restating the vocabulary beside the renderer** | Two lists, drifting both ways. Measured: `QuestionnaireFormGridParts.tsx` recognises **8** tokens for a union that declares **3**; `ConfigureStep.tsx` recognises 3 of the same 8. Same data, same type, two different products. |
| **A `? :` chain instead of a `switch`** | Not exhaustiveness-checkable, and its last arm is an unwritten decision. 13 files / 42 sites (§9). `EditFormFields.tsx:44` puts three comparisons and the default on one line. |
| **A `default:` arm that is not a declared member** | `StructuredField.tsx:62` turns a declared `password` into a plain-text `<textarea>` — the fallback was chosen for *text* and inherited by everything else. Executed: 10 of 13 tokens land there. |
| **Reading the declared type to pick a widget and then discarding it** | The payload stops obeying the declaration. `McpToolsTab.tsx:51-55` — `JSON.parse(val)` with no reference to `type`; **8 of 11** cases produce a payload the same schema rejects (§0.2). |
| **Rendering `required` without gating submit on it** | `McpToolInputForm.tsx:49` renders the word; `ToolDetail.tsx:63` gates on `disabled={executing}`. The user learns the rule from a server error. Compare `useFieldValidation`, 151/151. |
| **`Record<string, T>` as the authority on which keys exist** | The declaration's key set stops governing at the bag. `CredentialSchemaForm.tsx:45` (`extraState`), `EditFormFields.tsx:8` (`values`), `McpToolInputForm.tsx:8` (`values`) — and every one of them is updated by an open spread (`{ ...values, [key]: … }`). |
| **Casting the schema to `Record<string, Record<string, unknown>>`** | Erases that each property has a shape, and forces the `as string` that follows. `McpToolInputForm.tsx:26` → `:41` `(prop.type as string) \|\| 'string'`. Executed consequence: `properties: 'a,b,c'` renders **five inputs labelled 0–4**, from `Object.keys` of a string. |
| **Two spellings of the identifier** | `key` in six formats, `id` in four, `name` in two. `useUseCaseDetail.ts:44` is the only consumer that accepts both, and it needed a six-line comment to explain why. |
| **`continue` on a malformed entry before the "unsupported" branch** | The residue report goes blind. `recipe_parameters.rs:103-109` reports such entries *"as neither derived nor skipped"*, in its own words — so a declaration spelled with the wrong identifier key yields a coverage report showing zero missing. |
| **Patching the declaration at render time for one hardcoded key** | `ConnectorCredentialModal.tsx:69-82` injects `options` when `f.key === 'twin_profile_id'`. It works, in one component; the same declaration renders as a free-text input everywhere else (§7.B). |
| **A control the test harness cannot see** | `FieldCaptureRow.tsx:128` puts `data-testid` on the `<input>` branch and `:96-115` puts none on the `ThemedSelect` branch. Two live declarations are invisible to the app's own automation — and this defect was surfaced *by* an instrument assertion, which is the argument for writing them. |
| **Trusting a declared `select` to have options** | `twin.twin_profile_id` is `type: 'select'`, `required: true`, **no `options`** (`builtin_connectors.rs:1793`). Two renderers degrade it to a text box; a third patches it. The declaration cannot say "options are dynamic." |

---

## 6. Evidence

### The one site to copy: `parameterEditing.tsx:158` with `core/src/models/persona.rs:218`

Read them together — the renderer is only half the pattern:

```rust
// src-tauri/core/src/models/persona.rs:215
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum ParamType { Number, String, Boolean, Select }
```

```tsx
// src/features/agents/sub_design/components/parameterEditing.tsx:158
switch (param.type) {                       // param: PersonaParameter (generated)
  case 'number':  … <NumberStepper/> + <Slider/>
  case 'boolean': … <button aria-pressed>
  case 'select':  … <ThemedSelect>
  case 'string':
  default: { … }                            // :222 — the default IS a declared member
}
```

Nothing between them is hand-maintained: `src/lib/bindings/ParamType.ts` carries ts-rs's *"Do not
edit this file manually"* header, and `PersonaParameter.ts` types the field as `ParamType`. Add a
fifth variant in Rust, regenerate, and the switch fails to compile. **That is the entire
prescription, and it exists exactly once.**

Also exemplary:

- **`src-tauri/engine/src/recipe_parameters.rs:93-143`** — reconstruct-and-report. Its return type
  `(Vec<DerivedParam>, Vec<SkippedParam>)` is the API that makes P7 possible, and
  `recipe_parameter_coverage.rs`'s header (*"Deliberately NOT a fix for the missing types — only for
  the silence"*) is the right scoping of an honesty feature.
- **`src/features/agents/sub_use_cases/libs/useUseCaseDetail.ts:40-64`** — the two-shape normalizer.
  `String(f.key ?? f.name ?? '')`, `t === 'number' || t === 'integer' || t === 'float' ? 'number' :
  …`, a fresh five-key object, `.filter(f => f !== null)`. It is the only place in `src/` that
  reconciles two spellings of one format.
- **`src/lib/utils/platform/triggerConstants.ts:468-473`** — the declaration is not allowed to choose
  its own discriminant. The blob's `type` is compared to the column, logged when it disagrees, and
  the column wins.
- **`src/features/vault/sub_credentials/components/forms/EditFormFields.tsx:54-80`** —
  `useFieldValidation`, the submit gate walking the same array as the renderer.

### The replay that validated the transliteration before it was pointed anywhere new

`params_from_schema` (`recipe_parameters.rs:66-77` + `:93-143`) was transliterated to JS and run over
the **594** field declarations in `scripts/templates/_recipe_seeds.json`:

```
declared 594 · derived 572 · skipped 22   (source_definition 5, connector_ref 16, list[string] 1)
```

`parameterCoverage.ts:41` independently documents *"572 of the 594 fields in the seeded catalog are
supported types"*, and `parameterCoverage.ts:8-9` names the same three unsupported types. **Exact
agreement with the repo's own published numbers**, which is what makes the port trustworthy before it
was used to measure anything new (§7.E).

### The two implementations, and the disagreement that was worth having

The §9 rule was counted by a regex walker and by a string/comment-aware character scanner. They
disagreed: **15 files / 44 matches versus 14 / 43.** The single missing site was
`autoCredHelpers.ts:230`, and the cause was three lines earlier in that file:

```ts
// src/features/vault/sub_catalog/components/autoCred/helpers/autoCredHelpers.ts:171
export const URL_REGEX = /https?:\/\/[^\s)>\]"'`*_]+/g;
```

The character scanner had no regex-literal state, so the `"` inside the character class started a
string scan and desynced every match after line 171. Adding a regex-literal arm brought both
implementations to **13 files / 42 matches with identical membership**. (The drop from 15/44 to 13/42
is separate and deliberate: `entry` was removed from the receiver list — see §9.)

### What the live databases hold

Read-only copies, 2026-08-17:

- **`connector_definitions`: 134 rows, 115 with a non-empty `fields` array, 196 field declarations.**
  Types: `password` 119, `text` 55, `url` 19, `select` 3. `required: true` on 151. Options on 2.
  **`sensitive` on 184** — 150 `true`, 34 `false`, absent on 12.
- **`persona_tool_definitions`: 170 rows, 8 with `input_schema` NULL, and all 162 parsed schemas
  byte-identical** at `{"type":"object","properties":{},"additionalProperties":true}`. **Zero
  declared properties in the entire table.**
- **`recipe_definitions`: 316 rows, `input_schema` NULL on all 316, `sample_inputs` NULL on all
  316.** The recipe input-schema renderer chain — `RecipeInputSection`, `RecipeTestRunnerTab`,
  `RecipeOverviewTab`, and two byte-identical copies of `parseInputSchema` — operates on zero live
  rows.
- **`personas`: 78 rows, 75 with a `design_context`, 29 use cases, and 0 use cases carrying an
  `input_schema`.** So `useUseCaseDetail`'s normalizer — the best reconstruction in `src/` for this
  leaf — currently normalizes nothing.
- **`shared_event_catalog`: 125 rows, 123 with a real JSON Schema** — 984 properties, 369 `required`
  entries, 123 `enum`s, 123 `format`s, 123 `array`-typed properties. This is the app's only rich
  JSON-Schema corpus and it is the one §0.2 was executed against.
- **`persona_triggers`: 351 rows.** `event_listener` 189, `manual` 68, `chain` 55, `schedule` 32,
  `polling` 7. Stored config keys per type include **`cadence` on 23 of 32 schedule configs** and
  **`_auto_for_trigger` on 39 of 189 event_listener configs** — neither of which
  `parseTriggerConfig` reads (§7.G).

> **The same shape [untrusted-definition-validation](./untrusted-definition-validation.md) recorded
> and worth restating for this leaf: the best-built surfaces here have the least data.** The
> generated-union renderer, the residue-reporting parser and the two-shape normalizer all serve
> populations of 0–65 rows; the eight hand-chained renderers serve the 196 field declarations and 351
> trigger configs the operator actually uses.

---

## 7. Deviations found

> **Second pass — what is upstream of all of this.** Every item below is one question never asked:
> **"who else reads this word?"** Asked of a type token it produces §7.A and §7.F — a renderer that
> grew arms the declaration cannot name, and a declaration that names members no renderer has. Asked
> of a *key* it produces §7.C and §7.G — `sensitive` and `cadence`, both present in the data, both
> read by nobody on the side that would act on them. Asked of an *identifier* it produces §7.E. The
> app asks it well exactly once, for `ParamType`, and the answer there is a generated binding.

### 7.A — P0: one declaration, two renderers, and five type tokens that exist in neither the type nor the other renderer

| Path | Fact |
|---|---|
| `src/lib/types/designTypes.ts:168` | `AdoptionQuestion.type: 'text' \| 'select' \| 'boolean'` — **3 members** |
| `src/features/templates/sub_generated/adoption/QuestionnaireFormGridParts.tsx:304-307,:422-486` | recognises **8**: + `textarea`, `long_text`, `source_definition`, `devtools_project`, `directory_picker` |
| `…/QuestionnaireFormGridParts.tsx:478-486` | the final `else` is a bare `<input type="text">` |
| `src/features/templates/components/ConfigureStep.tsx:90,:104,:114` | recognises **3**, ends in its own text fallback |
| `src/features/templates/sub_presets/PresetQuestionnaireForm.tsx:21-32` | a **third** local declaration of the same concept, `type?: … \| string` |
| `src/features/templates/sub_presets/PresetQuestionnaireForm.tsx:14-15` | *"The Rust binding types these as `any` … passthrough JSON values from the template's design file"* |

A question authored as `directory_picker` renders a directory picker in one surface and an unlabelled
text box in the other, and the TypeScript type says neither exists. **Nothing in the chain can report
the mismatch**, because the union is not consulted at runtime and the two renderers never meet.

**Fix, in order:** (1) delete `| string` at `PresetQuestionnaireForm.tsx:26` — it is the only thing
making the third declaration inert; (2) promote the 8-token set into `AdoptionQuestion.type`
(the grid is the truth); (3) give `ConfigureStep` the same switch, or route it through the grid's
renderer; (4) add a runtime membership check at the point the questions leave the `any` binding,
because the union is a claim about bytes until then (Q4).

### 7.B — P1: a declared `select` with no options silently becomes a free-text box, in two of three renderers

`builtin_connectors.rs:1793` declares
`{"key":"twin_profile_id","label":"Twin Profile","type":"select","required":true,…}` — **no
`options`**, deliberately, because the options are twin profiles that do not exist at seed time.
Three renderers, three different guards:

| Renderer | Guard | Result |
|---|---|---|
| `ConnectorCredentialModal.tsx:69-82` | patches `options` when `f.key === 'twin_profile_id'` | `<ThemedSelect>` |
| `FieldCaptureRow.tsx:95` | `inputType === 'select' && options` | **`<input type="text">`** |
| `QuickAddCredentialModal.tsx:356` | `field.type === 'select' && Array.isArray(field.options) && field.options.length > 0` | **`<input type="text">`** |

Executed over all 196 live declarations through `EditFormFields`: **3 declared `select`, 2 rendered
as `<select>`.** The third is `twin_profile_id`, which is also `required: true`, so the one field the
user is *obliged* to fill is the one rendered as a box expecting a UUID. The `CredentialTemplateField`
doc comment (`types.ts:366-370`) uses this exact field as its worked example for the `{value,label}`
option form — **the declaration format's own documented example is the one that renders wrong.**

**Fix:** add an `optionsSource` member to the declaration (a token the renderer resolves), so
"dynamic options" is something the format can *say* rather than something one component hardcodes.

### 7.C — P1: a security-relevant key is in the data and in the Rust reader, and in no TypeScript type

Established in §0.3. Restated as a backlog item with its three halves:

| Component | State |
|---|---|
| the data | `sensitive` on **184 of 196** live field declarations |
| the Rust reader | `db/src/repos/resources/credentials.rs:104-108` — step 2 of `is_field_sensitive`, deciding encryption at rest at `:269` |
| the TS type | `src/lib/types/types.ts:358` — **absent**; no binding contains it either |
| the renderers | **none** read it; masking is `type === 'password'` (`FieldCaptureRow.tsx:58,:119`) |
| the app's own writer | `CredentialSchemaForm.tsx:121-125` rebuilds **7** keys and cannot emit it |

Measured consequence: **37 declarations say `sensitive: true` and render a visible control** — 32
`text`, 4 `url`, 1 `select`. Many are defensible (`confluence.email`, `jira.domain` — encrypt at rest,
fine to see while typing), which is the point: **the declaration is answering two questions with one
field and a second field nobody reads.**

**Fix:** add `sensitive?: boolean` to `CredentialTemplateField`, add it to
`CredentialSchemaForm`'s reconstruction, and make `FieldCaptureRow` derive masking from
`sensitive ?? (type === 'password')`. This is behaviour-changing on a surface the operator uses daily
— **not applied**; it belongs in
[`golden-path-deferred-fixes.md`](../golden-path-deferred-fixes.md). Coordinate with
[credential-capture-form](./credential-capture-form.md) §0.1, which measured the adjacent gap.

### 7.D — P1: the builder offers two field types its own player cannot render

| Path | Fact |
|---|---|
| `src/features/recipes/sub_editor/components/SchemaFieldBuilder.tsx:18` | `const FIELD_TYPES = ['text','number','boolean','select','textarea','json'];` — a `string[]`, **not `as const`** |
| `…/SchemaFieldBuilder.tsx:8-16` | `SchemaField.type: string` — no union at all |
| `…/RecipeEditor.tsx:55-64` | `serializeSchema` writes `{key, type, label, default?}` |
| `src/features/recipes/sub_playground/tabs/RecipeInputSection.tsx:124-158` | recognises `select`, `boolean`, `number`; everything else → `<input type="text">` |

A user picks `textarea` or `json` in the app's own recipe schema builder and gets a single-line text
input in the app's own recipe playground. Nothing warns, because there is no union to check against —
`FIELD_TYPES` is a plain array, so even `as const` would be an improvement.

Also here: **`parseInputSchema` exists twice, byte-identically**
(`src/features/recipes/shared/recipeParseUtils.ts:45` and
`src/features/recipes/sub_playground/tabs/recipeTestHelpers.ts:15`), and both are
`Array.isArray(parsed) ? parsed : []` — a pass-through, not a reconstruction, so the array reaching
the renderer is `any[]`.

**Fix:** `as const` on `FIELD_TYPES`, type `SchemaField.type` as `(typeof FIELD_TYPES)[number]`, and
give `RecipeInputSection` a switch over it. Four lines, and it makes the drift a compile error.

### 7.E — P1: the honesty instrument is blind to the one failure it exists for

`recipe_parameter_coverage.rs` exists to report declared settings that never became knobs.
`params_from_schema` (`recipe_parameters.rs:103-109`) begins:

```rust
let Some(name) = f.get("name").and_then(|v| v.as_str()).filter(|s| !s.trim().is_empty())
else { continue };   // "ignored entirely, reported as neither derived nor skipped"
```

The identifier is `name`. **Six of the thirteen declaration formats spell it `key`.** Replayed:

```
seeded catalog (594 decls, all spelled `name`)     declared 594  derived 572  skipped 22  ignored 0
a schema in the {key,type,label} spelling (6)      declared   6  derived   0  skipped  0  ignored 6
```

Six declared settings, zero knobs, and a coverage report that says **nothing is missing** — because
`skipped` is only reached after `name` resolves. The comment at `:99-102` reasons carefully about a
*blank* name (*"No seeded recipe has one"*) and does not consider a *differently-spelled* one.

**Reachability, measured, and narrower than it looks — which is the finding, not a reprieve.**
`params_from_schema`'s inputs are `AgentIrUseCase.input_schema` (model-authored) and the seeded
catalog. `recipe_definitions.input_schema` — the column `RecipeEditor.serializeSchema` writes — is
read only by the frontend; **no Rust consumer parses it**, so the editor's `key` spelling does not
currently reach this parser. And all 594 seeded declarations use `name`, and all 29 live use cases
carry no `input_schema`. So the hole is **latent with zero live instances**, and it stays latent only
for as long as every model that writes a `design_context` happens to choose `name` over the `key` that
six of this repo's own formats use.

**Fix:** accept `key` as an alias (one line, mirroring `useUseCaseDetail.ts:44`), and push the
`continue` into a third bucket so the coverage report can say *"1 entry had no usable identifier."*

### 7.F — P1: `required` is rendered and not enforced on the JSON-Schema form; the declared type never reaches the payload

§0.2 in backlog form. `McpToolInputForm.tsx:40,:49` renders the word "required" for every entry in
`schema.required`; `ToolDetail.tsx:58-68`'s Execute button is `disabled={executing}`;
`McpToolsTab.tsx:53` drops blank values from the payload entirely. And `:54`'s
`try { args[key] = JSON.parse(val); } catch { args[key] = val; }` is type-blind, so a `string`
property whose value looks like JSON is sent as the parsed value.

The far side is real: `engine/mcp_tools.rs:1192-1198` / `:1532-1539` validate the arguments against
the same `input_schema` with `jsonschema` 0.28. So the failure surfaces as a remote-ish error string
in a panel, for a form that had every fact needed to prevent it.

> **A correction to a neighbour, in passing.**
> [untrusted-definition-validation](./untrusted-definition-validation.md) §7.E reports *"`jsonschema`
> … has one call site, `engine/mcp_tools.rs:1704`."* That line is the `jsonschema::validator_for`
> call *inside* the helper; the helper `validate_arguments_against_schema` has **four** callers
> (`:1193`, `:1197`, `:1534`, `:1539`). The path's conclusion — that the crate protects the remote
> server rather than this app, and fails open twice — is unaffected and correct. The number is worth
> fixing because "one call site" reads as "effectively unwired", and the stdio and SSE transports
> each reach it twice.

**Fix:** coerce per declared `type` before assembling `args`; render `enum` as a select; derive the
Execute button's `disabled` from the same `required` array that renders the label. All three are in
one file plus one prop.

### 7.G — P2: the trigger config reconstructor drops keys that 23 and 39 live rows carry

`parseTriggerConfig` (`triggerConstants.ts:475-554`) rebuilds each variant from named keys — correct
in shape. Measured against the 351 live configs:

| trigger_type | stored keys (rows) | read by the reconstructor |
|---|---|---|
| `schedule` (32) | `cron` 32, **`cadence` 23**, `timezone` 9 | `cron`, `interval_seconds`, `timezone`, `max_backfill`, `event_type` |
| `event_listener` (189) | `listen_event_type` 189, `source_filter` 136, **`_auto_for_trigger` 39**, `event_type` 6, `filter` 1 | `listen_event_type`, `source_filter` |
| `manual` (68) | `event_type` 12, **`filter` 6** | `event_type` |

`cadence` appears on 23 of 32 schedule configs and is read by neither the TypeScript reconstructor
nor the Rust `TriggerConfig` (`core/src/models/trigger.rs:331-341,:640`). The underscore prefix on
`_auto_for_trigger` marks it as internal, which is the honest form of an undeclared key; `cadence`
and `filter` carry no such signal.

Also: `triggerConstants.ts:552-553` — an unrecognised `trigger_type` returns `{ type: 'manual' }`.
A declaration whose variant nobody implements silently becomes the least-capable variant.

Firing behaviour is [scheduled-trigger-firing](./scheduled-trigger-firing.md)'s territory and is not
re-derived; what belongs here is that **the config is a per-variant field declaration, and its
reconstructor's key list is hand-maintained against data nobody diffs it with.**

### 7.H — P2: a malformed declaration crashes the panel

Executed: `{type:'object', properties:{a:null}}` throws at `McpToolInputForm.tsx:41`
(`Cannot read properties of null (reading 'type')`) — `const prop = properties[key]!` uses a non-null
assertion and `properties` is `Record<string, Record<string, unknown>>`, which cannot express a null
value. Every other hostile shape rendered something; this one takes the tab down. Whether an error
boundary catches it is [error-boundary](./error-boundary.md)'s territory; the declaration-layer fix is
one guard in the `.map`.

### 7.I — P2: two live declarations are invisible to the app's own test harness

`FieldCaptureRow.tsx:128` sets `data-testid={`${testIdBase}-input`}` on the `<input>` branch;
`:96-115`'s `ThemedSelect` branch sets none. Measured over all 196 declarations: **2 of 2 rendered
selects have no testid** (`gemini_vision.model`, `google_gemini.model`). This surfaced only because
the harness asserted its instrument — the first version of the measurement reported "0 masked, 150
sensitive-but-visible" from a selector that matched nothing, which is the shape of every gate that
runs green while checking nothing.

### 7.J — what this path CLEARED

Four things the brief, or the obvious reading, predicts, which measurement refutes:

- **"`Record<string, …>` will have disarmed an exhaustive union in the form layer, the way it did in
  the locale lookup and the remediation chip."** **Not in that form.** The value bags
  (`values`, `extraState`, `answers`) are `Record<string, T>`, but there is no union for them to
  disarm — the declarations key their values by a free `string`. The real instance is one layer over:
  `McpToolInputForm.tsx:26` widens `schema.properties` to `Record<string, Record<string, unknown>>`,
  which erases the *property's* shape and forces `(prop.type as string) || 'string'` at `:41`. The
  disarmed thing is a JSON-Schema type union, not a TS one, and the visible consequence is
  `Object.keys('a,b,c')` rendering five inputs — not a wrong-coloured badge.
- **"`deny_unknown_fields` being absent means declarations accept unknown keys."** True and beside
  the point here. **No declaration format in this leaf has a closed key set to enforce**: the widest
  key list for a connector field exists only as Rust seed literals, the TS type is narrower by one
  key, and the write path is narrower still. `deny_unknown_fields` would have nothing to reject
  against.
- **"A credential form is where scopes are chosen, so the scope defect will show up here."** It does
  not. The 6-scopes-across-3-products connector is
  [least-privilege-scope-grant](./least-privilege-scope-grant.md) §850's finding and lives in the
  *connector's* scope list, not in any field declaration: `oauth_scopes` appears in connector
  `metadata`, and **no `fields` declaration in any of the 134 connectors renders a scope chooser.**
  The declaration layer is not where that decision is made. Cited, not re-derived.
- **"`ExtraFieldRenderer`'s switch with no `default` will silently render nothing."** It would — but
  `ExtraFieldDef` is a genuine closed discriminated union in code, never crossing a serialization
  boundary, with all three arms implemented. It is the compliant case, and the only
  declaration/renderer pair in `src/` whose vocabularies are equal.

---

## 8. Gaps — what the primitives genuinely cannot do

1. **A generated union cannot reach a declaration typed `any` on the wire.**
   `PresetMemberAdoptionSchema.questions` is `any` by design. The union constrains the code that
   *handles* the value and says nothing about the value. Closing this needs a runtime membership
   check at the boundary — which is work no primitive concentrates, and which is why Q4 bites here.
2. **A declaration format cannot currently say "these options are dynamic."** §7.B. Closing it means
   adding a member (`optionsSource`) and a resolver registry — real design work, and the honest
   reason the twin field is patched by key-equality in one component.
3. **A control-kind union cannot express what a `format` or an `enum` means.** JSON Schema declares
   far more than a widget name; a widget enum is strictly less expressive. Mapping 123 `enum`s to a
   select is mechanical; mapping `format: uri`, `minLength`, `pattern` is a second, larger
   vocabulary, and pretending one union covers both is how `type` came to mean two things (§0.3).
4. **`Record<string, T>` is the right transport for a value bag and the wrong authority for a key
   set, and nothing in TypeScript distinguishes those.** A mapped type over the declaration's keys
   would need the declaration to be a literal, which it is not — it comes from a database.
5. **The census cannot assert the absence that matters.** *"No renderer recognises a token the
   declaration cannot name"* is a statement about two artifacts. §9 counts a third, countable thing
   and says so.
6. **Two renderers of one format cannot be made to agree by a type.** Both would type-check against
   the same union while implementing different subsets of it; TypeScript checks that arms are *legal*,
   not that they are *complete*, unless the switch's return type forces it. A test that renders every
   union member through every renderer is the instrument, and no primitive supplies it.
7. **The residue report cannot see what the parser skipped before classification.** §7.E. This is a
   general property of report-what-you-dropped: the report's coverage is bounded by how early you
   `continue`.

---

## 9. The missing gate

### First, the contract's prior question: prefer a type over a gate

**Yes — and the type is a *generated* control-kind union, not merely a closed one.** §4 holds it
against all seven qualifications and lands on **Q1 with a hard Q4 caveat**: `ParamType` +
`parameterEditing.tsx` makes vocabulary drift a compile error and is the fix to ship; but
`CredentialTemplateField.type` is *already* a correctly closed union and did not prevent §0.3
(the key it needed was elsewhere), and `AdoptionQuestion.type` is a closed union whose data arrives
through an `any` binding, so it constrains the code and not the value. **Ship the generated unions,
and ship a runtime membership check at each reconstruction beside them.** The gate below ratchets the
dimension neither reaches: the renderers that never consult a union at all.

### The condition this signal is a proxy for

> *The set of field types a form renderer recognises is written by hand next to the renderer instead
> of being derived from the declaration, so the two drift in both directions and an unrecognised
> declared type falls silently into the chain's last arm.*

**An adopting repo must re-derive its own proxy and must NOT port this pattern.** The precondition
here is specific and measured: this repo spells the defect as a TypeScript `===` against a
control-kind string literal. In Rust the same condition wears `match raw_type { … _ => None }`
(`engine/src/recipe_parameters.rs:66-77`); in a JSON-Schema renderer it wears
`(prop.type as string) || 'string'` (`McpToolInputForm.tsx:41`); in `vibeman` it wears an if-chain
ending `return null` (`PropsControl.tsx:43`) and a `default: return false`
(`triageRulesEngine.ts:49`). **This pattern scores zero on all four.**

### Not already gated — the neighbours I checked, at SITE level, against the FINAL pattern

All **162** rules in `scripts/census/rules.json` were enumerated; the **73** rooted at `src` were run
against my match set and compared **site by site (file:line), not file by file**. My pattern produces
**42 matches across 37 distinct sites**. Exactly one rule overlaps:

| rule | goldenPath | their sites | overlapping | share |
|---|---|---:|---:|---|
| `data-decided-secret-masking` | credential-capture-form | 4 | **2** | 5.4% of mine, 50% of theirs |
| every other `src`-rooted rule (72) | — | — | **0** | — |

The two shared sites are `EditFormFields.tsx:44` and `AutoCredReview.tsx:107`. They coincide because
**one expression does two jobs**: `inputType={field.type === 'select' ? 'select' : field.type ===
'password' ? 'password' : …}` chooses both the widget *and* the masking. The neighbour keys on the
JSX attribute (`(?:\binputType|\btype)=\{…\?\s*['"]password['"]`) and asks *is masking decided by
data*; mine keys on the comparison and asks *is the vocabulary derived*. Neither subsumes the other,
and 5.4% is far below the 83% that has justified a decline in this corpus. Ship both, and note the
coincidence so a future reader does not "merge" them.

Rust-side neighbours (`model-reply-parser-without-a-reason`, `untyped-command-payload`) are `.rs`-only
and key on signatures; no pattern overlap is possible.

### Precision and recall

**Precision: 13 of 13 files hand-read**, every one a declaration-driven form or a helper over the same
declaration: `QuestionPanel` (triage questions), `RecipeInputSection` + `useScrapeForm` +
`FieldRuleRows` (recipe and scraper field rules), `ConfigureStep` + `QuestionnaireFormGrid` +
`QuestionnaireFormGridParts` + `questionnaireHelpers` (adoption questions), `QuickAddCredentialModal`
+ `AutoCredReview` + `EditFormFields` + `orchestratorDerived` (credential fields),
`useN8nTransform` (transform questions).

**The false positives that were removed, and why it matters.** The first draft's receiver list
included `entry`, `item` and `answer` from imagination; it produced 15 files / 44 matches, and the
two extra files were `autoCredHelpers.ts:230` and `AutoCredBrowser.tsx:139`, both
`entry.type === 'url'` on a `BrowserLogEntry` — a log record, not a declaration. Re-deriving the
receiver list from the actual `.map((X) =>` bindings over declared field arrays in this tree removed
them and took precision to 13/13. **The control-kind vocabulary is derived the same way** — the union
members of the 13 declaration formats plus the 11 declared `type` tokens in the 594-field seeded
catalog — never invented, exactly as the doctrine's vocabulary rule demands.

**Recall is deliberately partial and stated.** The pattern requires the comparison to name the
declaration directly, so it misses:
- a chain over a **local copy** of the declared type — `const propType = (prop.type as string) ||
  'string'` then `propType === 'boolean'` (`McpToolInputForm.tsx:41,:63`), which is §0.2's own
  renderer;
- a `switch` whose `default` is a silent fallback (`StructuredField.tsx:62`) — counted by the
  *control*, which is why the control partitions rather than certifies;
- `Array.prototype.includes` forms (`['object','array'].includes(propType)`,
  `McpToolInputForm.tsx:43`).

Widening the receiver to any identifier raises the count to 97 across 31 files and drops precision
below 50% by pulling in every `item.type === 'execution'`-shaped list renderer. **The narrow form was
chosen for precision over recall and the trade is stated here so the next reader does not "fix" it.**

### Two implementations — exact agreement on count *and* membership, after a matcher bug was caught

A regex walker and a string/comment-aware character scanner disagreed at **15/44 vs 14/43**. The
single missing site had a named cause — no regex-literal state, desynced by `URL_REGEX` at
`autoCredHelpers.ts:171` (see §6). After adding a regex-literal arm both implementations report
**13 files / 42 matches with identical membership**. *Agreement is not soundness — but a
disagreement that names its own cause is.*

### The positive control partitions the anchor

Both rules key on the same anchor: a declared field's `type`/`kind` driving a control choice. The
violating arm counts the `===`-against-a-literal form; the control counts the `switch` form. Disjoint
by construction.

```
42  a declared field's type compared to a control-kind literal    <- violating (13 files)
 4  a switch on a declared field's type/kind                      <- compliant  (4 files)
```

A control returning ~0 would mean the repo has no compliant form and the rule is measuring house
style rather than a choice. It returns 4, and the exemplar is `ExtraFieldRenderers.tsx:15`.
**And the control is deliberately not a certificate:** `StructuredField.tsx:12` is counted compliant
and still ends in `default: // text` (`:62`), which §0.4 shows swallows 10 of 13 tokens. Arriving at
a switch is not the same as handling the vocabulary — the same shape the contract's fifth failure
mode names, and it is stated in the control's own description so nobody reads a rising control as
progress.

```json
{"rules":[{"id":"declared-field-type-literal-chain","goldenPath":"docs/concepts/golden-paths/schema-driven-form.md","title":"A form control is chosen by comparing a declaration's own `type`/`kind` to a string literal, so the recognised vocabulary is hand-maintained beside the renderer instead of derived from the declaration","roots":["src"],"extensions":[".ts",".tsx"],"signal":{"pattern":"\\b(?:field|fld|f|question|q|param|parameter|prop|def|input|requirement)\\s*(?:\\?\\.|\\.)\\s*(?:type|kind|fieldType|inputType)\\s*===\\s*(['\"`])(?:text|textarea|long_text|password|url|email|select|multiselect|multi_select|boolean|bool|number|integer|float|string|json|checkbox|toggle|radio|date|cron|enum|source_definition|connector_ref|devtools_project|directory_picker|key-value-list|choice|css|regex)\\1","flags":"g","ignoreCommentLines":true,"description":"A schema-driven form picks its control by === against a control-kind literal. PROXY FOR the stack-free condition: the set of field types a renderer recognises is written by hand next to the renderer, not derived from the declaration, so declaration and renderer drift in both directions and an unrecognised type falls silently into the chain's last arm. Measured 2026-08-17 at 50d736f6c: 13 files / 42 matches / 37 distinct sites, against 4 files / 4 matches for the exhaustive-switch form on the same anchor. Vocabulary DERIVED FROM THE TREE (the union members of the 13 field-declaration types + the 11 declared type tokens in the 594-field seeded recipe catalog), never invented. RECEIVER LIST is also derived, from the `.map((X) =>` bindings over declared field arrays; `entry`/`item`/`answer` were in the first draft FROM IMAGINATION and produced the only false positives (BrowserLogEntry, ReasoningTrace, execution-summary rows are log records, not declarations) and were dropped, taking precision to 13/13 files hand-read. SITE overlap with data-decided-secret-masking (credential-capture-form) is 2 of 37 (5.4% of mine, 50% of theirs), at EditFormFields.tsx:44 and AutoCredReview.tsx:107, where one expression chooses both the widget and the masking; the conditions differ (masking-decided-by-data vs vocabulary-not-derived) and neither subsumes the other. All 73 src-rooted rules were run site-by-site against the final pattern; the other 72 overlap at zero sites. RECALL is deliberately partial: a chain over a LOCAL copy of the declared type (`const propType = (prop.type as string) || 'string'` then `propType === 'boolean'`, McpToolInputForm.tsx:41,:63) is invisible, as is a switch whose default arm is a silent fallback (StructuredField.tsx:62) and an `includes` form (:43). Widening the receiver to any identifier gives 31 files / 97 matches at under 50% precision. CORRECT END STATE is 0, at which point DELETE this rule rather than baselining it at zero. PRECONDITION (re-derive per repo, do NOT port): this repo spells the defect as a TS `===` against a control-kind literal. In Rust it wears `match raw_type { _ => None }` (engine/src/recipe_parameters.rs:66-77); in a JSON-Schema renderer `(prop.type as string) || 'string'`; in vibeman an if-chain ending `return null` (PropsControl.tsx:43). This pattern scores ZERO on all three."},"baseline":{"files":13,"matches":42},"floor":4000},{"id":"declared-field-type-literal-chain-positive-control","goldenPath":"docs/concepts/golden-paths/schema-driven-form.md","title":"POSITIVE CONTROL — the compliant half: an exhaustive switch over the declaration's own discriminant","roots":["src"],"extensions":[".ts",".tsx"],"signal":{"pattern":"\\bswitch\\s*\\(\\s*(?:field|fld|f|question|q|param|parameter|prop|def|input|requirement)\\s*(?:\\?\\.|\\.)\\s*(?:type|kind|fieldType|inputType)\\s*\\)","flags":"g","ignoreCommentLines":true,"description":"POSITIVE CONTROL: the same anchor (a declared field's type/kind driving a control choice), compliant form — a `switch` on the discriminant, which TypeScript can exhaustiveness-check when the union is closed and the arms share a return type. Disjoint from the violating pattern by construction (`switch (x.type)` vs `x.type === 'lit'`). Must be non-zero: a control near zero would mean the repo has no compliant form and the violating rule is measuring house style rather than a choice. Exemplar: ExtraFieldRenderers.tsx:15, `switch (def.kind)` over a closed 3-member discriminated union whose renderer recognises exactly the 3 declared members. NOTE, and this is why the control PARTITIONS rather than CERTIFIES: StructuredField.tsx:12 is counted here and still ends in `default: // text` (:62), which was executed against 13 declared type tokens and swallowed 10 of them into a textarea. Arriving at a switch is not the same as handling the vocabulary; a rise in this control is not by itself progress."},"floor":4000}]}
```

### Validation — run 2026-08-17 via `node scripts/census/run-census.mjs --rules <scratch> --check`

The rule was validated in a **private scratch registry with a filename unique to this composer**
(`sdf-scratch-rules.json`). The full registry was **not** run, per the doctrine.

| # | Scenario | Expected | Observed | Exit |
|---|---|---|---|---|
| 1 | Rule + control as shipped, `--check` | baseline holds; control non-zero | `OK declared-field-type-literal-chain 13/13 files, 42/42 matches, 4829 walked, floor 4000` · `OK …-positive-control 4 files, 4 matches` | **0** |
| 2 | Fault: **rise** — baseline claims 12/41 | must fail | `files rose 12 -> 13 (+1)` · `matches rose 41 -> 42 (+1)` | **1** |
| 3 | Fault: **silent drop** — baseline claims 14/43 | must fail | `files dropped 14 -> 13 (-1) without the baseline moving. A silent drop is a broken matcher more often than fixed code` | **1** |
| 4 | Fault: **broken matcher** — `roots` narrowed to one directory | must fail structurally | `walked 10 files but floor is 4000. THE MATCHER IS BROKEN, NOT THE CODEBASE CLEAN` | **1** |
| 5 | Fault: **zero match** — pattern replaced with a nonexistent token | must fail structurally | `matched zero files anywhere … DELETE the rule rather than baselining it at zero` | **1** |
| 6 | Fault: **control returns zero** | must fail structurally | same zero-match structural failure, on the control | **1** |
| 7 | **Re-extracted from this document** and re-run | identical | identical to #1 | **0** |

### Where it executes

**`npm run census:check`, which is chained inside `npm run check` AND is a `pre-push` lefthook job**
(`lefthook.yml`, `golden-path-census`). Per the brief's calibration, `ci.yml` is red on pre-existing
failures and was not used. The runner's own fail-loud contract (floor, zero-match, stale-exclude,
rise, silent drop) is what makes this a gate rather than a report; rows 2–6 are that contract
exercised.

### What this gate does NOT catch

It ratchets one spelling of one half of the condition. It cannot see: a renderer that recognises a
token the declaration does not declare (§7.A — that is a comparison of two artifacts, and the census
counts one); a declaration key no renderer reads (§7.C, §7.G — an absence); a `required` that is
rendered and not gated (§7.F); a coercion that ignores the declared type (§0.2); or a union
annihilated by `| string` (§7.A, 2 sites tree-wide — real, and too small to ratchet honestly).

**The honest §9 for §0.1 is a different instrument, and it is worth specifying:** a test that, for
each declaration format, renders **every member of its union through every renderer of that format**
and asserts that no member reaches a fallback arm. That is an inventory-of-what-should-exist check,
which the census structurally cannot express — the same shape the doctrine records for orphan
bindings and unregistered queues. It would have found §7.A, §7.B and §7.D on the day each was
written, and it is ~40 lines of vitest given the harness in §0.

**Ship the generated unions first, the membership checks beside them, the cross-renderer test second,
and this ratchet to hold the line until they land.**

---

## 12. Corrections to the brief

The brief made six priming claims and set one calibration. **Two were confirmed, two need correcting,
one pointed at a real thing in the wrong place, and the two spine labels both failed.**

1. **"`deny_unknown_fields` appears 0 times in the tree, so a shapeless object deserializes into a
   real-looking decision."** **Confirmed by the neighbour and extended, but the framing inverts in
   this layer.** The shapeless object is real and I found its purest instance: **all 162 parsed
   `persona_tool_definitions.input_schema` rows are `{"type":"object","properties":{},
   "additionalProperties":true}`** — a declaration that declares nothing and permits everything, in
   the one table whose whole job is to declare tool parameters. But `deny_unknown_fields` is **the
   wrong instrument for this leaf**, for a reason the brief could not know: **no field-declaration
   format here has a closed key set to enforce.** `connector_definitions.fields` carries `sensitive`
   on 184 of 196 rows; the TS type declares 7 keys; the app's own write path emits 7; the widest key
   list exists only as Rust seed literals. There is no canonical shape to deny unknowns against.

2. **"`Record<string, …>` widening has now disarmed an exhaustive union twice — look for it in the
   form layer, where it is the natural shape."** **The prediction is right and the location is
   wrong, and the correction is the more useful finding.** The natural-shape widening — `values:
   Record<string, string>`, `extraState: Record<string, unknown>` — disarms **nothing**, because the
   declarations key their values by a free `string`; there is no union there to destroy. The real
   instance is one layer up and is a *JSON-Schema* union, not a TS one:
   `McpToolInputForm.tsx:26` widens `schema.properties` to `Record<string, Record<string, unknown>>`,
   which erases that each property has a shape and forces the `as string` at `:41`. Executed
   consequence: `properties: 'a,b,c'` renders **five inputs labelled 0, 1, 2, 3, 4**, because
   `Object.keys` of a string returns its indices. **The disarming widening in a form layer is on the
   declaration, not on the values.**

3. **"58 of 119 `<textarea>` files have no home for the text beyond `useState`."** **Not tested here
   — and the form layer supplies a reason the count exists rather than a re-derivation of it.** In
   this leaf the `<textarea>` is what a declaration gets when the renderer does not recognise it:
   `StructuredField.tsx:62`'s `default:` arm renders a textarea, and executed against 13 declared
   type tokens it swallows **10**, including `password` and `url`. A textarea reached by falling
   through a union has no home for its text by construction — nobody decided it should exist.

4. **"`forms/FormField`, `forms/Listbox`, `forms/AccessibleToggle`, `INPUT_FIELD` are the catalogued
   primitives, and there are 47 raw-select files and 288 raw-input files. State your denominator and
   measure it twice."** **Denominator: 4,829 `.ts`/`.tsx` files under `src/`, measured twice** — by
   this composer's walker and by the census runner's own `walked` — agreeing exactly. **Both of the
   brief's numbers are off, in the same direction:**

   | | brief | measured (raw) | measured (after the `raw-select` rule's excludes) |
   |---|---:|---:|---:|
   | raw `<select` | 47 files | **51 files / 69 matches** | 46 files / 63 matches (the live baseline) |
   | raw `<input` | 288 files | **291 files / 456 matches** | — (no rule exists) |
   | raw `<textarea` | 119 files | **119 files / 130 matches** | — |

   The textarea figure is exact. The other two sit between the ratcheted baseline and the raw count,
   which is the signature of a number copied from a rule's `baseline` and then aged. **Cite the
   baseline or cite the raw count, and say which** — they differ by 5 files for selects.

5. **"A credential form is where scopes are chosen, and one connector asks for 6 scopes across 3
   Google products — cite `least-privilege-scope-grant`, don't re-derive it."** **Cited, and the
   premise does not hold in this layer.** No `fields` declaration in any of the 134 live connectors
   renders a scope chooser; `oauth_scopes` lives in connector `metadata` (16 of 134 rows) and never
   reaches a field renderer. A credential form is where *credentials* are typed; scopes are decided
   in the connector definition, above the declaration layer. The finding is real and belongs where it
   is (§7.J).

6. **On the spine's `sides: "client"` — CONTRADICTED, and this is the eighth contradiction.** The
   census rule is client-side, and so are five of the ten deviations. But **the exemplar this whole
   path prescribes is a Rust enum** (`core/src/models/persona.rs:218`), the fleet's only
   residue-reporting parser is Rust (`recipe_parameters.rs:93`), the one key that decides a security
   property is read only in Rust (`credentials.rs:104-108`), and the far half of the only
   one-declaration-two-consumers pair is Rust (`mcp_tools.rs:1695`). **A client-scoped brief would
   have found the eight hand-chained renderers and missed every artifact worth copying.** The honest
   label is `both`, and the mechanism is that a schema-driven form's declaration is *stored*, so
   whatever writes and validates the store is a peer of the renderer, not an implementation detail
   beneath it.

7. **On the spine's `convergence: "diverged"` — CONTRADICTED, in the doctrine's tenth mode.** The
   label predicts the fleet disagrees. Measured: **three of five siblings have no declaration-driven
   form renderer at all** (`personas-web`, `personas-cloud`, `ascent` — reported as silence, not as a
   weak yes), `brainiac` has a homogeneous facet rail with no type union to diverge on, and the one
   repo that does have the situation has it **twice and answers it the same wrong way both times**:
   `PropsControl.tsx:43` returns `null` and `triageRulesEngine.ts:49` returns `false`, each for an
   unrecognised declared type, each silently. **The fleet did not diverge; it converged on the
   disease, in the only two implementations that exist.** Per the doctrine, always ask what the
   siblings agreed *to do* — here they agreed to fail open. And note the shape of the agreement: it is
   two renderers in *one* repo, which is a weaker datum than "two repos", and it must be reported
   that way.

8. **A correction to the corpus's standing assumption about sibling lineage, and it runs the opposite
   way.** The doctrine warns that `personas-web`, `personas-cloud` and `vibeman` contain **ports of
   this repo's code** and must be discounted. Two of the three hold: `personas-web` is a port and a
   consumer (`src/data/connectors.ts:47` — *"Generated from personas/scripts/connectors/builtin/*.json
   … by scripts/generate-connectors.mjs"* — plus seven files annotated *"Mirrors the desktop …"*);
   `personas-cloud` self-declares at `packages/shared/src/types.ts:2` (*"Persona domain types
   (mirroring desktop Tauri models)"*). **`vibeman` inverts.** `TriageRulesPanel.tsx` exists in both
   repos with the same component name, the same props, the same `FIELD_OPTIONS` constant and the same
   domain-specific member text (`{ value: 'scan_type', label: 'Scan Type' }`) — but the vibeman repo's
   first commit is **2025-07-04** against personas' **2026-02-17**, and vibeman's copy of that file
   predates personas' by 18 days (2026-03-06 vs 2026-03-24). **Personas ported from vibeman, not the
   reverse.** The exclusion still applies — shared lineage is shared lineage in either direction — but
   the corpus should stop describing it as "a port of this repo", because that framing would have led
   a composer to treat vibeman's original work as derivative of ours. Its second renderer
   (`HallOfFame/PropsControl`) has **zero** counterpart in `personas/src` and is fully independent.

   **Measured independent cohort for this leaf: 2 of 5** (`brainiac`, `ascent`), with `vibeman`
   qualified as a third for its independent half. `ascent` also carries one ported *dev-tooling*
   module (`_dev-inspector/devLocate.ts`, ~75% textually identical to `personas/src/lib/dev/
   devLocate.ts`, byte-identical JSDoc lines), which does not touch any declaration or form surface
   cited above.

9. **A prediction of my own, disproved and recorded as such.** Reading `SchemaFieldBuilder`
   (`serializeSchema` writes `key`) beside `params_from_schema` (reads `name`, `continue`s otherwise),
   I expected a live defect: every recipe input field authored in the app's own editor deriving zero
   parameters, with a coverage report showing nothing missing. **It is not live.** The recipe editor
   writes `recipe_definitions.input_schema`, and **no Rust consumer parses that column** — coverage is
   computed from `prompt_template` (`recipe_parameter_coverage.rs:62-68`), and
   `params_from_schema`'s real inputs are the seeded catalog (594/594 spelled `name`) and
   `AgentIrUseCase.input_schema` (0 live instances). The hole in §7.E is real, has zero live
   instances, and stays that way only while every model that authors a `design_context` happens to
   pick `name` over the `key` that six of this repo's own formats use. **The effort spent trying to
   prove it live is what produced §7.E's honest reachability paragraph** — and the near-miss is
   exactly the doctrine's "false premise whose conclusion survives": the identifier split is real,
   the instrument's blindness is real, and the path I first drew between them was not.

10. **An instrument failure of my own, caught by its own assertion.** The first run of the
    196-declaration masking measurement reported **0 masked, 150 declared-sensitive, 150
    sensitive-but-visible** — a clean, plausible, entirely false result, produced by a selector whose
    first alternative matched a wrapper element instead of the control. The fix was an explicit
    *"throw if no control was found"* precondition, which immediately failed on
    `gemini_vision.model` — **surfacing §7.I, a real defect (the `ThemedSelect` branch carries no
    `data-testid`), that the working measurement would never have shown.** The corrected numbers are
    119 masked / 37 sensitive-but-visible. A measurement that finds nothing and a measurement that
    finds zero look identical unless you make the instrument say which.

**Scratch artifacts.** The jsdom harness, the private vitest config, the four scanners, the scratch
rule registry, the transliteration of `params_from_schema` and the database copies live in the
session scratchpad and were not written into the working tree. **The database copies were deleted at
the end of composition.** The only file this composition adds is this document.
`scripts/census/rules.json` was **not** edited — both rules ship as the fenced JSON above, per the
contract's concurrent-composer rule.
