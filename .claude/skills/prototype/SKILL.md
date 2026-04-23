---
name: prototype
description: Iteratively prototype a UI component through directional variants behind a tab switcher, then consolidate and refactor the winner. Use when the user wants to improve a component they consider a pillar of the app (visual appeal, creativity, UX clarity).
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Agent
---

# Prototype — Directional Variant Workflow

A disciplined A/B prototyping loop for refining a UI component. Start from a named file, produce radically different directional variants behind a tab switcher, let the user prune/fuse across rounds until one direction wins, then consolidate + refactor. The workflow is distilled from an actual session where it took 5 rounds to go from "prototype these ideas" to "ship-quality consolidated component" — the guardrails below are there to cut the rounds needed next time.

---

## When to use

The user says things like "help me master this component", "prototype ideas on top of X", "this is a pillar of the app and I want it to be amazing", or "iterate until we reach an amazing result". The request carries an **open direction** and **visual quality bar**, not a specific change list.

## When NOT to use

- Fixed-scope requests ("change the button color to blue") — just edit.
- Bug fixes.
- Non-visual code (business logic, API layer, state store).
- User asks for "three layouts" but wants them all shipped — that's different from prototyping.

---

## Step 0: Collect the starting file

The skill takes no arguments. When invoked, immediately ask the user **one short question** and wait for their reply before doing anything else:

> "Which component should I prototype on? Paste the path (e.g. `src/features/agents/.../SomeComponent.tsx`)."

Do not attempt to guess the file from conversation context unless the user has already named a specific path in the same turn. If their reply isn't a concrete path (e.g. they describe the component by purpose), ask a clarifying follow-up rather than guessing — picking the wrong file wastes whole rounds of work.

Once you have a path, proceed to Phase 1.

---

## Phase 1: Verify the actually-rendered component

**Don't trust the filename.** The file the user named may not be what actually renders in the app. This was the single most expensive mistake in the source session — two rounds of work landed on the wrong file.

Steps:
1. Read the component the user named.
2. Grep for JSX usage: `<ComponentName` (rg pattern: `<{Name}\b`).
3. Grep for imports: `from ['"].*{Name}['"]`.
4. If the named component has **zero JSX usages**, it's a library file, not a rendered view. Find the one that IS rendered — follow imports from a known entry point (the user-facing feature's top-level view).
5. **Confirm with the user in one sentence** before proceeding: "The named file re-exports helpers; the actually-rendered component is X — prototyping on X. OK?"

Never silently assume. The file name is a hint, not ground truth.

---

## Phase 2: Scaffold the tab switcher

Goal: add a top-of-component tab strip that lets the user A/B between variants without forking call sites.

1. Rename the current exported function to `{Name}Baseline` (internal, same file).
2. Re-export the original name as a wrapper that:
   - Holds a `variant` state.
   - Renders a small tab strip at the top (label + 1-line subtitle each).
   - Delegates body to the active variant, all receiving identical props (`inline`-ish semantics).
3. Every variant must accept the same `Props` shape the component already uses — consumers stay untouched.
4. Keep baseline as the default selected tab so nothing visually changes on load.

Principle: the scaffold is throwaway. Don't over-engineer it. A 15-line tab switcher is enough.

---

## Phase 3: Generate 2 **directional** variants

### 3a. Prerequisite — ground your variants in the codebase's actual quality bar

Before writing *any* variant code, spend a few tool calls to calibrate quality. This is the single biggest round-1 uplift: variants that mine the codebase feel like siblings of the app. Variants invented in isolation feel like prototypes.

Do these three things, in order, every time:

1. **Read the design-system doc if one exists.** In Personas it's `.claude/Design.md` — referenced from `CLAUDE.md`. Other projects may have `design-tokens.md`, a Storybook index, or a `styles/` readme. Note the canonical tokens you're expected to use: semantic typography classes (`typo-hero`, `typo-section-title`, `typo-data-lg`, `typo-label`, `typo-caption`), status-token colours (`text-status-success/warning/error/info`), semantic radii (`rounded-card`, `rounded-interactive`, `rounded-input`), elevation tiers (`shadow-elevation-1..4`), brand tokens. **Using these from round 1 is what separates production-grade variants from prototype-grade variants.** Raw `bg-violet-500/15` / `text-amber-300` is a tell.

2. **Find one or two sibling surfaces in the same repo that exemplify the quality bar.** Good candidates: the most elaborate adoption/onboarding flow, the feature's "hero" view, or any folder the user has previously called out as polished. In Personas, strong references are `src/features/templates/sub_generated/adoption/questionnaire/` (three-pane layout, decorative background SVG, header band with animated halo, story thread) and `src/features/templates/sub_generated/adoption/glyph/`. **If the user names inspiration folders, treat that as authoritative** — mine those, even if the filenames don't match the feature you're prototyping.

