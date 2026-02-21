# Overview UI Phase 6/7 — Pass-by-Pass Upgrade Roadmap

Date: 2026-02-19
Objective: execute UI/UX upgrades submodule-by-submodule against the golden baseline.

## 1) Delivery Strategy

- Use **incremental pass rounds** rather than full rewrites.
- Keep each pass reversible and scoped.
- Prioritize high-impact consistency first, then deep module polish.

## 2) Pass Rounds

## Pass 1 — Core Surface Normalization (Low Risk, High Impact)
Goal: unify shell spacing, border/surface tokens, and filter/button primitives.

Scope:
- `executions`, `manual-review`, `messages`, `events`, `memories`, `budget`, `usage`, `observability`, `realtime stats bar`.

Tasks:
1. Normalize shell wrappers (`p-6 pt-4` list tabs, `p-6 space-y-6` dashboards).
2. Replace drifted border tokens with baseline `border-primary/*` where applicable.
3. Align filter pill active/inactive states across list modules.
4. Normalize icon-button sizes/hover states for refresh/action controls.

Exit criteria:
- Visual “jump” between overview tabs is reduced.
- Filter bars feel like one system across modules.

## Pass 2 — Typography & Density Harmonization
Goal: reduce micro-type fragmentation and align hierarchy.

Scope:
- all 9 submodules, with emphasis on `messages`, `memories`, `realtime`, `observability`.

Tasks:
1. Apply global type ladder constraints (`text-sm` / `text-xs` / `text-[11px]`).
2. Restrict `text-[9px]` and `text-[10px]` to telemetry/meta-only contexts.
3. Standardize section title styles and metadata strip formatting.
4. Normalize row vertical rhythm (`py-2.5` / `py-3`).

Exit criteria:
- Typography feels coherent without losing compactness.
- Meta readability remains intact in dense modules.

## Pass 3 — State UX Unification
Goal: enforce consistent loading/empty/error/success behavior.

Scope:
- all submodules; priority: `budget`, `observability`, `usage`, `messages`.

Tasks:
1. Add visible user-facing error feedback where failures are currently console-only (`budget` first).
2. Standardize empty state copy + icon container treatment.
3. Align loading affordances (initial fetch and async action states).
4. Ensure action feedback clarity for resolve/save/test flows.

Exit criteria:
- Each module clearly communicates state transitions.
- No user-facing operation fails silently.

## Pass 4 — Interaction & Accessibility Hardening
Goal: make interaction semantics consistent and keyboard-safe.

Scope:
- list modules + overlays (`executions`, `manual-review`, `messages`, `events`, `memories`, `healing modal`, realtime drawer).

Tasks:
1. Convert clickable row containers to semantic `button` patterns or add keyboard parity.
2. Add/normalize focus-visible styles for interactive controls.
3. Verify ARIA/title coverage for icon-only controls.
4. Preserve modal/drawer keyboard escape and focus expectations.

Exit criteria:
- All expandable/clickable rows are keyboard-usable.
- Focus behavior is consistent and visible.

## Pass 5 — Submodule Deep Polish (Creative + Functional)
Goal: refine each module while staying inside the baseline system.

Submodule sequence:
1. **Budget** (highest gap): improve feedback clarity, improve compact edit UX, better status signal hierarchy.
2. **Realtime**: harmonize stats/drawer styling with baseline while preserving visual personality.
3. **Observability**: align dashboard/list hybrid layout and issue panel density.
4. **Events & Manual Review**: refine row scannability and expanded detail readability.
5. **Messages & Memories**: finalize dense list ergonomics and consistency details.
6. **Usage**: final chart card polish and filter alignment.
7. **Executions**: use as baseline anchor and adjust only if needed for global parity.

Exit criteria:
- Each module reaches baseline compliance + one targeted “quality lift” enhancement.

## Pass 6 — Cross-Module Final Harmonization
Goal: final unification pass across all tabs after module-level work.

Tasks:
1. Side-by-side tab switching review for visual continuity.
2. Resolve residual token drifts and one-off exceptions.
3. Normalize copy tone for empty/error helper text.
4. Final motion balancing (no noisy transitions outside realtime).

Exit criteria:
- Overview feels like one product surface with intentional module differences.

## 3) Recommended Execution Order (Concrete)

1. Pass 1 across all modules.
2. Pass 2 across all modules.
3. Pass 3 with priority: budget → observability → usage → messages → remaining.
4. Pass 4 with priority: memories/events/manual-review rows first.
5. Pass 5 per sequence above.
6. Pass 6 final harmonization.

## 4) Risk Controls

- Keep each pass to small, reviewable PR-size chunks.
- Re-run visual checks after each module batch.
- Avoid introducing new UX paradigms mid-pass.
- Do not alter business logic unless required for state feedback correctness.

## 5) Deliverables Checklist

- [ ] Baseline token compliance matrix after Pass 2
- [ ] State UX compliance matrix after Pass 3
- [ ] Accessibility checklist closure after Pass 4
- [ ] Submodule before/after snapshots after Pass 5
- [ ] Final overview cohesion report after Pass 6
