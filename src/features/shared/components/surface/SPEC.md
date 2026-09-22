# SurfaceSpec v1 — how an agent emits UI instead of prose

> Companion doc to [`surfaceSpec.ts`](./surfaceSpec.ts) (the zod schema — the only source of
> truth) and [`SurfaceRenderer.tsx`](./SurfaceRenderer.tsx) (the renderer). Referenced from the
> shared-component catalog ([`../CATALOG.md`](../CATALOG.md)). The vocabulary is FROZEN to the
> blessed catalog: every block maps onto one existing component, no arbitrary HTML, no new
> primitives. Extending it means adding a block type here + a schema + one renderer case.

## Where it lands

A persona run whose `output_data` is (or embeds, under a top-level `"surface"` key, or carries on
one NDJSON line) a valid SurfaceSpec gets a **Surface** tab in the execution detail modal,
rendered live with the persona's theming and an "Agent-composed" provenance badge. Invalid specs
degrade gracefully: individually-broken blocks are dropped (with an honest "N blocks left out"
note); an unrecoverable spec falls back to the existing markdown/JSON views. Nothing ever
auto-runs — see Actions.

## Envelope

```json
{
  "surface": "v1",
  "title": "Dependency audit — 3 decisions need you",
  "summary": "12 packages scanned, 2 with known CVEs.",
  "blocks": [ /* 1–12 blocks, rendered in order */ ]
}
```

## Blocks

| `type` | Renders as | Fields |
| --- | --- | --- |
| `stat_row` | `StatCard` grid | `stats`: 1–8 × `{label, value, tone?, hint?, delta?{label, direction: up\|down\|flat}}`; `tone`: `neutral\|success\|warning\|danger\|info` |
| `table` | `UnifiedTable` (sortable) | `title?`, `columns`: 1–8 × `{key, label, align?}`, `rows`: ≤200 objects keyed by `key` (string/number/boolean/null cells) |
| `decisions` | `DecisionRow` list | `title?`, `items`: 1–50 × `{id, title, summary?, category?, facts?: ≤6 × {label, value}, actions?: ≤3 × Action}` |
| `markdown` | `MarkdownRenderer` | `content` (GFM) |
| `gauge` | `ConfidenceArc` | `label`, `value` (0–100, clamped), `hint?` |
| `progress` | `StatCard` + mini-bar | `label`, `value` (0–100 completion, clamped), `hint?` |
| `terminal` | `CliOutputPanel` | `title?`, `lines`: ≤500 strings |

Strings are coerced from primitives and truncated to their caps; out-of-range gauge/progress
values are clamped, not rejected. A block with an unknown `type` or an unsalvageable shape is
dropped; the surface renders if ≥1 block survives.

## Actions (consent-gated — the safety surface)

```json
{ "id": "retry-flaky", "label": "Retry failed suite", "tone": "accept",
  "kind": "dispatch", "prompt": "Re-run the flaky vitest suite and report…" }
```

- `kind: "dispatch"` — confirming opens **DispatchChooserModal** (dev runner / fleet / CLI) with
  the prompt editable; requires the host view to supply a project target, otherwise the button
  renders disabled with an explanatory tooltip.
- `kind: "execute_persona"` — confirming opens **ConfirmDialog** showing the prepared input, then
  re-invokes the persona (`persona_id` optional; defaults to the run's persona).
- `tone`: `accept | reject | neutral` — verdict color language from `DecisionActions`.

One action grammar, per the shared UX contract: explicit affordance → one click → confirm →
executes → recorded by the chosen transport. **Nothing runs on render.**

## Prompt fragment for persona authors

> When your findings are structured (metrics, lists to triage, logs), respond with a single JSON
> object matching SurfaceSpec v1: `{"surface":"v1","title":…,"blocks":[…]}` using only the block
> types `stat_row`, `table`, `decisions`, `markdown`, `gauge`, `progress`, `terminal`. Put prose
> in a `markdown` block. Propose work as `decisions` items with actions — the operator confirms
> every action. When output is purely narrative, respond with plain markdown instead.

## In markdown — the same blocks as tags (`editors/RichMarkdown`)

Where the app displays markdown someone or something AUTHORED (a KPI
description, a director review), the same vocabulary is available inline as
tags, using the CommonMark directive syntax. It is not a second format: each
block tag is read into the SurfaceSpec block of the same name, validated by the
same schema, rendered by the same renderer, and its actions go through the same
consent dialogs. Anything a surface can say, a document can say.

| Tag | Form | Body / attributes |
|---|---|---|
| `:::stats` | container | a ```json fence: an array of stats, or `{"stats": [...]}` |
| `:::table{title="..."}` | container | a ```json fence: `{"columns": [...], "rows": [...]}` |
| `:::decisions{title="..."}` | container | a ```json fence: an array of items, or `{"items": [...]}` |
| `:::terminal{title="..."}` | container | any fence; one output line per line |
| `::gauge{label="..." value=62 hint="..."}` | leaf | value 0-100 |
| `::progress{label="..." value=40 hint="..."}` | leaf | value 0-100 |

Plus the execution detail's content grammar (`components/content/`):

| Tag | Form | Renders |
|---|---|---|
| `:::card[Title]{tone=amber variant=framed}` ... `:::` | container | a content card; its body is markdown |
| `:::well` ... `:::` | container | the recessed well for machine text |
| `::eyebrow[Blockers]` | leaf | the tracked uppercase sub-heading |
| `:pill[stale]{tone=blue}` | inline | a state pill inside a sentence |

Tones: `primary`, `blue`, `amber`, `violet`, `emerald`, `red`, `neutral`.

Two rules the renderer keeps, so writing tags is never lossy:
- an **inline** tag it does not know is printed back literally (`status:ok`
  stays `status:ok`);
- a **block** tag it does not know, or whose body fails its schema, is shown as
  written with the reason beside it. Nothing is dropped.

```markdown
Coverage is the headline this week.

::gauge{label="Observed" value=13.8 hint="144 of 1,044 KPIs have a reading"}

:::card[Why this matters]{tone=amber}
Only :pill[3]{tone=red} of the 17 groups in *personas* have a single reading.
:::
```
