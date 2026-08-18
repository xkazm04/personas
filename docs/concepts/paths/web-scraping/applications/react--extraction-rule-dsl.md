---
layer: application
subject: web-scraping
technique: extraction-rule-dsl
stack: react
---

# React application: the field-rule DSL held flat, serialized at the edges

**Where:** `src/features/scraper/useScrapeForm.ts` (the form spine), consumed by
`EditorSteps.tsx` / `FieldRuleRows.tsx` (editing), `EditorSteps.tsx:127`
(`fieldsToRuleSet` → preview), and `LlmRuleBuilder.tsx` → `setFieldsFromRuleSet`
(model-generated rules entering the same shape). Wire types come from
`@/api/scraper` (`ScrapeRule`, `ScrapeRuleSet`); the extraction engine is
`pumper_core::extract` behind `src-tauri/engine/src/scraper.rs`.

## The technique, realized

The wire form is a keyed object (`ScrapeRuleSet = { [field]: ScrapeRule }`) with
a per-kind discriminated union. The editor never touches it. Instead
`useScrapeForm.ts:13-23` declares the flat editable row:

```ts
export type RuleType = 'css' | 'regex' | 'json';
export interface RuleField {
  id: string; name: string; type: RuleType;
  selector: string; attr: string; all: boolean;   // css
  pattern: string; group: number;                  // regex
  pointer: string;                                 // json
}
```

Three locator kinds — structural selector (`css`), text pattern (`regex`),
structural pointer (`json`) — exactly the technique's taxonomy, and the kind is
an explicit per-row choice (`type`). The row is deliberately *denormalized*: it
carries every kind's parameters at once, so switching a row's `type` in the
editor loses nothing — a flat-form affordance a wire-shaped union cannot give.

The two edge conversions are single, named functions:

- `fieldsFromRuleSet` (`:51-54`) — wire → flat, on modal open;
- `fieldsToRuleSet` (`:62-68`) — flat → wire, called only by `toInput()` (save)
  and the preview step. `fieldToRule` (`:56-60`) narrows each row back to only
  its kind's parameters.

Everything between the edges — row editing (`updateField` patches by minted row
`id`, `:141-142`), the LLM builder's merge (`:144-151`), the summary chips
(`ruleSummary`, `:71-75`) — operates on `RuleField[]`. One in-memory shape,
serialization at exactly two doors: the technique's core discipline, verbatim,
and the file's own header comment states it as intent ("converted to/from the
wire `ScrapeRuleSet` at the edges").

## Where the application falls short of the technique (registered deviations)

- **No failure semantics.** `RuleField` has no required/optional/default
  member; a missed rule yields an empty value flagged only in the preview UI
  (`PreviewResults.tsx` "no match"). Nothing marks a field load-bearing, so
  the run layer cannot tell collapse from a sparse page — the gap cascades
  into the missing shape-change detection (see the subject's final report;
  run-status honesty is the `config_run` "ok — …" string in
  `src-tauri/engine/src/scraper.rs:578-587`).
- **Silent last-wins on duplicate names.** `fieldsToRuleSet` writes
  `out[f.name.trim()]` per row (`:62-68`); two rows named `price` collapse to
  the later one with no conflict surfaced, and unnamed rows are dropped
  without a trace. The technique wants fail-on-conflict or an explicit
  policy.
- **No validation door on the editor side.** `canSave` (`:154`) checks
  presence (name, dataset, URL, ≥1 named field) but never that a selector
  parses, a regex compiles, or a pointer is well-formed; the first
  syntax check happens in the engine's `rules.compile()` at preview/run
  time. Cardinality (`all`) exists only for the css kind.

## Transplant note

The pattern (denormalized flat row + two edge converters + minted row ids) is
framework-independent — any form layer can hold `RuleField[]` and any engine
can own the wire union. The part worth copying most is the *denormalized* row:
it is what makes kind-switching lossless in the editor.
