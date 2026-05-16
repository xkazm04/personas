# Glyph Consolidation — Persona Hero + Use-Case Grid

**Status:** Proposal / pre-implementation
**Author:** Claude (analysis run 2026-05-16)
**Decision owner:** kazimi66

## Premise

Five hand-rolled sigil renderers exist across the codebase. The build/scratch
flow uses a single 640px hero sigil that represents *one use case at a time*;
the adoption and view flows render *grids of per-use-case cards*. A persona-
level union sigil (`PersonaCrest`) already exists in view mode but is not used
during build.

The user request: unify these surfaces so future development always touches
one place, while letting each consumer parameterize for its mode (scratch
build, template adoption, saved-persona view). The **hero glyph represents
the persona** (one level up); **mini-sigils represent use cases / capabilities**;
both should live in one consolidated view.

## Sigil inventory (the actual count)

| # | Renderer | File | Size | Level | Used in |
|---|---|---|---|---|---|
| 1 | `GlyphHeroSigil` + `GlyphSigilCanvas` + `GlyphPetalIcons` | `src/features/agents/components/glyph/` | 640px | Use-case (active row) | Scratch build (`UnifiedBuildEntry`) |
| 2 | `InteractiveSigil` + `SigilPetal` | `src/features/shared/glyph/` | 440px (in card) | Use-case | Template adoption grid, gallery, template detail |
| 3 | `MiniSigil` (row-strip variant) | `src/features/agents/components/glyph/GlyphRowStrip.tsx` | 60px | Use-case (navigator) | Scratch build (side strip) |
| 4 | `MiniSigil` (tile variant, wedge/dot) | `src/features/agents/sub_use_cases/components/recipes-prototype/shared/MiniSigil.tsx` | 84–156px | Use-case | Saved-persona view (`RecipesVariantSigilGrid`) |
| 5 | `UnionSigil` (inside `PersonaCrest`) | `src/features/agents/sub_use_cases/components/recipes-prototype/shared/PersonaCrest.tsx` | 56–92px | **Persona** | Saved-persona view header |

All five draw the same 8-petal geometry around `PETAL_ANGLES`. All five consume
`DIM_META`. Five independent SVG bodies — that's the actual de-dup target.

## Capability matrix (what each layout does that others don't)

| Capability | Hero (scratch build) | GlyphGrid (adoption) | SigilGrid (view) | Notes |
|---|---|---|---|---|
| Compose / intent textarea | yes — CommandPanel overlay | no | no | Build-only |
| Build-phase petal sweep (orbit + filling petals) | yes — `useBuildingPetalSweep`, `PetalState` enum | no | no | The hero's flagship moment |
| Mid-build Q&A answer card | yes — `GlyphAnswerCard` over sigil core | yes — `GlyphQuestionPanel` above grid | no | Same `BuildQuestion`, different render |
| Test running output strip | yes — `GlyphActivityStrip` | yes — in `ChronologyCommandHub` | no | |
| Test-complete actions (Promote / Reject / Refine / Logs / Simulate) | yes — `GlyphTestCompleteCore` | yes — in `ChronologyCommandHub` | no | |
| Capability preview / remove / split (`GlyphCapabilityPreview`) | yes — unique to hero | no | no | Phase 5b — pre-promote consent |
| Capability quick-config (memory/review/connector/event/schedule pickers in compose) | yes — `GlyphPrototypeLayout` via petal click | no | no | Composer-prototype only |
| Per-card refine-this-dimension | no | yes — `onRefineDimension` on GlyphCard | no | Adoption-mode only |
| Activity diagram modal (flow) | no | yes — `ActivityDiagramModal` per card | no | |
| Mode badge / E2E / MOCK / INFO | no | yes — `renderHeaderBadge` | no | |
| Channel/connector totems on card | no | yes — `ChannelTotem`, `ConnectorTotem` | no | |
| Model badge + rationale tooltip | no | yes — `ModelBadge` | yes — `TileModelStrip` (per-use-case) | Two implementations of the same thing |
| Run / pause / simulate per tile | no | no | yes — `useCapabilityToggle`, `handleExecute` | View-mode only |
| Persona-level summary (counts + union) | no | no | yes — `PersonaCrest` | View-mode only |
| Persona-level default model picker | no | no | yes — `rightSlot` in PersonaCrest | View-mode only |
| Status pip per tile (active / paused / needs-attention) | no | yes — `renderStatusDot` | yes — `getHealthMeta` | Two slightly different state vocabs |
| Lab matrix run "describe new capability" | no | no | yes — in SigilGrid | View-mode only |
| Use-case nav between cards | yes — `GlyphRowStrip` (mini-sigils) | implicit (grid) | implicit (grid) | |
| Petal state vocabulary | `idle\|filling\|resolved\|pending\|error` (build phase) | `GlyphPresence: linked\|shared\|none` (design-time) | health: `active\|needs-attention\|disabled` + presence | Three vocabularies for petal state |