3. **Extract three things from each reference:** (a) *layout shape* — e.g. header band + 3-pane + footer; (b) *motion language* — what animates, what doesn't, is there a decorative background SVG?; (c) *typography + data patterns* — what's rendered as `typo-data-lg`, where are uppercase-tracked labels used, how are status tokens shown.

Skip this and your first round of variants will get thrown away wholesale. Spend the tool calls.

### 3b. Directional variants

The critical word is *directional*. A variant is not "baseline with spacing tweaked"; it's a completely different **mental model** for the same data.

Good variant pairs:
- orbital (spatial, SVG animation) + blueprint (engineering drawing, technical aesthetic)
- dialogue (chat metaphor) + dashboard (dense data grid)
- scroll/journey (linear narrative) + card-deck (discrete decisions)
- studio / atelier (atmospheric 3-pane with decorative background) + ledger / record (data-dense single-column with a "benefit" column)

Each variant should earn its name by carrying a **single central metaphor** through:
- Layout
- Typography choices
- Motion language
- Iconography
- Copy voice (if applicable)

Deliverables per variant:
- File: `{Name}{Variant}.tsx` in the same folder.
- Short header comment describing the metaphor + why it's different from baseline.
- Reuse shared primitives (existing QuestionCard, category meta, icons) — don't reinvent form widgets.
- Degrade gracefully for edge cases the baseline handles (blocked credentials, dynamic options, etc.).
- **Prefer data-concrete symbols over abstract markers.** A brand logo or parsed channel chip beats a coloured presence dot. The user evaluates variants partly on "does this encode *real* template data the user already cares about, or is it an abstract diagram?" When the metaphor allows, pull from the live data model (connector names, event types, cron strings) over stylised shapes.
- **Design for extraction.** The user scores a variant partly on what it contributes back to the rest of the app: named sub-components (`ConnectorTotem`, `DimensionPanel`, `CapabilitySigil`) that could live elsewhere, not a monolithic `.tsx`. If a variant has no extractable pieces, it may be killed on reusability grounds even if it looks good.
- **Answer "what am I working with?" in round 1.** If the user is manipulating nouns (personas, credentials, connectors, templates), the affordance for picking them must show *meaningful stats* — the facts they'd need to make an informed choice. Name-only chips with a decorative icon are a round-1 failure mode. For a persona: model tier, trust score, prompt weight, turn ceiling, budget cap. For a credential: connector brand, last-used, scope. Derive these from the actual data type bindings — read `@/lib/bindings/{Type}.ts` and surface the non-obvious fields.
- **Answer "what did I gain?" in round 1 for output-producing components.** If the component produces results (offspring, generated content, ranked suggestions), each result must carry *signal about why it matters*, not just raw numbers: a rank label (Champion / Runner-up / Contender / Experimental), a delta vs an average/baseline (`+15% vs run avg`), and a plain-language inheritance or derivation line (`inherits Alpha model + Beta tools`). Raw fitness bars alone are a round-1 failure mode.

**Do not propose 3+ variants in round 1.** Two is the right number. More = analysis paralysis, and the user will pick direction by round 2 anyway.

---

## Phase 4: Iterate by subtraction and fusion

After round 1, the user will usually:
1. **Reject one variant outright** ("I don't like Blueprint — delete it, create new one").
2. **Identify a strong element in another** ("Constellation's orbit is interesting — move it into Focus as background").
3. **Give specific feedback on the leading candidate** (typography, stacking, spacing, keyboard nav).

How to process each:

**Rejection → delete immediately.**
- Remove file, remove import, remove tab entry. Don't keep the file "just in case".
- Dead code is a distraction in future rounds.

**Fusion → extract + merge + delete source.**
- Take the strong element out of variant A.
- Merge it into variant B's layout in the position user specified.
- Delete variant A entirely.
- This shrinks the live tab count every round — a good signal.

**Specific feedback → apply inside the chosen variant.**
- Do NOT spawn a new variant for a specific fix.
- The user didn't ask for more options; they asked for refinement of this one.

**Add a new variant only when asked.** "Create new variant with X direction" is explicit. Absent that, keep iterating within the current set.

**Hoist shared pieces mid-prototype, not only in Phase 6.** The moment two variants start rendering the same structure (even if styled differently), extract the shared sub-component and let both import it. Waiting until refactor time doubles the refinement cost — every tweak has to be made twice. Specifically: when variant A is kept and variant B is being created *on top of A's sigil/card/strip*, export the shared primitive from A the same turn you create B.

Each round: end with an **explicit menu** of what you changed, then ask the user for the next move. Don't auto-advance.

