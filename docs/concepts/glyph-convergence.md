# Glyph Convergence — unifying from-scratch and from-template persona creation

**Status:** Accepted (design), Phase 1 in progress
**Date:** 2026-05-30
**Supersedes scope of:** [`glyph-consolidation.md`](./glyph-consolidation.md), [`matrix-retire-glyph-only.md`](./matrix-retire-glyph-only.md) (those retired the *legacy matrix*; this unifies the two *glyph* creation on-ramps)

## Context

Personas can be created two ways, and today they are two parallel UIs:

| | From scratch | From template |
| --- | --- | --- |
| Entry | Sidebar **Create** → full **page** (`UnifiedBuildEntry`, mounted by `PersonasPage`) | Sidebar **Templates** → gallery → **Adopt** → **modal** (`AdoptionWizardModal`) |
| Front half | `start_build_session` spawns a live **LLM** (Sonnet, multi-turn) that *generates* behavior + capabilities from free-text intent, asking clarifying gate questions | `create_adoption_session` injects a pre-authored **`agent_ir`** (no LLM, no CLI), lands at `draft_ready` instantly; questionnaire only *binds parameters* (connectors, disable use-cases, error routing) |
| Wrapper components | `GlyphFullLayout` / `GlyphPrototypeLayout` (`agents/sub_glyph/`) | `PersonaLayoutAdoption` + `PersonaLayoutBuild` (`templates/sub_generated/adoption/persona-layout/`) |
| Job | **generate** a persona | **narrow & bind** a template |

### The key insight: they already converge at `draft_ready`

Both on-ramps merge at `buildPhase === "draft_ready"` and share the entire back half:

- **State machine** — `matrixBuildSlice` (`src/stores/slices/agents/matrixBuildSlice.ts`); `BuildPhase: initializing → analyzing → awaiting_input → resolving → draft_ready → testing → test_complete → promoted`.
- **Backend from draft onward** — `test_build_draft`, `promote_build_draft` / `promote_build_draft_inner` (the atomic transaction in `src-tauri/src/commands/design/build_sessions.rs` that writes tools/triggers/subscriptions/assertions + the persona row), `answer_build_question`, refine. **No Rust changes are required for this convergence** — the backend is already shared.
- **Sigil primitives** — `src/features/shared/glyph/` (`InteractiveSigil`, `PersonaLayout`, `persona-sigil/GlyphSigilCanvas`) and the `useUseCaseChronology` hook (which despite living under `templates/.../adoption/chronology/` is consumed by both).

So convergence is a **front-half + front-door** problem, not a rebuild.

### Distinctive pieces (what genuinely differs)
- **Modal vs full-page** is the biggest *felt* divergence (adoption is a 1750px modal).
- **Origin**: `generated` (LLM) vs `seeded` (template `agent_ir`). The seeded path has a pre-`draft_ready` "narrow & bind" questionnaire; the generated path fills cells via live LLM gate questions instead.
- **Third path — instant adopt**: `instant_adopt_template` → `create_persona_atomically` bypasses build sessions entirely (use-template-verbatim express lane). **Decision: this is folded into the unified flow** (see Decisions below) — it becomes a removal candidate once the seeded path is fast enough to replace it.
- **Templates ARE "starter examples"** — the recipe-suggestion mechanism in compose (`match_recipes_to_intent`, `ComposerRecipeSuggestion`) and Athena's `TemplateSuggestionsWidget` already prove the "surface a starting point as you type" pattern; it's just not wired into a unified front door.

### Drift / dead code to retire
- Two `GlyphSigilCanvas` files (`agents/sub_glyph/GlyphSigilCanvas.tsx` is a re-export shim of `shared/glyph/persona-sigil/GlyphSigilCanvas.tsx`).
- Adoption legacy (unmounted in the live tree): `adoption/ucPicker/*`, `adoption/glyph/PersonaChronologyGlyph.tsx`, `adoption/chronology/ChronologyCommandHub.tsx`, legacy standalone `adoption/questionnaire/QuestionnaireForm.tsx`.

## Decision

A single creation experience: **one front door, one surface, two on-ramps that merge early.** A build session carries an **`origin`** (`generated | seeded`); the UI is one pipeline with a seed-only pre-phase.

Decisions taken (2026-05-30):
- **Scope: Deep** — merge the four wrapper components into one `origin`-aware surface; retire the dead code + duplicate canvas.
- **Front door: describe-first**, template starters below, "Browse all".
- **Live match: yes** — surface matching templates as the user types intent.
- **Instant adopt: fold into the unified flow** — retire the `instant_adopt_template` → `create_persona_atomically` bypass so every template goes through the unified build surface (seed → bind → test → promote). One code path, one mental model; the verbatim-template speed is recovered by making the seeded path fast (auto-test on `draft_ready`, no questions = straight to promote). The Rust `instant_adopt_template` command + `create_persona_atomically` become removal candidates in Phase 5 once no caller remains.

