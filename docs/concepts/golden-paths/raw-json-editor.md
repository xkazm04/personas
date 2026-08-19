# Raw JSON editor

> Situation node: `ui-system/controls-and-forms/raw-json-editor` ·
> [situation spine](../situation-spine.md) · recurrence 9 · risk **medium** ·
> dimensions: ui · function · resilience · security · `sides: "client"` ·
> `twoSided: false` · `convergence: "diverged"` ·
> merged from *"Freeform JSON payload editor"* + *"Raw definition JSON editor"*
>
> *"Hand-authoring JSON with parse errors, schema hints and a safe save path."*
>
> **Full contract** (Mode 2 tiering: `medium` risk at recurrence 9). Composed
> 2026-08-17 against `master` from a sweep of `src/` (4,801 `.ts`/`.tsx`, of
> which 2,083 `.tsx`) and `src-tauri/` (963 `.rs`), walked by four independent
> instruments — a TypeScript 6.0.3 AST pass over every `JSON.parse` call site, a
> depth-tracked JSX open-tag scanner, a balanced-paren Rust scanner, and the
> census engine itself — plus **two executed replays** (`KeyValueEditor`'s round
> trip and the published rule's own pattern), and a five-repo convergence sweep.
>
> No claim in this document depends on database rows, so the 2026-08-17 purge
> does not touch it. Where a row count would have helped — how many stored
> `input_schema` blobs actually fail to parse today — it is **unmeasurable**, and
> that is said out loud in §8.

---

## §0 Headline

**Every raw-JSON surface in this app throws away the one thing it computed. The
shared primitive parses the user's document, decides `valid | invalid | empty`,
paints a badge from that verdict — and its `onChange` hands the caller a bare
`string`. So the verdict the user is looking at and the verdict that gates the
write are two different computations of the same predicate — and 4 of the 12
JSON-authoring surfaces never make the second one count at all: two never parse
the document anywhere on the path, and two parse it, fail, and send the user's
raw string onward as if it had.**

`JsonEditor.tsx:123-136` builds `validationState` in a `useMemo`, renders it at
`:177-189`, and then at `:229` calls `onChange(e.target.value)` — the prop is
typed `(value: string) => void`. There is no channel for the verdict. Its two
consumers both re-derive it, in a different closure, from a different read of
the same state: `useRunnerExecution.ts:54-55` and `useUseCaseExecution` each
re-parse at execute time. That is the benign case.

The malignant case is what happens when nobody re-derives it.
`AutomationConditionStep.tsx:146` renders a monospace `<textarea>` labelled
*"input schema"* whose value is written straight to the database —
`useAutomationSetup.ts:205`, `input_schema: inputSchema.trim() || null` — with
no parse anywhere on the path. The column is a bare `Option<String>` in all
three Rust model declarations — `PersonaAutomation:216`,
`CreateAutomationInput:244`, `UpdateAutomationInput:271` (the last as
`Option<Option<String>>`), in `core/src/models/automation.rs`. Nothing ever
validates it. Then, at trigger time, `commands/tools/automations.rs:26-60`
parses it, fails, and **fabricates a document the user never wrote** —
`_ => r#"{"test": true}"#` — and posts that to the user's external webhook. The
user typed a schema, the app accepted it, stored it, and silently substituted
`{"test": true}` at the only moment it mattered.

That last move is not local. **55 of this repo's 640 `serde_json::from_str` call
sites (8.6%, in 42 of 963 `.rs` files) replace an unparseable document with a
fabricated one on the spot**, against **0 of 46 in `brainiac`** — the same
author's other Rust codebase, which propagates every one. §9 ratchets it.

---

## §1 Trigger — how do I know I'm in this situation

1. *"Let the user paste the JSON directly."* / *"Add an Advanced tab so they can
   edit the raw config."*
2. *"The form can't express this shape — give them a textarea."*
3. You are about to write `<textarea className="… font-mono">` or
   `typo-code` on a text control.
4. You are about to write `JSON.parse(` on a value that a `useState` setter
   received from an `onChange`.
5. You are about to type a placeholder that looks like `{ "key": "value" }`.
6. A column is `TEXT`/`Option<String>` and the UI's only writer is a free-text
   control. (If the column is a blob but the UI never edits it, you are in
   [json-blob-column](./json-blob-column.md), not here.)

**Not this situation:** rendering JSON the app produced
([`HighlightedJsonBlock`](../../../src/features/agents/sub_executions/detail/inspector/HighlightedJsonBlock.tsx)
and friends are viewers), and a *structured* form that happens to serialize to
JSON ([schema-driven-form](./schema-driven-form.md)).

---

## §2 The one way

**Treat the control as a parser that owns a verdict, never as a string input.**
Parse once, at the edit, into a **tagged outcome** —
`{ kind: 'empty' } | { kind: 'invalid', message } | { kind: 'valid', value: unknown }`
— hold *that* in state rather than a boolean or an error string, render its
`invalid` arm beside the control, and disable every write control while
`kind !== 'valid'`. Send the **text the user typed** to the write so their
whitespace, key order and number literals survive byte for byte; send the
`value` **from the same outcome** to anything that needs structure, so the
badge on screen and the guard on the button are one computation and not two.
The `value` is `unknown` and stays `unknown` until it crosses the *same*
field-by-field reconstruction the structured form uses — never a `as T`, never a
spread — so the escape hatch cannot admit what the form refuses. And on the far
side: a stored document that fails to parse is **an error with a reason**, never
a fabricated substitute; if the caller genuinely can proceed without it, say so
in a comment at the fallback and emit telemetry, because "the column was corrupt"
and "the column was empty" must not arrive at the reader as the same value.

The repo already contains this shape once, and it is the site to copy:
`usePasteImport.ts:20-62`.

Two answers are genuinely available for *where* the outcome lives, and the order
matters. **Reach first for the outcome living in the hook that owns the write**
(`usePasteImport`), because the button and the submit handler then read the same
object. Only put it inside the editor component when the editor *is* the whole
surface — and then the editor must emit it, not swallow it.

---

## §3 Mandated primitives

| Primitive | What it gives you | Where |
|---|---|---|
| `shared/components/editors/JsonEditor` | transparent-textarea-over-highlighted-`<pre>` overlay, a hand-written JSON tokenizer, a `Format` button gated on validity, auto-resize 128–320px | `src/features/shared/components/editors/JsonEditor.tsx` |
| `shared/components/forms/KeyValueEditor` | the **escape-hatch pattern**: key/value rows with a `Simple ⇄ Advanced JSON` toggle, duplicate-key detection, and a `canSwitchToSimple` guard that refuses to collapse a document the rows cannot represent | `src/features/shared/components/forms/KeyValueEditor.tsx` |
| `usePasteImport` | **the exemplar** — debounced-above-50 KB validation, a 5 MB ceiling, a *tagged* `pastePreview` outcome, structural validation past syntax, and a submit that is gated on the tag and re-sends the original text | `src/features/templates/sub_n8n/steps/upload/usePasteImport.ts` |
| `normalizeDraftFromUnknown` | field-by-field reconstruction of a parsed document into a typed draft — returns `null` rather than casting | `src/features/templates/sub_n8n/hooks/n8nTypes.ts:60-92` |
| `buttons/AsyncButton` / `buttons/Button` | the busy state on the save control ([inline-busy-state](./inline-busy-state.md)) | `src/features/shared/components/buttons/` |
| `display/Tooltip` | the hint on the `Format` affordance | `src/features/shared/components/display/Tooltip.tsx` |

**Do not reach for** `vault/sub_databases/SqlEditor` for JSON. It accepts
`language="json"` and its tokenizer has a `case 'json'` arm
(`sqlTokenizers.ts:238`), so it *looks* right — and it has **no validation of any
kind**. One caller uses it for a JSON request body today (§7 D4).

---

## §4 Steps

1. **Ask whether the raw editor should exist at all.** It is an escape hatch from
   a typed form. If there is no typed form, you are building a form with a
   textarea, and the answer is [schema-driven-form](./schema-driven-form.md).
2. **Declare the outcome type before the control.** `type JsonDoc<T> = { kind:
   'empty' } | { kind: 'invalid'; message: string } | { kind: 'valid'; text:
   string; value: unknown }`. Write it as a discriminated union — a `string |
   null` error field and a separate `value` field let both be set at once, which
   is the state your reducer will eventually reach.
3. **Parse in the change handler, not in render.** One parse per keystroke, one
   outcome. If the document can be large, debounce above a threshold and keep the
   cheap checks (empty, over-limit) immediate — `usePasteImport.ts:49-57` is the
   shape, with a **5 MB ceiling** that exists because a paste is not typed.
4. **Gate the write on the tag, twice** — `disabled={outcome.kind !== 'valid'}`
   on the control *and* an early `return` in the handler. `TestTab.tsx:203-208`
   does exactly this and says why in a comment naming the incident it prevents;
   copy that comment habit.
5. **Reconstruct before the value becomes app state.** Hand `outcome.value` to a
   function that reads each field by name and builds a new object
   (`normalizeDraftFromUnknown`). **And then stop** — that function owns the
   contract from here; the editor never learns the shape.
6. **Send the text, not your re-stringify.** `JSON.stringify(JSON.parse(x))`
   discards the user's formatting and, for a document they will open again,
   discards their key order. Re-stringify only when the receiver is a machine
   that wants canonical form, and say so at the call site
   (`TestTab.tsx:212-216` does).
7. **Make the far side refuse.** The Rust reader of the column parses with `?` or
   `.map_err`. If it truly can degrade, the fallback arm logs — see §9.

### Can the signature make the wrong call impossible?

Per the contract, ask this before §9. Here it can, and the edit is small.

`JsonEditor`'s `onChange: (value: string) => void` is a **Q5 (withholding)**
case in its purest form: the primitive *already computed* the verdict and hands
back only the dangerous half. Widen it to
`onChange: (value: string, parsed: unknown | undefined) => void`, or add
`onValidityChange`, and a consumer that wants to gate a button can no longer do
it by accident from a stale second parse. It is source-compatible — every
existing 2-argument-blind call site keeps compiling.

It is **not sufficient**, and the qualification matters:

- **Q1** — the tag carries *parses / does not parse*, and not one thing more. It
  cannot carry "this is a valid automation input schema". §7 D2's defect
  survives a perfect `JsonEditor` signature untouched, because that surface
  never mounts `JsonEditor`.
- **Q3** — a type nobody constructs constrains nothing. `JsonEditor` has **2
  call sites** in 4,801 files. Ten of the twelve JSON-authoring surfaces are
  hand-rolled `<textarea>`s that the signature cannot reach. The signature fix is
  correct and its blast radius is 2.
- **Doctrine §1 item 5 (serialization boundary)** — the value is a `TEXT` column.
  No TypeScript type and no Rust newtype reaches inside it, in either
  direction. That is why §9's rule lives on the *reader*, which is the last
  place the program can still decide what an unparseable document means.

So: propose the signature change as the fix, and the census rule as the ratchet
that holds the far side while it lands.

---

## §5 Anti-patterns

**A. Computing validity and discarding it.** `JSON.parse(x);` as an expression
statement — the code learns *that* it parses and throws away *what* it parses
to, forcing a second parse elsewhere. **7 production sites**
(`JsonEditor.tsx:127`, `TestTab.tsx:198`, `ToolInvocationCard.tsx:55`,
`PersonaDraft.ts:151`, `api/twin/twin.ts:185`, `ResponseViewer.tsx:39`,
`variableSanitizer.ts:164`). Failure mode: two verdicts that can disagree, and a
`useMemo` dependency list that is the only thing keeping them in step.

**B. `try { parse } catch { send the string }`.** The document silently changes
type at the boundary. `ApiPlayground.tsx:75-81` sends the raw body as
`inputData` when it does not parse; `McpToolsTab.tsx:53` does it per argument —
`try { args[key] = JSON.parse(val) } catch { args[key] = val }` — so a tool
declaring `{"type":"array"}` receives a `String`. Failure mode: the receiver's
type error is attributed to the receiver.

**C. A monospace textarea with no parser at all.** The control *looks* like a
JSON editor (`font-mono`, a `{ "…": … }` placeholder) and is a `String` all the
way down. §7 D2, D4.

**D. Re-stringifying the user's document back into the editor.** `handleFormat`
is opt-in and fine. `draftUpdated` at `useWizardReducer.ts:76` is not: any edit
in a *sibling form tab* overwrites `draftJson` from the draft, so half-typed raw
JSON disappears without a prompt (§7 D3).

**E. Coercing through a row model.** A key/value editor that stores values as
`string` cannot round-trip a number, a boolean or a null. Measured by execution
in §7 D5: **0 of 7** round-trippable documents survive.

**F. A fabricated document on the reader's side.** `.unwrap_or_default()` on a
`from_str` turns "this column is corrupt" into "this column is empty", and the
caller cannot tell. When the fabricated value is then **written back**, the
user's data is destroyed — §7 D1.

**G. Error copy that describes a behaviour the code does not have.**
`TestTab.tsx:328` renders *"Payload is not valid JSON — it will be sent as a raw
string."* The payload is **not** sent: `canFire` is false
(`TestTab.tsx:196-201`). The message is wrong in English and in all 13
translations.

---

## §6 Evidence — the site to copy

**`src/features/templates/sub_n8n/steps/upload/usePasteImport.ts:20-62`.**

It is the only JSON-authoring surface in the repo that gets all four moves
right in one place:

- `:22-24` — a size ceiling **before** the parse (`MAX_PASTE_LENGTH`, 5 MB), with
  its own tagged error. A paste is not typed; the parse is not the first bound.
- `:27-29` — one parse, and the failure produces a *tagged* outcome
  (`{ kind: 'error', message }`), not a boolean and not a thrown value.
- `:31-40` — validation **past syntax**: `countElements` and
  `detectPlatformLabel` reject a document that parses and is not a workflow. This
  is the "schema hints" half of the leaf, and it exists exactly once.
- `:49-57` — debounced above 50 KB, immediate below. The cheap checks never wait.
- `:59-62` — the submit reads the same tag (`pastePreview?.kind !== 'valid'`),
  the button reads it too (`N8nUploadStep.tsx:208`), and what is sent is
  `pasteText.trim()` — **the user's text**, not a re-stringify.

Supporting exemplars, each for one move:

- **Gate stated twice, with the incident named.** `TestTab.tsx:190-208`.
- **Reconstruction rather than assertion.** `n8nTypes.ts:60-92` —
  `normalizeDraftFromUnknown` returns `null` for a document missing
  `system_prompt`, and rebuilds every other field through `asNullableString` /
  `asNullableNumber` / `filterValid*`.
- **Refusing to collapse a lossy representation.** `KeyValueEditor.tsx:106` —
  `canSwitchToSimple` disables the Simple toggle when the document cannot be
  expressed as flat rows. The guard is right; §7 D5 is about what happens once
  you are already in Simple.

---

## §7 Deviations — where this repo breaks it today

### The twelve JSON-authoring surfaces

Enumerated by two independent instruments and reconciled by hand: (a) a co-location
pass over 4,465 `.ts`/`.tsx` files for `<textarea>`-or-`<JsonEditor>` **and**
`JSON.parse` in the same file → 15 candidate files; (b) a depth-tracked JSX
open-tag scan of all 2,083 `.tsx` for `<textarea>` tags carrying `typo-code` or
`font-mono` → **31 of 129 textareas**. The union, read by hand, yields **12
surfaces whose entire control content is a JSON document**. The other 19
monospace textareas hold SQL, prompts, CLI args, PEM blocks and free prose.

| # | Surface | Validates | Invalid document is… | Parsed value is |
|---|---|---|---|---|
| 1 | `editors/JsonEditor.tsx:226` (primitive) | on change | shown as a badge; **emitted anyway** | discarded |
| 2 | `forms/KeyValueEditor.tsx:157` | via #1 | forwarded to the parent as a string | `Record<string,string>` (lossy, D5) |
| 3 | `sub_executions/.../PersonaRunner.tsx:92` | at execute | **blocks** (`useRunnerExecution.ts:55`) | `{}` — see D6 |
| 4 | `sub_lab/use-cases/UseCaseExecutionPanel.tsx:73` | at execute | **blocks** | `{}` |
| 5 | `templates/draft-editor/DraftJsonTab.tsx:92` | on change | **blocks** confirm (`navigationReducer.ts:31`) | `N8nPersonaDraft` via reconstruction ✅ |
| 6 | `triggers/sub_test/TestTab.tsx:308` | in render | **blocks** fire | re-parsed, re-stringified |
| 7 | `sub_tool_runner/ToolInvocationCard.tsx:126` | in render | **blocks** run | re-parsed |
| 8 | `sub_n8n/.../N8nUploadStep.tsx:203` | on change (debounced) | **blocks** import ✅ | text re-sent ✅ |
| 9 | `sub_deployment/.../ApiPlayground.tsx:150` | at send | **sent as a raw string** | `any` |
| 10 | `vault/shared/playground/tabs/McpToolInputForm.tsx:56` | at execute | **sent as a raw string** (`McpToolsTab.tsx:53`) | `unknown` |
| 11 | `vault/shared/playground/RequestBuilder.tsx:125` | **never** | sent as the HTTP body | — |
| 12 | `sub_connectors/.../AutomationConditionStep.tsx:146` | **never** | **stored**, then substituted server-side | — |

**5 of 12 block the write. 2 send the string. 2 store or transmit with no parse
on the path at all. 1 is the primitive, which blocks nothing by construction.**

---

**D1 — P0. A corrupt MCP config file is replaced by `{}` and written back over
the user's file.** `src-tauri/src/mcp_server/install.rs:85-110`. The installer
reads the target client's `claude_desktop_config.json`, and if it fails to parse —
a trailing comma, a half-written file, a disk hiccup — `serde_json::from_str(&content).unwrap_or(serde_json::json!({}))`
yields an empty object. The personas entry is inserted into that empty object and
`std::fs::write(&config_path, json)` overwrites the file at `:109`. **Every other
MCP server the user had registered is gone**, with no error, no prompt and no
backup. There is no read-modify-write guard and nothing distinguishes "the file
was absent" (`:87`, correct) from "the file was unreadable" (`:86`, destructive).
*Fix:* refuse — `from_str(...).map_err(...)?` — and tell the user their config is
unparseable. **Deferred (destructive; touches a file outside the app):**
[`golden-path-deferred-fixes.md` #48](../golden-path-deferred-fixes.md).

**D2 — P0. A JSON "input schema" is authored, stored and never once parsed;
the backend fabricates a substitute.** The chain, all four links measured:
`AutomationConditionStep.tsx:146` (textarea, no parse) →
`useAutomationSetup.ts:205` (`input_schema: inputSchema.trim() || null`, no
parse) → `core/src/models/automation.rs:216,244,271` (`Option<String>` three
times) → `commands/tools/automations.rs:26-60`, where a non-object or
unparseable schema falls to `_ => r#"{"test": true}"#` and **that** is posted to
the user's external automation. The user sees a successful test fire carrying a
payload they did not write. There is also a type hazard on the read path:
`useAutomationSetup.ts:179` does `setInputSchema(design.result.input_schema || '')`
into a `useState('')`, and the deploy call needs
`mergedDesign as Parameters<typeof deployAutomation>[0]['designResult']` (`:216`)
to compile. *Fix:* parse in the change handler, gate Deploy on the tag, and make
the Rust side return a `Validation` error rather than a substitute.

**D3 — P1. Editing any form tab silently destroys unsaved raw-JSON text.**
`useWizardReducer.ts:75-77`: `draftUpdated` sets
`draftJson: JSON.stringify(draft, null, 2)`. Every identity/prompt/settings edit
in `DraftEditStep` calls it. So a user who breaks the JSON in the raw tab,
switches to Identity to check a field, and types one character has their
in-progress document overwritten with no prompt. The reducer's *other* arm is
careful in the opposite direction — `draftJsonEdited` keeps `draft ?? prev.draft`
(`:80`), so the last good draft survives a broken document — which shows the
asymmetry was not considered rather than chosen. *Fix:* make the sync one-way
while `draftJsonError !== null`, or prompt.

**D4 — P1. The SQL editor is the JSON editor for the connector playground.**
`RequestBuilder.tsx:125-131` renders `SqlEditor` with `language="json"` for
`POST`/`PUT`/`PATCH` bodies. `SqlEditor.tsx` has **no validation, no error
surface and no `Format`** — it is a highlighter with a textarea under it. The
request body ships whatever the user typed. *Fix:* `JsonEditor`, whose two
existing call sites are the same shape.

**D5 — P1. The key/value escape hatch cannot round-trip a single non-string
value. Executed, not read.** `KeyValueEditor.tsx:19-44` transcribed statement for
statement and replayed over nine documents:

```
{"max_results": 5}          -> { "max_results": "5" }            CHANGED
{"dry_run": true}           -> { "dry_run": "true" }             CHANGED
{"ratio": 0.5}              -> { "ratio": "0.5" }                CHANGED
{"note": null}              -> { "note": "" }                    CHANGED
{"id": 9007199254740993}    -> { "id": "9007199254740992" }      CHANGED  ← and off by one
{"count": 5, "label":"five"}-> { "count": "5", "label": "five" } CHANGED
{"b": 1, "a": 2}            -> { "b": "1", "a": "2" }            CHANGED
{"nested": {"a": 1}}        -> bails to the raw editor           (correct)
{"list": [1,2]}             -> bails to the raw editor           (correct)
```

**faithful 0 · changed 7 · correctly bailed 2.** The trip only fires once the
user edits a row (`syncToJson` is the only emitter), which is why it has never
been reported — but any user who opens Simple mode on a numeric payload and
touches one field converts every value to a string, and `9007199254740993`
additionally loses precision through `String(Number)`. Key order survives
insertion order and is therefore accidental, not guaranteed. *Fix:* keep the
parsed value beside the rows and re-emit types from it, or type the rows
`{ key: string; value: string; kind: 'string'|'number'|'boolean'|'null' }`.

**D6 — P2. The parsed payload is typed `{}` on the two execute paths.**
`useRunnerExecution.ts:52-56`: `let parsedInput = {}` then
`parsedInput = JSON.parse(inputData)`. `JSON.parse` returns `any`, the binding's
inferred type is `{}`, and `executePersona(personaId, parsedInput)` accepts it.
Nothing downstream can be wrong about a `{}`, which is the problem. *Fix:*
`unknown` at the parse and a reconstruction before the call.

**D7 — P2. Error copy contradicts the code, in 14 languages.**
`t.triggers.test_payload_invalid_json` = *"Payload is not valid JSON — it will be
sent as a raw string."* Nothing is sent (`TestTab.tsx:201`). Correcting it means
re-translating one key across 13 locales through the `translate-extract` →
subagent → `translate-merge` pipeline. **Deferred (changes a live surface and
requires the i18n gate):**
[`golden-path-deferred-fixes.md` #49](../golden-path-deferred-fixes.md).

**D8 — P2. Hardcoded English inside the raw editors.** `DraftJsonTab.tsx:30`
(*"JSON does not match expected persona draft shape."*), `:36` (*"Invalid JSON
syntax."*), `:78` (*"Copied"* / *"Copy"*). `usePasteImport.ts:23,29,33` (three
more). `McpToolInputForm.tsx:59` (`` `Enter JSON ${propType}...` ``). **Nine
strings.** Note which lint rule sees them: `custom/no-hardcoded-jsx-text` is
warn-level and only visits JSX text, so **6 of the 9 — the ones inside handlers
and template literals — are invisible to it entirely**, and the other 3 are
warnings under a gate that runs `eslint src/` with no `--max-warnings`
([doctrine §3](../golden-path-doctrine.md#3-the-severity-fact)).

**D9 — P3. Six JSON syntax highlighters, three of them in editors.** Enumerated:
`JsonEditor.tokenizeJson` (hand-written scanner, `:15-105`);
`sqlTokenizers.tokenize(_, 'json')` (`:238`); `DraftJsonTab` via `highlight.js`;
`HighlightedJsonBlock` via `highlight.js`;
`triggers/sub_live_stream/HighlightedJson` (hand-written);
`overview/sub_events/HighlightedJson` (a regex colourizer). Three *editors*
(`JsonEditor`, `DraftJsonTab`, `SqlEditor`) independently re-implement the same
transparent-textarea-over-`aria-hidden`-`<pre>` overlay, including the
scroll-sync `useCallback`, which is byte-similar in all three. Only one of the
three validates. *Fix:* one editor; the viewers can stay separate.

**D10 — P1, and the general form of D1/D2. 55 Rust readers fabricate a document
on parse failure.** `serde_json::from_str(…)` immediately followed by
`.unwrap_or_default()` or `.unwrap_or(…)`: **55 matches across 42 of 963 `.rs`
files**, 0 of them inside `#[cfg(test)]`. Against **147 matches / 94 files** that
propagate (`?` or `.map_err(`) and 17 that degrade *with* a `tracing::warn!` in
the fallback arm. Hand-opened sample of 6: `mcp_server/install.rs:86` (D1,
destroys the user's file), `companion/jobs/mod.rs:468` (a job's `params_json`
becomes `{}` and the handler runs with no parameters),
`design/template_adopt.rs:1980` (the base IR becomes `Null`, so
`base_system_prompt` becomes `""` and the model is asked to refine an empty
prompt), `resources/automation_suggestions.rs:114` (evidence silently empty) —
**4 defects, 2 defensible**: `core/src/models/persona.rs:676` and
`engine/webhook_notifier.rs:388` both carry a written rationale at the fallback,
and `webhook_notifier` falls back to the *original string*, which loses nothing.
Ratcheted by §9.

---

## §8 Gaps — what the primitives genuinely cannot do

1. **`JSON.parse` cannot report a position.** `SyntaxError.message` in V8 gives
   *"Unexpected token } in JSON at position 41"* — a byte offset the editor never
   converts to a line/column and never uses to place a marker. `JsonEditor.tsx:184`
   renders the raw message in a `max-w-[280px] truncate` span, so on a long
   message the offset is the part that gets cut. Fixing this needs a parser that
   returns a range (`jsonc-parser`, `json-source-map`); the repo has **no JSON
   parsing dependency at all** — verified against `package.json`.
2. **No editor primitive in the tree can show a schema.** The leaf asks for
   "schema hints"; the closest thing that exists is
   `ToolInvocationCard.buildDefaultInput` (`:250-263`), which reads
   `schema.properties` and emits a skeleton of empty strings. It does not
   surface types, requiredness or descriptions, and it silently produces `{}` if
   the schema itself does not parse. Two surfaces have a schema available and
   neither renders it.
3. **No type reaches inside a `TEXT` column** — [doctrine §1, item 5]. The
   `input_schema` value crosses `TS string → IPC JSON → Rust String → SQLite
   TEXT` and back. This is why D2 cannot be closed by a newtype at any single
   layer and why §9's rule sits at the reader.
4. **How many stored documents are actually corrupt is unmeasurable.** It would
   be a `SELECT` over `persona_automations.input_schema` and its siblings — and
   the 2026-08-17 purge deleted every persona and its cascade. The pre-purge
   backup (`%APPDATA%\com.personas.desktop\purge-backup-2026-08-17\personas.db`)
   holds the rows, but this leaf's population there is small enough that a count
   would be a curiosity, not evidence. **Stated so a later reader does not
   mistake the absence of a number for a zero.**
5. **The census cannot see the *absence* of a parse.** D2's defect is that
   nothing calls anything — the shape doctrine §1 item 4 names. §9 ratchets the
   reader's fabrication because that is the part that exists; the missing
   validation is found only by inventorying the JSON-authoring surfaces, which
   is what §7's table is.

---

## §9 The missing gate

### Published rule: `fabricated-json-on-parse-failure`

**The condition it is a proxy for, stack-free:** *a stored or received document
that fails to parse is replaced, on the spot and without telling anyone, by a
document the program invented — so "corrupt" and "empty" arrive at every
downstream reader as the same value, and no later code can recover the
distinction.* An adopting repo must re-derive its own proxy: in TypeScript this
wears `JSON.parse` inside a `try` whose `catch` returns `{}`/`[]`; in Python a
`json.loads` inside `except: return {}`; this Rust pattern scores zero on both.

```json
{
  "id": "fabricated-json-on-parse-failure",
  "goldenPath": "docs/concepts/golden-paths/raw-json-editor.md",
  "title": "An unparseable stored JSON document is silently replaced by a fabricated one",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "serde_json::from_str(?:::<[^>]{0,120}>)?\\s*\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\)){0,240}\\)\\s*\\.\\s*(?:unwrap_or_default\\s*\\(\\s*\\)|unwrap_or\\s*\\()",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "serde_json::from_str(...) immediately followed by .unwrap_or_default() or .unwrap_or(<expr>) — the SILENT substitutions only. .unwrap_or_else is deliberately NOT matched, because 17 of this repo's 29 unwrap_or_else arms emit tracing::warn! in the closure and are a legitimate announced degradation; the 12 that do not are a KNOWN, DELIBERATE recall miss, traded to keep precision on the stated condition at 55/55. PROXY FOR the stack-free condition: 'the document is corrupt' and 'the document is empty' reach every downstream reader as the same value. MEASURED 2026-08-17 at master: 55 matches / 42 files, against 640 serde_json::from_str call sites in 963 .rs files (8.6%) and 147 matches / 94 files for the compliant control (propagate with ? or .map_err). 0 of the 55 are inside #[cfg(test)] — verified with a brace-matched stripCfgTest pass, so no exclude is needed and none is declared. WHAT THE MATCH COSTS, hand-opened: mcp_server/install.rs:86 replaces an unparseable claude_desktop_config.json with {} and then WRITES THE RESULT BACK over the user's file (install.rs:109), destroying every other registered MCP server, with no error and no backup; companion/jobs/mod.rs:468 turns a job's params_json into {} and dispatches the handler with no parameters; design/template_adopt.rs:1980 turns the base IR into Value::Null so base_system_prompt becomes \"\" and the model is asked to refine an empty prompt; resources/automation_suggestions.rs:114 silently empties the evidence list a reviewer reads. PRECISION on the stated condition is 55/55 (every match hand-read). PRECISION on 'this is a defect' is lower and is stated honestly: 4 of 6 in the hand-opened sample. The 2 defensible ones are LISTED ON PURPOSE — core/src/models/persona.rs:676 (the column is documented advisory at :672-674) and engine/webhook_notifier.rs:388 (falls back to the ORIGINAL string, losing nothing) — because separating them needs knowledge of what the column means, which no matcher has. THE PAREN WINDOW MUST NEST TWO DEEP: from_str(&r.get::<_, String>(2)?) is a real argument shape in this tree (bench/athena_validate.rs:56) and a flat [^()]{0,240} misses it. CONVERGENCE, measured the same day: brainiac has 46 serde_json::from_str sites across 7 crates and ZERO matches for this pattern — the same author's other Rust codebase propagates every one; vibeman has exactly 1. That is an INVERSION, not agreement, and it is the strongest evidence in this document that the practice is wrong rather than merely untidy. LEGAL DESTINATIONS the pattern leaves unmatched by construction: (1) propagate — `?` or `.map_err(AppError::from)?`; (2) degrade OUT LOUD — .unwrap_or_else(|e| { tracing::warn!(error = %e, \"...\"); default }), which db/src/repos/resources/triggers.rs:658,866 and engine/src/optimizer.rs:159 already do; (3) .ok() into an Option, which keeps 'we did not get it' representable. CORRECT END STATE is not zero — some columns are genuinely advisory — so this rule RATCHETS; it must not be deleted at 0."
  },
  "baseline": { "files": 42, "matches": 55 },
  "floor": 500
}
```

### Positive control (no baseline — the merger skips controls)

```json
{
  "id": "fabricated-json-on-parse-failure-positive-control",
  "goldenPath": "docs/concepts/golden-paths/raw-json-editor.md",
  "title": "COMPLIANT: the parse failure is propagated to the caller",
  "roots": ["src-tauri"],
  "extensions": [".rs"],
  "signal": {
    "pattern": "serde_json::from_str(?:::<[^>]{0,120}>)?\\s*\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\)){0,240}\\)\\s*(?:\\?|\\.\\s*map_err\\s*\\()",
    "flags": "g",
    "ignoreCommentLines": true,
    "description": "The SAME anchor (serde_json::from_str with the same two-deep paren window) pointed at the compliant form: the Result is propagated with ? or converted with .map_err. Measured 2026-08-17: 147 matches / 94 files, against the violating rule's 55 / 42. It does NOT partition the anchor and this is stated rather than hidden: 640 from_str sites total, 55 fabricate, 147 propagate, and the remaining 438 do something the two patterns do not name — `match`, `if let Ok`, `.ok()`, or a direct bind in a function that already returns Result. A control at 147 against a violation at 55 is a 2.7x separation on the same anchor, which is what establishes that the violating pattern discriminates on substitution rather than on the mere presence of from_str."
  },
  "floor": 500
}
```

### Validation performed

- Written to a **composer-private registry** with a filename unique to this
  composer (`wB-private-rules.json`) and run with
  `node scripts/census/run-census.mjs --rules <private>`. **The full registry was
  not run**, per the doctrine.
- **Two implementations of the baseline.** The census engine reports 55 / 42. An
  independent scanner that re-implements the engine's `ignoreCommentLines`
  semantics and additionally brace-matches `#[cfg(test)]` reports **55 / 42, 0 in
  test modules** — agreement, and the second implementation answers a question
  the first cannot (whether an exclude is needed; it is not).
- A **third, differently-shaped** implementation (balanced-paren consume of the
  call, then classify what follows) reported **84** `.unwrap_or*` continuations
  of which **17 announce** via `tracing::warn!` — so 84 − 55 = 29 are
  `unwrap_or_else`, 17 announced and 12 silent. The three numbers reconcile
  exactly, and the reconciliation is what establishes the 12 silent
  `unwrap_or_else` sites as a *known* recall miss rather than an unknown one.
- **Re-extracted from this finished document** and re-run: `census-private-exit=0`,
  baselines identical.
- **Site-level overlap against the FINAL patterns**, not drafts: `roots:
  ["src-tauri"]` / `.rs` shares no file with `asserted-definition-blob`
  (`src`, `.ts`/`.tsx`), `read-failure-as-empty-value` (`src`, `.ts`/`.tsx`) or
  `stringify-decided-equality` (`src`, `.ts`/`.tsx`) — **zero file overlap by
  construction, therefore zero site overlap.** Against the Rust-rooted rules that
  do share files: `untyped-command-payload` keys on a `#[tauri::command]` return
  type and `row-to-struct-mapping`'s neighbours key on `row.get`; neither
  produces a match at any of the 55 offsets (checked by comparing match offsets,
  not filenames).

### Rules checked and NOT adopted, with the numbers that refused them

- **`discarded-json-parse`** (a `JSON.parse` whose result is an expression
  statement). **7 production sites**, all inside a `try`. Refused on precision
  *against the leaf's law*: 5 of the 7 are correct — a render-time validity probe
  whose second parse happens in the same commit cannot disagree with it. A gate
  that fires on 5 correct sites out of 7 is worse than no gate.
- **`unguarded-json-parse`** (a `JSON.parse` not lexically inside a `try` block).
  **19 sites in 6 files**, out of 289 production call sites — a clean 93.4%
  compliance and a perfect partition (270 + 19 = 289). Refused because **17 of
  the 19 are in backend-response adapters**
  (`sub_llm_overview/llmTracingAdapters.ts`, `sub_overview/adapters.ts`,
  `lib/harness/*`), not in editors — the condition is real and belongs to
  [json-blob-column](./json-blob-column.md) or
  [row-to-struct-mapping](./row-to-struct-mapping.md), not here. Recorded so the
  next composer on those leaves does not have to re-derive it. The two that *are*
  render-path — `fleet/monitor/channels/DeliberationRail.tsx:42,45`, two
  `JSON.parse` calls in a component body with no boundary above them — are a real
  crash risk and are handed to whichever path owns that surface.
- **`monospace-textarea-without-a-parser`.** Refused on precision by
  measurement: **31 monospace textareas, of which 12 are JSON** — a name/shape
  signal would fire on 19 SQL, prompt, args and PEM controls, i.e. **39%
  precision**.

---

## §10 Convergence — what the fleet does

Cohort established for this leaf at the time of measurement, per the doctrine:
**`personas-web` (Next.js), `brainiac` (Rust), `personas-cloud`, `vibeman`,
`ascent`.** Lineage was checked: nothing in this leaf's evidence is a port.

**On the frontend half the fleet is silent, and the silence is total.** No repo
in the cohort has a JSON-editing dependency — no CodeMirror, no Monaco, no
`@uiw/react-json-view`, no `jsoneditor`, in any `package.json`. `personas-web`
contains **2 files with a `<textarea>` at all**, and neither is a JSON editor.
Per the doctrine a silence stays strong: **Personas is the only repo in the
cohort with this problem, and it has solved it three times, differently, by
hand.** That is not the fleet endorsing the hand-roll; it is the fleet never
having needed one.

**On the backend half the oracle inverts, and this is the strongest evidence in
the document.** `brainiac` — same author, same language, 7 crates — has **46
`serde_json::from_str` call sites and zero** that fabricate on failure. It has
187 `unwrap_or*` calls, so the construct is not foreign to it; it is simply never
reached for after a parse. `vibeman`, this repo's **ancestor** (dated on two
independent leaves), has exactly **1**. Personas has **55**.

Per doctrine §5: agreement is the weakest signal the oracle produces and
inversion is the strongest. This is an inversion. One engineer, writing Rust in
two codebases, propagates the parse error in one and substitutes a fabricated
document in the other 55 times — and the difference between the two is that
`brainiac`'s call sites live in functions that already return `Result` while this
repo's live in row-mapping closures and `unwrap`-shaped helper methods. **The
practice is a consequence of where the parse was put, not of a judgement anyone
made.** That is exactly the case §9's ratchet is for.

**Not measured:** whether any sibling has a *structured form with a raw escape
hatch*. `personas-web`'s two textareas rule it out there; the other three were
not swept for it, and that gap is stated rather than filled with a guess.

---

## §11 Interaction with adjacent paths

Per contract §"Check your prescription against your neighbours'":

- **[untrusted-definition-validation](./untrusted-definition-validation.md)** —
  compatible and reinforcing. Its §2 (*"reconstruct the definition; never pass
  the parsed object through"*) is §2's last clause here. Its rule
  `asserted-definition-blob` keys on `JSON.parse(x.y) as T`; §7 #5 is the one
  surface in this leaf that already complies (`normalizeDraftFromUnknown`).
- **[version-diff-view](./version-diff-view.md)** — its rule
  `stringify-decided-equality` (5 files / 6 matches) covers `JSON.stringify`
  used to decide equality. **The brief predicted a JSON editor would do this for
  its dirty check. Checked at site level: none of the 12 surfaces does.** No
  overlap, and the prediction is corrected in §12.
- **[entity-draft-editing](./entity-draft-editing.md)** — a tension worth naming.
  Its §2 says *send the diff, never the draft*. A raw JSON editor's whole
  premise is that the user authors the **document**, so the diff is between two
  parsed values, not two form states. Where both apply (§7 #5, the persona draft
  editor), follow this path for the *editor* and that path for the *write*: diff
  the reconstructed draft against the baseline, not the JSON text.
- **[debounced-autosave](./debounced-autosave.md)** — do **not** autosave a raw
  JSON editor. An autosave that fires between two keystrokes writes a document
  that is invalid by construction. If a surface needs both, the debounce must be
  gated on `outcome.kind === 'valid'`, and that clause is not in that path
  because that path is not about documents.
- **[swallowed-error-telemetry](./swallowed-error-telemetry.md)** — §9's rule and
  its `bindingless-catch-on-io` are disjoint by language, and the legal
  destination they share is the same: if you degrade, say so where a machine can
  read it.

---

## §12 Corrections owed

### 12.1 To this composer's brief — the `JSON.stringify` dirty check does not exist here

The brief said: *"a dirty check via `JSON.stringify` is wrong whenever key order
can differ — establish whether this repo's editor does that."* **Established:
it does not.** Checked at site level against the final `stringify-decided-equality`
pattern across all 12 JSON-authoring surfaces: **zero matches**. The editors are
uncontrolled-text-in-state, so "dirty" is `text !== initialText`, a string
compare that is *correct* for this job — it is precisely the user's formatting
that must be preserved, so a formatting-only change *is* a change. The seam the
brief pointed at is clean, and it is clean for a reason worth recording rather
than a lucky one.

### 12.2 To this composer's brief — the five predicted defects, scored

The brief predicted five, "predictable enough to check one by one". Measured:

| brief's prediction | verdict |
|---|---|
| validates on change or on save | **Both, and the split is 5 on change / 4 at save / 3 never** (§7 table) — the interesting cell is the third, which the brief did not anticipate |
| does an invalid document block the save | **5 of 12 block, 2 send the string, 2 store it, 1 is the primitive** |
| is the parsed result typed or `any` | **Confirmed**, and the worst form is neither: `let parsedInput = {}` at `useRunnerExecution.ts:52` gives the binding type `{}`, which is quieter than `any` and no safer |
| does it round-trip | **Confirmed and executed** — 0 of 7 survive `KeyValueEditor` (D5) |
| does saving raw JSON bypass the form's validation | **Inverted.** The predicted shape — a raw tab that skips the form's checks — does not occur, because **no JSON-authoring surface in this repo has a structured form with checks to bypass.** `KeyValueEditor`'s Simple mode validates nothing except duplicate keys; `DraftJsonTab`'s sibling tabs validate nothing. The real defect is one layer down and worse: **there is no validation on either path** (D2), so there is nothing to bypass |

The brief's `validate_all()` precedent (the trigger fix) is a *good* analogue for
the fix and a *wrong* analogue for the diagnosis: that defect was two doors with
different checks. This one is twelve doors, of which several have no check at all.

### 12.3 To the spine — `convergence: "diverged"` **holds**, and it is the first
### time this label has been tested

The spine's `convergence` field has failed thirteen consecutive tests
([doctrine §5](../golden-path-doctrine.md)), all of them on the value
`"converged"`. This leaf carries `"diverged"` and **the label is correct on both
halves, for two different reasons** — and the two reasons are why a single enum
is nearly always the wrong shape:

- *Within* this repo the answer genuinely diverged: three editor implementations,
  six highlighters, twelve surfaces with five different answers to "what happens
  to an invalid document".
- *Across* the fleet there is nothing to diverge from — 4 of 5 siblings have no
  raw JSON editor at all.

So the label is right by accident of aggregation: it describes the intra-repo
picture and would have been `"silent"` for the inter-repo one. Recorded as a
narrow upholding, not a vindication of the field.

`sides: "client"` is **incomplete, not inverted.** The frontend half is real and
carries 9 of the 10 deviations. But the leaf's published rule, its most severe
finding (D1), and its convergence inversion are all **server-side Rust** — which
is the seventh time a `"client"` label has been contradicted. The correction here
is *"and also the server"*, not *"actually the server"*; §7 D2 is a single defect
whose four links alternate sides, which is the reason the field cannot hold it.

### 12.4 To `CLAUDE.md` / the shared catalog — no correction owed, and why that is worth saying

`CATALOG.md:79` describes `JsonEditor` as *"JSON editing/validation editor."*
That is accurate — it does validate. The catalog does **not** claim it is the
mandated JSON editor, does not list `SqlEditor`, and does not mention
`KeyValueEditor`'s advanced mode. Checked because two prior paths found catalog
entries describing components that do not exist or do nothing
(`feedback/EmptyState`, `LoadingSpinner`). This one is clean. A negative result
on a check the corpus has learned to run is worth one line.

### 12.5 A disagreement between this composer's own two implementations, and how it resolved

The first Rust pass reported **82** `from_str(...).unwrap_or*` sites; the second
reported **84**. Neither was wrong: the first applied `stripCfgTest` and the
second did not, and the difference is exactly **2 sites inside `#[cfg(test)]`
modules**. The published rule sits at 55 because it excludes `unwrap_or_else`
entirely, and a third pass confirmed 0 of those 55 are in test modules — so the
82/84 discrepancy never touched the baseline. **It is recorded because it would
have, had the rule matched `unwrap_or_else`**: the census engine has no
`#[cfg(test)]` stripping, so a rule that did match would have baselined two test
fixtures as production violations and nobody downstream could have seen it.
