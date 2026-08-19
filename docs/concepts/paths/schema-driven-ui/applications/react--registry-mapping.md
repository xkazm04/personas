---
layer: application
subject: schema-driven-ui
technique: registry-mapping
stack: react
---

# Two registries, two dispatch styles — cockpit widgets and SurfaceSpec blocks

The repo realizes kind→component mapping twice, in the two idiomatic styles,
and the pair is a working comparison of their trade-offs.

## Style 1: the record registry — `cockpitWidgetRegistry`

`src/features/home/sub_cockpit/widgetRegistry.ts:51-154` is a
`Record<string, ComponentType<CockpitWidgetProps>>` mapping ~30 widget kinds
(`persona_overview`, `metric_spark`, `verdict`, `flow_steps`,
`use_case_set`, …) onto one component each. Layout policy is registry-side
too: `cockpitRowSpan(kind)` (`:158-176`) assigns grid row spans per kind, so
the emitter never speaks geometry beyond a clamped `span`.

Dispatch is a lookup: `CockpitWidgetCell` (`CockpitPanel.tsx:446-480`)
resolves `cockpitWidgetRegistry[widget.kind]`; a miss renders a **per-node
error card naming the unknown kind** (`:468-474`,
`t.overview.cockpit.unknown_widget`) inside the widget's own grid slot — the
operator-facing placeholder variant the vocabulary technique carves out,
appropriate here because the cockpit viewer is the person steering the
composing agent. Spec-carried actions are **re-parsed at render**
(`parseWidgetActions`, `CockpitPanel.tsx:451-453` — "never trust a
stored/composed spec's raw shape") against an explicit enum
(`briefing/actions.ts:1-11`), and every execution lands in the
`companion_decisions` audit ledger.

Per-kind degraded states live with the components and are pinned by tests:
`widgets/__tests__/UseCaseSetWidget.test.tsx:6-9` asserts the empty-config
rendering; eleven sibling test files do the same for their kinds — config in,
surface out, the widget contract as executable spec.

**Gaps against the standard (reported, standard kept):**

- `CockpitWidgetProps.config` is `Record<string, unknown>`
  (`widgetRegistry.ts:44-49`) — the registry carries **no per-kind config
  validator**, so each widget self-defends. The validation door cannot
  enforce per-kind contracts it doesn't hold.
- Kinds are **not validated at dispatch** (`dispatcher.rs:1492-1523`) and the
  emitter's vocabulary lives as hand-written doctrine in the constitution
  template rather than being generated from this registry — the registry
  header itself instructs "update the doctrine … so Athena knows"
  (`widgetRegistry.ts:8-10`): two hand-maintained copies of one vocabulary.
  Both registered under the `w4-prompt-assembly` anchor in
  `golden-path-deferred-fixes.md`; cited here, not re-registered.

## Style 2: the exhaustive switch — `SurfaceBlockView`

`SurfaceRenderer.tsx:165-280` dispatches the seven SurfaceSpec block kinds
through a `switch` on a zod discriminated union, each case mapping onto one
blessed catalog primitive — `stat_row`→`StatCard` grid, `table`→`UnifiedTable`,
`decisions`→`DecisionRow`, `markdown`→`MarkdownRenderer`,
`gauge`→`ConfidenceArc`, `progress`→`StatCard`+mini-bar,
`terminal`→`CliOutputPanel`. The header comment states the closure rule: "The
switch below is the ENTIRE vocabulary … no new visual primitives, no
arbitrary HTML" (`:5-7`). The `default` arm is a compile-time exhaustiveness
guard (`const _never: never = block`, `:272-278`) — an unknown kind here is
unreachable *because the validation door already dropped it*, which is the
correct division of labor: the door owns unknown kinds, the dispatcher owns
known ones, and the type system proves the set is covered.

Config validation is registry-side in this style: each kind's schema sits
beside its literal in `surfaceSpec.ts:90-179`, so "add a block type" = one
schema + one case + one row in the emitter doc (`surface/SPEC.md` block
table) — three edit sites, with the schema as the authority the other two
mirror.

## The comparison, distilled

The record registry scales to many kinds and keeps growth to one edit site,
but as implemented it holds no config contracts and its emitter docs are
hand-synced. The switch style carries typed config contracts and proven
exhaustiveness, but every addition edits the dispatcher itself and the
emitter doc is still a parallel artifact. The standard's target is the union:
record-style registration that *carries* the per-kind validator and the
emitter-facing description, so the door, the dispatch, and the generated
vocabulary docs all derive from one entry.