## Risk analysis for consolidation (Option B)

### Reducible risks (clean engineering work)

1. **Five sigil renderers → one parametric primitive.** Geometry is identical.
   A single `<Sigil size={n} variant={'hero'|'card'|'mini'|'micro'} state={…} />`
   handles all five. Low risk; high payoff.
2. **Three petal-state vocabularies → one union.**
   `PetalDisplayState = { presence?: GlyphPresence; buildPhase?: PetalState; health?: UseCaseHealth }`.
   Renderer picks priority: buildPhase > health > presence. Low risk.
3. **Two question-card renders → one primitive.** `GlyphAnswerCard` and
   `GlyphQuestionPanel`'s inner `GlyphQuestionCard` are ~90% identical.
   Trivial to merge.
4. **Two model-badge renders → one.** `ModelBadge` (shared) vs `TileModelStrip`
   (recipes-prototype). Merge to shared, parametrize compact vs full.

### Irreducible risks (this is where consolidation can hurt)

1. **The hero canvas IS the build UX.** The single 640px sigil with orbit +
   petal sweep + answer card floating in the centre is the build flow's
   identity. If consolidated mode replaces it with "tiny PersonaCrest at top
   + grid of cards below," you're trading the build's flagship visual for an
   adoption-style preview. Hero feels like "the system is working for me
   right now," grid feels like "here's an inventory."
   **Verdict:** consolidated mode needs to preserve a *large* hero —
   PersonaCrest enlarged to ≥400px with the same orbit + petal-sweep
   treatment during build phase. It can't shrink to 92px.
2. **Build-phase semantics don't naturally translate to persona-level union.**
   When the LLM is "filling the connector petal," it's filling that petal
   *for the active use case being designed*, not for the union of all use
   cases. A persona-level hero showing build state has to encode "which use
   case is being worked on right now" — probably by making the active
   use-case tile glow + the hero showing the union of *resolved* dimensions
   across capabilities. This is new visual language we haven't designed yet.
3. **Q&A still needs a per-dimension surface.** The mid-build question is
   "which connector should this use case use?" — that's
   dimension-of-use-case scope. If the hero is persona-level, the answer
   card has to render *next to or inside the active tile*, not in the hero
   core. That's a non-trivial layout question.
4. **`GlyphRowStrip` (use-case navigator) goes away.** Today during build the
   user clicks small mini-sigils on the left to switch which use case the
   big hero is showing. In the consolidated layout, the grid IS the
   navigator. That's a UX win but changes how mid-build navigation works.
5. **`GlyphCapabilityPreview` (Phase 5b — remove/split before promote)**
   lives in the test-complete core of the hero today. In the consolidated
   layout it naturally maps to per-card actions on the grid. That's a win,
   but it's a per-card-affordance migration, not a free port.
6. **Composer-prototype's "click petal to toggle memory/review/connector
   before launch"** is a clever quick-setup affordance that only works
   because the hero is interactive. If the hero becomes the union/persona
   summary, these petals have nothing to toggle — there's no use case yet.
   The compose phase has no clear analog in the consolidated layout; we'd
   need a pre-build state with a single "draft use case" tile that the
   petals manipulate.

### Risk verdict

Consolidation is *not* a clean refactor — it's a UX redesign for two phases
(compose, building/Q&A). The refactor for view-mode and template-adoption is
straightforward. The build flow needs design work. That's why the tab-switcher
prototype is the right call: ship it as a third option, iterate the build UX
inside it without breaking what works today.

## Recommended architecture (persona hero + use-case grid)

```
src/features/shared/glyph/                       (canonical package)
├── Sigil.tsx                                    NEW — parametric primitive replacing
│                                                       GlyphHeroSigil + InteractiveSigil + 4 MiniSigils
│                                                       props: size, dims, state, interactive?, onPetalClick?
├── PersonaHeroSigil.tsx                         NEW — wraps Sigil at hero size with
│                                                       build-phase orbit, petal sweep, answer-card overlay slot
├── PersonaCrestBand.tsx                         MOVED from recipes-prototype/PersonaCrest
│                                                       — persona summary band (name + counts + hero sigil)
├── UseCaseTile.tsx                              NEW — wraps Sigil at tile size with
│                                                       run/pause/sim controls (view mode)
│                                                       refine-dim (adoption mode)
│                                                       capability remove/split (build mode)
├── DimensionPanel.tsx                           EXISTING — already shared
├── QuestionCard.tsx                             NEW — merged GlyphAnswerCard + GlyphQuestionCard
├── DimensionsRefinePanel.tsx                    EXISTING — already shared
├── ModelBadge.tsx                               EXISTING — keep; absorb TileModelStrip's compact mode
├── ConsolidatedGlyphLayout.tsx                  NEW — the prototype layout itself:
│                                                       <PersonaHeroSigil> + <UseCaseGrid>
│                                                       Single component, mode prop drives variants
└── (existing types, dimMeta, channels, triggers, helpers …)

Consumers:
- UnifiedBuildEntry adds "consolidated" to BuildLayout localStorage union
- ChronologyAdoptionView adds a top-right tab switcher (Grid | Consolidated)
- PersonaUseCasesTab adds a tab (SigilGrid | Consolidated)
```