---

## Phase 5: Declare the winner and consolidate

Transition keywords that trigger this phase: "I think we have it", "this is the one", "promote X to default", **"set X as the production baseline"**, "X becomes our go-to". The last two carry a broader mandate than the first three — they authorise cleanup that extends beyond the prototyping variants (see step 3).

1. Stop iterating.
2. Make the winner the default tab OR remove the switcher entirely and render only the winner.
3. Delete remaining non-winner variants from disk and from imports. **If the transition keyword was "production baseline" or equivalent, the cleanup scope extends to *legacy variants on the same surface* that the user never asked to prototype but is now willing to cut now that there's a clear winner** — e.g. removing the old matrix/theme variant that the prototype was originally competing against. Ask once if unsure; don't delete silently.
4. Run typecheck to confirm no dangling references.
5. **Do NOT refactor in this phase.** Refactor is a separate, explicit request. Premature refactor destroys diff visibility while the user is still evaluating the winner live.

Exit this phase with: one file, one component, baseline untouched-by-scaffold (or the winner has replaced it), typecheck clean, user can reload and see the winner as the live render.

---

## Phase 6: Refactor (only on request)

When the user explicitly asks to refactor (e.g. "split into smaller files, max N LOC per file, put under subfolder/"):

**Check for a sibling folder to mirror.** Before inventing a structure, look at sibling modules in the same parent directory — the user often references one by name ("match the questionnaire folder pattern") or expects the new folder to follow whatever convention is already there: one `types.ts`, one `helpers.ts`, co-located `.tsx` files for components, lowercase filenames for hooks, a one-line `index.ts` barrel. If a sibling pattern exists, match it file-name-for-file-name. If none exists, use the order below.

1. Create a subfolder named after the component's domain (lowercased).
2. Split by responsibility, roughly in this order of "most valuable to extract first":
   - **Types** — `types.ts` with shared interfaces + discriminated unions.
   - **Pure helpers** — geometry, formatters, normalizers.
   - **Hooks** — extracted stateful logic (`useCategoryData`, `usePulses`, `useKeyboardNav` patterns).
   - **Leaf components** — option cards, icons, status pills.
   - **Pane components** — header band, left rail, centre hero, right rail, footer.
   - **Main orchestrator** — the assembled component, state + layout only.
   - **Barrel `index.ts`** — one-line re-export for stable consumer imports.
3. **LOC cap per file is a guideline, not a rule.** If a component is genuinely 210 LOC and splitting it would create awkward prop drilling, 210 is fine. But ≤200 is a useful forcing function against sprawl.
4. Update the single consumer import in the one place the component is rendered. Use `Grep` to find all import sites first — don't assume one.
5. Keep sibling exports (shared constants, helpers used elsewhere) stable. Don't move re-export shims breakably.
6. Typecheck at the end, not between files.

---

## Guardrails (learned the hard way)

### Watch for external reverts

Linters, pre-commit hooks, auto-formatters, or other concurrent Claude sessions can revert your writes. After every significant Write, watch for `Note: <file> was modified, either by the user or by a linter` markers in the next tool-result message. If the markers contradict your most recent change, don't re-argue — just re-apply the change (the user is aware and wants it).

**Reverts can accumulate.** A single orchestrator file (e.g. `MatrixAdoptionView.tsx`) may be reverted more than once during a long session, silently rolling back imports / tab entries / type union members / render branches. If the user says *"some process seems to have reverted the progress"* or you see a system note snapshotting an outdated version of a file you already edited, re-apply the full round's wiring in one batch (import + type + tabs + variants + render branch all at once) rather than trying to reconstruct which pieces survived. One grep to enumerate what's still missing, then one edit per missing piece.

### Don't touch files outside the prototype scope

A sharp correction in the source session was "did you stash or throw any changes elsewhere? I lost progress elsewhere, this cannot happen." If a file is modified locally (shown in `git status` as `M`), **do not write to it** unless the user explicitly said to. Apply edits with tight, single-line diffs so unstaged work is preserved.

### Typography is a recurring quality axis

Small type (under `text-sm` / 14px) is a frequent correction target. Lean toward `text-base` for body content and readable copy. Reserve `text-xs` for uppercase tracking-wide labels only. Never use pixel-valued arbitrary sizes (`text-[10px]`) in shipped variants — that's a prototype-grade shortcut, not a design decision.

**Brighter, not muted.** When promoting a piece of copy (use-case subtitle, card description), don't just bump the font size — also remove opacity muting. `text-foreground/90` → `text-foreground`, `font-normal` → `font-medium`. "Promote" means "make more present", not just "make slightly larger". The user will often correct both axes in the same sentence.

### Animation austerity

