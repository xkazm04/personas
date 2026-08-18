---
layer: application
subject: schema-driven-ui
technique: spec-validation-and-repair
stack: react
---

# SurfaceSpec — the repo's one validation door, with honest repair

The SurfaceSpec pipeline is the repo's cleanest realization of the technique:
`src/features/shared/components/surface/surfaceSpec.ts` (a deliberately pure
module — "no React, no store, no IPC", `:11`) is the single door, and
`SurfaceRenderer.tsx` renders whatever survives, plus the disclosure.

## The door

`parseSurfaceSpec` (`surfaceSpec.ts:231-266`) is the whole pass:

1. **Strict parse first** — `surfaceSpecSchema.safeParse` (`:232-233`); a clean
   spec exits with `dropped: 0`.
2. **Envelope check** — `looksLikeSpec` (`:214-222`) requires the version
   marker (`surface: "v1"`, `SURFACE_VERSION` at `:189` — the version literal
   doubles as the detection marker) plus a `blocks` array. No envelope → 
   `{ ok: false, error: 'not a v1 surface envelope' }`, and callers fall back
   to the ordinary markdown/JSON views (SPEC.md "Where it lands") — invalid is
   never rendered as empty.
3. **Per-node salvage** — each block re-parsed individually against the
   discriminated union (`surfaceBlockSchema`, `:171-179`); valid blocks are
   kept, each failure increments `dropped` (`:242-246`). A hallucinated block
   type never takes down an otherwise sound surface.
4. **Caps counted into the ledger** — the 12-block cap is enforced by
   `slice(0, 12)` and the overflow is *added to `dropped`*
   (`:242`, `:247`), so truncation is disclosed exactly like invalidity.
5. **Minimal-drop retry** — a bad `title`/`summary` retries with them
   stripped rather than failing the envelope (`:259-264`).
6. **Nothing survived** → `{ ok: false, error: 'no valid blocks survived
   repair' }` (`:249-251`) — failure spelled as failure, distinct from a
   valid-but-empty document (which the schema forbids anyway, `min(1)` at
   `:195`).

## The normalization tier, per field

The schema builders at `:32-57` are the "forgiving in, bounded out" tier:
`text(max)` coerces numbers/booleans to strings, refuses empty, and truncates
at the cap; `optionalText` folds null/absent/blank into one "not given";
`percent` coerces numeric strings and **clamps to 0–100 instead of
rejecting** (`:52-55`). Every cap is declared next to the field (`label:
text(40)`, `rows ≤ 200`, `blocks ≤ 12`) — deterministic transforms toward the
contract, never guesses. There is no misspelled-kind correction anywhere.

## The disclosure

`SurfaceRenderer` receives `dropped` and renders the line only when nonzero
(`SurfaceRenderer.tsx:122-126`): a calm caption
(`data-testid="surface-dropped-note"`), text from the translated
`dropped_blocks` key with the count interpolated — "N blocks left out". The
prop is documented as "Blocks removed by the repair pass — surfaced honestly,
never hidden" (`:51`).

## Where the door sits relative to structured-output

`extractSurfaceSpec` (`surfaceSpec.ts:299-324`) is the upstream extraction
half — finding the candidate inside raw execution output (whole JSON,
embedded `surface` key, or one NDJSON line) — which is structured-output's
territory; it funnels every candidate through the same `parseSurfaceSpec`
door. One door, enumerable writers: repo-wide, nothing constructs a rendered
surface except through these two exports (re-exported as the single import
site at `SurfaceRenderer.tsx:323`).

## Gaps against the standard (reported, standard kept)

- **The ledger is a count, not a ledger.** `dropped` is an integer; no
  per-drop reason, node identity, or kind is recorded, and nothing feeds
  telemetry — so the emitter-improvement loop the technique describes has no
  data here. The disclosure line is honest but the instrument behind it is
  minimal.
- **The cockpit sibling has no door at dispatch.** The other spec pipeline
  (`compose_cockpit` → `CockpitPanel`) stores widget specs without validating
  kinds at dispatch — registered under the `w4-prompt-assembly` deferred-fix
  anchor; `CockpitPanel.tsx:150-157` distinguishes a corrupt persisted spec
  from never-composed (parse-failure renders an error + retry, not the empty
  CTA), which is the render-side half of the discipline holding alone.