`ConsolidatedGlyphLayout` accepts a `mode: 'build' | 'adoption' | 'view'`
plus mode-specific props:

- `mode='build'` — pendingQuestions, cellStates, isBuilding, buildPhase,
  onAnswer, onStartTest, onPromote, …
- `mode='adoption'` — onRefineDimension, slotAbove (preconfig), …
- `mode='view'` — onToggleCapability, onExecute, onSimulate,
  personaModelPicker, …

Internally the layout renders the same shape (hero + grid) and only the slots
/ handlers change. That keeps the "future development always touches one
place" property.

## Prototype tab-switcher plan

Three host surfaces, each gets a tab/toggle that exposes the new
`ConsolidatedGlyphLayout` without touching the existing one:

1. **`UnifiedBuildEntry.tsx`** — extend the `BuildLayout` union from
   `"glyph-full" | "composer-prototype"` to add `"consolidated"`. Toggle
   lives where it does today. Migration of stored prefs already handles
   unknown values → `"glyph-full"`.
2. **`ChronologyAdoptionView.tsx`** — add a small segmented switcher at the
   top: **Grid** (current) | **Consolidated (prototype)**. Default to Grid;
   persist choice in localStorage like the build surface does.
3. **`PersonaUseCasesTab.tsx`** — same pattern: **Sigil Grid** (current
   `RecipesVariantSigilGrid`) | **Consolidated (prototype)**.

All three tabs render `<ConsolidatedGlyphLayout mode={…} {…} />` with
mode-appropriate props. The existing surfaces stay completely unchanged.
Once the prototype reaches parity in each mode, flip the default and
eventually retire the legacy paths.

## Build order (each step is a separate commit on a worktree)

1. Land `<Sigil>` primitive in `shared/glyph` + migrate the 4 use-case-level
   renderers (hero, card, two minis) to use it. Zero user-visible change.
2. Land `<PersonaHeroSigil>` (Sigil at hero size + build-phase decoration
   slots).
3. Land `<ConsolidatedGlyphLayout>` with `mode='view'` only (lowest risk,
   no build flow to disturb).
4. Wire the prototype tab in `PersonaUseCasesTab` → reach view-mode parity.
5. Add `mode='adoption'` → wire tab in `ChronologyAdoptionView` → reach
   parity.
6. Add `mode='build'` → this is the hard one (design work for compose + Q&A
   in the new shape) → wire tab in `UnifiedBuildEntry`.
7. Once all three modes feel right, flip defaults and remove
   `agents/components/glyph` (after a release of soak time).

## Concurrent-safety note

This refactor must run in its own git worktree (`worktree-glyph-consolidated`)
and register in `.claude/active-runs.md` before any code is touched. The
paths it claims:

- `src/features/agents/components/glyph/`
- `src/features/shared/glyph/`
- `src/features/agents/sub_use_cases/components/recipes-prototype/`
- `src/features/templates/sub_generated/adoption/glyph/`
- `src/features/templates/sub_generated/adoption/ChronologyAdoptionView.tsx`
- `src/features/agents/components/matrix/UnifiedBuildEntry.tsx`
- `src/features/agents/sub_use_cases/components/core/PersonaUseCasesTab.tsx`

As of the analysis time (2026-05-16 14:00 local) the seven concurrent
`/friend` sessions and `/research-hermes` are path-disjoint (plugins/,
drive/, langfuse/, companion/, radio/, scripts/docs/). Recheck the ledger
at session start.

## Open decisions (gate before implementation)

1. **First prototype host.** Recommended: view mode
   (`PersonaUseCasesTab`) — least risk, validates `<PersonaHeroSigil>` +
   `<UseCaseTile>` against real data without touching the build flow.
2. **Compose-phase design in consolidated mode.**
   - **(a)** Single "draft use-case tile" the user clicks petals on to set
     memory/review/connector preferences before submitting intent (today's
     composer-prototype, just relocated).
   - **(b)** Pre-build hero with intent textarea inside it, no grid until
     first build pass produces use cases.
   - **(c)** Skip composer entirely in the prototype — only support
     post-first-build phases initially, fall back to existing layout for
     the compose step until we design this properly.
   - Recommended: **(c)** defer.
3. **Scope of first commit.**
   - **(i)** Land the parametric `<Sigil>` primitive first (clean refactor,
     deletes ~4 SVG bodies, zero user-visible change), then build
     `ConsolidatedGlyphLayout` on top.
   - **(ii)** Build the prototype layout against existing renderers first,
     unify the primitive afterward.
   - Recommended: **(i)** primitive first so the prototype is built on the
     consolidated foundation from day one rather than retrofitted.