Infinite/always-on motion is treated as noise and gets rejected wholesale. Specifically avoid in any shipped variant:
- `repeat: Infinity` / `animation: ... infinite` / `<animate repeatCount="indefinite">`
- SVG `<animateMotion>` along orbits, scan lines sweeping on loops, drifting particle layers
- Ambient rotations of large elements (e.g. rotating a whole crest a few degrees on a 12s loop)
- `hover:-translate-y-*` on cards — moving DOM geometry on hover reads as aggressive, not polished

What *is* welcome:
- Entry animations (opacity/y fade-in, once on mount).
- Hover-gated transitions on colour, shadow, border, gradient opacity.
- Click-gated state transitions (drawer expand, panel slide-in).
- `AnimatePresence` for mount/unmount of specific UI elements.

Rule of thumb: if the user would see the animation after leaving the screen idle, cut it.

### Preserve shared exports during consolidation

If the baseline file re-exports helpers used by sibling files (icons, category meta, small utilities), keep those re-exports stable even when refactoring internals. Unexpected broken imports in unrelated files erode trust.

### One-shot typecheck, not continuous

Don't run `tsc --noEmit` after every file write — it's slow. Batch file writes, typecheck once at the end of a round. If it fails, triangulate from the error list, fix, and run once more.

### Keep baseline as reference, not as a ceiling

The baseline is preserved for A/B, not because it's the target. Early rounds should feel radically different from it. If the user's feedback keeps pushing variants closer to the baseline, propose a new direction — don't keep compressing.

### Framer-motion on SVG `cx` / `cy` / `r` attributes — use transforms instead

Animating raw SVG attributes via `animate={{ cx: ..., cy: ..., r: ... }}` on a `motion.circle` can briefly render the attribute as literal `"undefined"` during mount, which fails DOM validation and shows up as dev-console errors like `<circle> attribute cx: Expected length, "undefined"`. Two safe patterns:

1. **Position** — wrap in `motion.g` and animate `x` / `y` on the group; children stay at `cx={0} cy={0}`:
   ```tsx
   <motion.g initial={false} animate={{ x: px, y: py }} transition={{ type: 'spring', ... }}>
     <circle cx={0} cy={0} r={5} fill="currentColor" />
     <circle cx={0} cy={0} r={9} fill="none" stroke="currentColor" />
   </motion.g>
   ```
2. **Size pulse** — keep the static `r={...}` attribute and animate `scale` instead of `r`:
   ```tsx
   <motion.circle cx={0} cy={0} r={coreR}
     animate={{ scale: isActive ? [1, 1.06, 1] : [1, 1.03, 1] }}
     transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
   />
   ```

Other safe-to-animate properties on SVG: `strokeDashoffset`, `pathLength`, `opacity`, and any transform (`x`, `y`, `scale`, `rotate`). Unsafe without a concrete `initial`: `cx`, `cy`, `r`, `width`, `height`, `cx`/`cy` on `radialGradient`.

### Don't use `useMemo` for side effects

During consolidation it's easy to write something like:
```tsx
useMemo(() => { if (results.length > 0) setStage('offspring'); }, [results.length]);
```
This is wrong — `useMemo` is for returning values, not firing effects, and it causes setState during render. The intent is `useEffect`. Before every consolidation or variant-write step, grep your own output for `useMemo\(.*set[A-Z]` and swap to `useEffect`.

---

## Signals the iteration is converging

Green flags:
- Tab count is decreasing round-over-round (3 → 2 → 1).
- User's feedback is shifting from "I don't like this direction" to "tweak this specific thing".
- User names the winning metaphor positively ("Constellation looks interesting", "the three-pane thing works").
- User gives layout-level specifics (sidebar width, option-stacking, keyboard numbers).

Red flags → slow down and reset direction:
- User keeps rejecting wholesale ("terrible", "poorly executed") round after round.
- User restates the baseline as their preference.
- Variants are being asked to gain features baseline has (back-porting).

---

## Exit checklist

At the end of the workflow, confirm:
- [ ] Winner variant is the default rendered component.
- [ ] All non-winner variants deleted from disk, imports, and tab configs.
- [ ] Typecheck clean on touched files (pre-existing unrelated errors ignored).
- [ ] Lint warnings explicitly audited — incremental-migration warnings (typography, spacing tokens, i18n) are acceptable; 0 errors required.
- [ ] Consumer import paths still resolve (grep for old filename confirms zero references).
- [ ] If refactored: new subfolder exists, `index.ts` barrel exports the top-level component, max file size within budget.

When every box is checked, summarize the journey in 1-2 sentences (what metaphor won, what the winning variant does differently) — that summary is what the user will quote in a PR description or changelog entry.