### Target architecture

```
 Sidebar "Create" ─► PersonaCreator (full-page launcher)
   • describe-first box (autofocus)        ──────────────► origin: generated
   • template starters + live-match row    ──┐
   • "Browse all" → gallery (+ Use as-is)    │ ──────────► origin: seeded
                                             ▼
        seeded only:  narrow & bind pre-phase (cap toggles + connector-binding
                      questionnaire; reuses AdoptionAnswerCard / ErrorPolicyCard /
                      CapabilityTagSwitcher)
                                             ▼
        ┌──────────── GlyphBuildSurface (origin-aware, the sigil) ────────────┐
        │  draft_ready → answer/bind → test → "ready" → open                  │  identical for both
        └─────────────────────────────────────────────────────────────────────┘
```

- **Merges into one `GlyphBuildSurface`:** `GlyphFullLayout` + `GlyphPrototypeLayout` + `PersonaLayoutAdoption` + `PersonaLayoutBuild`.
- **Untouched:** all Rust, `matrixBuildSlice`, `useUseCaseChronology`, `useLifecycle`/`useBuild`, shared sigil primitives, the bind widgets.

## Staged rollout — additive first, structural last

Each phase is independently shippable + validated. **Phase 3 precedes Phase 4 deliberately** — hosting adoption in-page surfaces the integration seams the component merge then cleans up.

| Phase | What | Risk | Removes |
| --- | --- | --- | --- |
| **1. Unified launcher** | New `PersonaCreator` (describe-first + template starters + Browse all). Describe → existing scratch path; starter → existing adoption path. Pure addition. | Low | — |
| **2. Live template match** | Wire match-as-you-type into the describe box (template variant of the recipe-suggestion debounce). | Low–med | — |
| **3. Host adoption in-page** | Render adoption in the page host; bind-questionnaire becomes the seeded pre-phase. Retire the modal chrome. | Med | `AdoptionWizardModal` |
| **4. Merge sigil wrappers** | Unify the four layout components → one `origin`-aware `GlyphBuildSurface`. | **High** | 3 wrappers |
| **5. Retire dead code** | Delete `ucPicker`, `PersonaChronologyGlyph`, `ChronologyCommandHub`, legacy `QuestionnaireForm`, dup `GlyphSigilCanvas`; remove the now-unused `instant_adopt_template` / `create_persona_atomically` express path (the one Rust touch in the whole effort). | Low–med | dead tree + bypass |

Phases 1–3 are user-visible → update `docs/features/personas/` + `docs/features/templates/` + onboarding + marketing guide in the same phase. Phases 4–5 are internal refactors.

## Consequences

- **Positive:** one mental model for creation; the "blazing-fast simple" path (pick a proven template, answer 1–2 binding questions) and the "open-ended" path (describe it) live side by side; ~4 wrapper components collapse to 1; dead code removed; future creation work has one place to land.
- **Cost:** Phase 4 is a high-risk cross-area refactor (`agents/` + `templates/`); must be staged and verified against the live app, not tsc alone.
- **Backend:** effectively none through Phase 4 — the convergence is frontend + routing. The only Rust touch is Phase 5's removal of the now-unused `instant_adopt_template` / `create_persona_atomically` bypass.

## Key references (file:line maps captured during analysis)
- Scratch: `src/features/agents/components/matrix/UnifiedBuildEntry.tsx`, `src/features/agents/sub_glyph/*`, `src/features/personas/PersonasPage.tsx`
- Template: `src/features/templates/sub_generated/adoption/{AdoptionWizardModal,ChronologyAdoptionView}.tsx`, `.../persona-layout/{PersonaLayoutAdoption,PersonaLayoutBuild}.tsx`, `.../useHydratedDesignResult.ts`
- Gallery entry: `src/features/templates/sub_generated/gallery/cards/GeneratedReviewsTab.tsx`, `.../modals/TemplateModals.tsx`
- Shared back half: `src/stores/slices/agents/matrixBuildSlice.ts`, `src/features/agents/components/matrix/{useBuild,useLifecycle}.ts`, `src/hooks/build/useBuildSession.ts`, `src/api/agents/buildSession.ts`
- Adoption-specific IPC: `create_adoption_session`, `save_adoption_answers`, `update_build_session_disabled_dims` (`src-tauri/src/commands/design/build_sessions.rs`)
- Instant adopt: `instant_adopt_template` → `create_persona_atomically` (`src-tauri/src/commands/.../template_adopt.rs`)
