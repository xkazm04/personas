# Design variant switcher

> Situation node: `ui-system/design-tokens-theming/design-variant-switcher` ·
> [situation spine](../situation-spine.md) · recurrence 8 · risk **medium** ·
> dimensions: ui · code-quality · performance · `sides: "client"` ·
> `twoSided: false` · `convergence: "mixed"` ·
> merged from *"Shipped design variants"* + *"Design variant tab switcher"*
>
> *"Keeping several explored directions switchable without shipping dead
> surfaces."*
>
> **Full contract** (dispatched as full contract at recurrence 8 / medium risk).
> Composed 2026-08-17 against `master` from: a TypeScript 6.0.3 AST scan of all
> 2,083 non-test `.tsx` for runtime alternation between whole-surface renderers;
> **two independent walks of the entire git history** for the lifetime of every
> variant module the repo has ever had; a two-implementation enumeration of the
> per-theme CSS custom-property sets in `globals.css` (5,554 lines); a full read
> of `check-themes.mjs`; a locale-catalog count across all 14 languages; and a
> five-repo convergence sweep that found **one independent reinvention with a
> better mechanism**.
>
> No claim here depends on database rows; the 2026-08-17 purge does not touch it.

---

## §0 Headline

**This repo has consolidated 94 design variants and is very good at it — the
median variant lives 0 days. The eight that survive are the problem, and the
reason they survive is that nothing can see them: the naming convention the repo
uses for variants has, today, `0/8` precision and `0/7` recall against the
variants that are actually switchable. Every file named `*Variant*` is a
consolidation winner that kept the loser's name; every module still sitting
behind a live switcher is named something else.**

Two switchers remain, both self-described as *"throwaway scaffolding"*, both
born 2026-04-25 and therefore **114 days old** — a fact
[`tab-strip.md` D10](./tab-strip.md) already records. What that entry stops short
of is the cost, and the cost is where this path starts:

- **81,316 B of source in four modules the user may never open** is imported
  *statically* inside two lazy chunks, so `research-lab/literature` pays 39,798 B
  and `research-lab/projects` pays 41,518 B on every open, for variants nobody
  selected. `TonePage.tsx` — 21 lines — shows the fix and already uses it.
- **13 hardcoded English strings** in the research-lab switcher, against **0** in
  the Twin one, whose 7 keys are translated in all 14 locales. ESLint reports
  **none** of the 13.
- **A variant can quietly lose a feature.** `ResearchProjectListCartograph.tsx`
  has no `syncToObsidian` and no `syncDailyNote` — both present in the Baseline
  it sits beside. Pick that variant and the Obsidian sync button is gone, with
  nothing anywhere declaring that the variants are supposed to be equivalent.
- **Neither switcher has a single ARIA attribute or a keyboard handler.** The
  shared primitive that does (`SegmentedTabs`) is one import away.

And the best answer in the fleet is not in this repo: `brainiac`'s
`console/src/design/PrototypeSwitcher.tsx` independently reinvented the same
mechanism, put the choice **in the URL** so a round can be argued over by link,
and added a **scale toggle** because *"every one of these surfaces was designed
against a fixture org of a dozen items and quietly falls apart at organizational
scale"*. Neither Personas switcher can show a variant at scale. §10.

---

## §1 Trigger

1. *"Prototype three directions for this component and let me flip between
   them."* (This is `/prototype`'s Phase 2 — see `.claude/skills/prototype/SKILL.md`.)
2. *"Keep the old layout around so I can compare."*
3. You are about to create `<Name>Atelier.tsx` / `<Name>VariantB.tsx` /
   `variants/<Something>.tsx` beside an existing component.
4. You are about to add a third alternative to a switch that renders one of two
   whole surfaces at the same route.
5. You are about to write the word `Prototype` into a tab strip.

**Not this situation.** A **tab strip** whose tabs show *different* content is
[tab-strip](./tab-strip.md) — 19 of the 22 runtime alternations in this repo are
that, and §9 explains why no machine can tell the two apart. A **theme**
selector is [theming-and-contrast](./theming-and-contrast.md) (see §12.2, where
the brief's theme hypothesis was tested and did not hold). A **tier**- or
**flag**-gated surface is [tier-and-capability-gating](./tier-and-capability-gating.md).

---

## §2 The one way

**A variant switcher is scaffolding with an expiry date, and it must be built so
that leaving it in place is expensive rather than free.** Concretely: (a) put
every variant behind its own `lazy()` boundary so an unselected direction costs
nothing but a file — never a static `import` of a losing variant; (b) render the
strip through the app's tab primitive, not a hand-rolled row of `<button>`s, so
the scaffolding inherits roles, `aria-selected` and arrow-key navigation instead
of re-deciding them; (c) put the label copy through i18n exactly as product copy
would go, because a switcher that is cheap to translate is cheap to keep and the
one that is not will be the one that rots; (d) persist the selection and
**validate the rehydrated token against the variant list**, defaulting to
`baseline` — the surface the maintainer already knows — so a renamed variant
degrades to the shipped one rather than to a blank; (e) declare, in the switcher
file, the **exit condition and the date**, not just the intention; and (f) make
every variant render the *same capability set* — a direction that quietly drops
an action is not a design variant, it is an unannounced feature flag.

If your app has a router, add `brainiac`'s clause: **put the choice in the URL as
well**, so a round can be shared by link (§10). This app has no router — verified
by `tab-strip.md` §12.5 and re-verified here — so the store or `localStorage` is
the whole address space, and that is a limitation to state, not a design.

Reach first for **`TwinVariantTabs` + `TonePage`**; it is right on (a), (c), (d)
and wrong on (b) and (e). Do not reach for `PrototypeTabs`.

---

## §3 Mandated primitives

| Primitive | What it gives you | Where |
|---|---|---|
| `plugins/twin/variants/TwinVariantTabs` | the strip: a closed `TwinVariantId` union, a **validated** `localStorage` rehydrate, per-page `storageKey`, fully translated labels + hints | `src/features/plugins/twin/variants/TwinVariantTabs.tsx` |
| `layout/SegmentedTabs` | `role="tablist"`, `role="tab"`, `aria-selected`, `aria-orientation`, roving `tabIndex` and `onKeyDown` arrow/Home/End (`:107-160`) — none of which either switcher currently has | `src/features/shared/components/layout/SegmentedTabs.tsx` |
| `React.lazy` + `layout/RouteChunkSkeleton` | one chunk per variant, and a delayed geometry-matched ghost while it arrives | `src/features/shared/components/layout/RouteChunkSkeleton.tsx` |
| `useTranslation` + `t.twin.variantTabs.*` | the label/hint shape, already translated ×14 | `src/i18n/locales/*.json` |

**The site to copy is 21 lines**: `src/features/plugins/twin/sub_tone/TonePage.tsx`.

**Do not reach for** `plugins/research-lab/shared/PrototypeTabs` — §7 D1–D4 are
all it.

---

## §4 Steps

1. **Name the exit before the first variant.** Write the date and the condition
   into the switcher file: *"delete when the round consolidates; opened
   2026-08-17."* `brainiac`'s version names the authority as well (*"per the
   prototype skill's exit checklist"*). A comment that says *"throwaway"* with no
   date is the thing that has been here 114 days.
2. **Create the variants as siblings**, each a default export, each accepting the
   same props. Keep `Baseline` as the first entry and the default.
3. **Import each with `lazy()`** and wrap the body in one `<Suspense>` with
   `RouteChunkSkeleton`. `TonePage.tsx:5-7` is four lines and it is the whole
   performance story.
4. **Render the strip with the switcher, and the panel yourself** — the
   [tab-strip](./tab-strip.md) contract applies unchanged; a variant strip is a
   tab strip that happens to be temporary.
5. **Put the labels in `en.json`** under one section, and run the translation
   pipeline. If that feels disproportionate for scaffolding, that friction is the
   point of step 1.
6. **Validate on rehydrate.** `TwinVariantTabs.tsx:35-41` reads `localStorage`,
   checks the value against the three literals, and falls back to
   `defaultVariant`. **And then stop** — do not add a migration arm; a variant id
   that no longer exists should land on baseline, silently and correctly.
7. **Diff the capability sets before shipping the round.** Enumerate the store
   actions and mounted sub-components each variant uses; if they differ, either
   fix the variant or say in its blurb that it is deliberately reduced.
8. **On consolidation: delete the losers, delete the switcher, and rename the
   winner.** The rename is not cosmetic — §0 and §9 are entirely about what
   happens when it is skipped.

### Can the signature make the wrong call impossible?

Partly, and the honest answer is that the important half cannot.

- **What a type can do.** `PrototypeVariant` (`PrototypeTabs.tsx:11-16`) declares
  `render: () => ReactNode`, which *permits* a statically-imported component and
  a `lazy()` one equally. Narrowing it to
  `component: LazyExoticComponent<ComponentType>` makes the eager import a
  compile error — **Q5 withholding**, done at the right end: the caller is not
  asked to remember `lazy()`, it is denied the ability to pass anything else.
  Two call sites, both fixed by construction.
- **Q1 — what the type cannot carry.** It cannot carry *"and this expires"*.
  D5's capability drift, D6's age, and the entire §0 headline survive any
  signature you can write, because they are facts about time and about a set of
  modules, not about a call.
- **Q3 — count the construction sites first.** `PrototypeVariant` has **2**.
  `TwinVariantTabs` is a different type with **1**. A type change here is correct
  and its blast radius is three call sites; it is not the leverage.

So: make the lazy boundary unrepresentable-otherwise, and then accept that the
leaf's real defect is **an absence of a deletion**, which §9 shows is not
gateable by counting.

---

## §5 Anti-patterns

**A. A static import of a losing variant.** The chunk that carries the surface
carries every direction anyone ever tried. §7 D2 measures it at 81,316 B.

**B. A hand-rolled `<button>` row for the strip.** You will not add
`role="tab"`, `aria-selected` or arrow keys to scaffolding, and you will be
right not to bother — which is exactly why the strip must come from the
primitive that already has them. Measured: **0 ARIA attributes and 0 keyboard
handlers across both switchers**; `SegmentedTabs` has 9 at `:107-160`.

**C. English labels "because it's temporary".** 13 strings, 114 days, 14
locales. And note *which* strings: `label` and `subtitle` sit in an object
literal, which `custom/no-hardcoded-jsx-text` cannot see at all — it has only
`JSXText` and `JSXAttribute` visitors.

**D. A `variants/` directory or a `*Variant` filename as the record of what is a
variant.** It is not a record; it is a residue. §0, §9.

**E. Variants that are not capability-equivalent.** §7 D5. The switcher's own
type says nothing about it and no test asserts it, so the user discovers it by
losing a button.

**F. A selection that does not survive a remount.** Every research-lab tab is a
`lazy()` route that fully unmounts on nav-away (`ResearchLabPage.tsx:11-18`), and
`PrototypeTabs` holds the choice in `useState` — so leaving the tab and coming
back silently returns the user to Baseline mid-comparison. `TwinVariantTabs`
persists; `brainiac`'s persists *and* puts it in the URL.

**G. "Throwaway" with no date.** The word appears in **7 files** in `src/`; in 5
of them it describes a buffer or a temp object, and in 2 it describes a shipped
switcher. The word carries no information a reader or a tool can act on.

---

## §6 Evidence — the site to copy

**`src/features/plugins/twin/sub_tone/TonePage.tsx` (21 lines) together with
`src/features/plugins/twin/variants/TwinVariantTabs.tsx`.**

```tsx
const ToneAtelier  = lazy(() => import('./ToneAtelier'));
const ToneConsole  = lazy(() => import('./ToneConsole'));
const ToneBaseline = lazy(() => import('./ToneBaseline'));

export default function TonePage() {
  return (
    <TwinVariantTabs storageKey="tone">
      {(variant) => (
        <Suspense fallback={<RouteChunkSkeleton />}>
          {variant === 'atelier'  && <ToneAtelier />}
          {variant === 'console'  && <ToneConsole />}
          {variant === 'baseline' && <ToneBaseline />}
        </Suspense>
      )}
    </TwinVariantTabs>
  );
}
```

What each line is doing, and why it is the exemplar:

- `:5-7` — **three chunks.** 54,292 B of variant source, of which the user
  downloads only what they select. The two research-lab surfaces have the
  identical shape and pay for all of it (§7 D2).
- `:11` — a render prop rather than a `variants` array, so the switcher owns the
  union and the page owns the mapping. `TwinVariantId` (`TwinVariantTabs.tsx:7`)
  is a closed three-member union; adding a fourth is a compile error at the
  `select` call, the `VARIANTS` array and the rehydrate guard simultaneously.
- `:12` — one `Suspense` around the whole body with a **geometry-matched ghost**,
  per [page-loading](./page-loading.md) — not `fallback={null}`, which is what 25
  sites elsewhere in the repo do ([lazy-route-chunk](./lazy-route-chunk.md) §7 B).
- `TwinVariantTabs.tsx:35-41` — the rehydrate arm: `raw === 'atelier' || raw ===
  'console' || raw === 'baseline'`, else `defaultVariant`. This is the compliant
  form of [view-state-persistence](./view-state-persistence.md)'s
  `durable-view-token-with-no-rehydrate-arm`, and it is worth naming as such:
  **throwaway scaffolding got a durable-state detail right that two production
  store slices did not.**
- `TwinVariantTabs.tsx:49-51` — labels and hints from `t.twin.variantTabs.*`,
  **7 keys present in all 14 locale catalogs** (verified by counting
  `twin.variantTabs` in each of `src/i18n/locales/*.json`: 7, fourteen times).

---

## §7 Deviations

### The population, and how it was enumerated

Two independent full-history walks, because a single one is not trustworthy here
and the two disagreed in an instructive way (§12.5).

**Population definition, stated exactly** — every path that has ever existed
under `src/` ending `.tsx` whose directory is literally `variants/` **or** whose
basename contains `Variant` as a capitalised word. That vocabulary is derived
from the tree (it is the spelling the repo's own deleted switchers used), not
from imagination, and **§9 is about how badly it performs.**

| | count |
|---|---:|
| variant modules ever in `src/` (rename-aware single-pass) | **102** |
| consolidated (deleted) | **94** |
| still in the tree | **8** |
| deleted-variant lifetime — min / median / mean / max (days) | **0 / 0 / 5.2 / 95** |
| of the 8 survivors: **behind a live switcher** | **0** |
| of the 8 survivors: sole renderers (winners that kept the name) | **7** |
| of the 8 survivors: the switcher component itself | **1** |
| modules actually behind a live switcher today, by reading the switchers | **7** — and **none** matches the naming convention |

The 7 survivors, each verified by opening its importer: `ucClockVariant.tsx`
(→ `ucTimeCard.tsx:7`), `TeamStudioSplitVariant.tsx` (→ `TeamCanvas.tsx:41`),
`TrendVariant.tsx` (→ `FactoryPage.tsx:25`), `RadioConsoleVariant.tsx`
(→ `RadioPage.tsx:54`), `MastermindHexMosaic.tsx` (→ `MastermindPage.tsx:841`),
`MosaicIsland.tsx` (→ `MastermindHexMosaic.tsx:12`), `TriageDeckVariant.tsx`
(→ `QuickAnswerPopover.tsx:104`). **Each has exactly one importer and no
sibling alternative.** They are not deviations; they are the *evidence that
consolidation works*, wearing a misleading name.

**The 7 that are switchable:** `LiteratureSearchPanel{Atelier,Workbench}`,
`ResearchProjectList{Atelier,Cartograph}`, `Tone{Atelier,Console,Baseline}` —
plus two `Baseline` variants defined inline in their host files, so the honest
figure is **9 variants across 3 surfaces**.

---

**D1 — P1. Two switchers where there should be one, and the one with three
render sites is the worse one.** `PrototypeTabs.tsx` (research-lab, 2 sites) and
`TwinVariantTabs.tsx` (twin, 1 site) are 59 and 97 lines of the same idea. The
research-lab one lacks persistence, i18n, a closed id union, and a validated
rehydrate. *Fix:* delete `PrototypeTabs`; point both research-lab surfaces at
`TwinVariantTabs` (whose `TwinVariantId` union would need widening) or, better,
finish the rounds.

**D2 — P1, and the leaf's own dimension. 81,316 B of unselected variant source
is imported statically inside two lazy chunks.**

| chunk | host (always needed) | non-default variants, **statically imported** | share of chunk |
|---|---:|---:|---:|
| `research-lab/literature` | `LiteratureSearchPanel.tsx` 11,797 B | `…Atelier` 19,418 + `…Workbench` 20,380 = **39,798 B** | **77%** |
| `research-lab/projects` | `ResearchProjectList.tsx` 11,849 B | `…Atelier` 23,115 + `…Cartograph` 18,403 = **41,518 B** | **78%** |
| `twin/tone` | `TonePage.tsx` 754 B | 3 × `lazy()` — **0 B until selected** | **0%** ✅ |

Source bytes, not gzipped bundle bytes — the ratio is what matters and it does
not depend on the compressor. Both research-lab panels are themselves `lazy()`
(`ResearchLabPage.tsx:12-13`), so this is not main-bundle weight; it is
**four-fifths of a route chunk, downloaded and parsed, for directions the user
did not ask for.** *Fix:* three `lazy()` lines per host, copied from
`TonePage.tsx:5-7`.

**D3 — P1. 13 hardcoded English strings, and ESLint reports zero of them.**
`PrototypeTabs.tsx:33` (`Prototype`, a JSX text node), plus 6 in
`LiteratureSearchPanel.tsx:30-32` and 6 in `ResearchProjectList.tsx:27-29`
(`label` + `subtitle` per variant: *"Baseline" / "Current list"*, *"Atelier" /
"Hero source + chronology"*, *"Workbench" / "Index cards on corkboard"*, …).
`npx eslint` over all four switcher-family files returns **no output at all**.
Two independent causes, both structural:

- The 12 object-literal strings are `Property` values. `no-hardcoded-jsx-text.cjs`
  has only `JSXText` and `JSXAttribute` visitors; a `label:` in a `variants={[…]}`
  array is invisible to it by construction.
- `Prototype` **is** a `JSXText` node and is still exempted, by
  `no-hardcoded-jsx-text.cjs:83` — `/^[a-zA-Z_][a-zA-Z0-9_]*$/` with
  `length <= 20` returns *non-translatable*. This is
  [doctrine §5](../golden-path-doctrine.md)'s symmetry problem exactly: **a
  proper noun and an untranslated one-word label are the same bytes.** See §12.4
  for the corpus cross-check and the number this replicates.

Contrast: `t.twin.variantTabs` carries **7 keys × 14 locales**, complete.

**D4 — P2. Neither switcher has one accessibility attribute.** Grepped for
`role=`, `aria-*`, `tabIndex`, `onKeyDown`, `id=` across both:
`PrototypeTabs.tsx` **0 hits**, `TwinVariantTabs.tsx` **0 hits**. Both render a
row of bare `<button type="button">`. `SegmentedTabs.tsx` has `role="tablist"`,
`aria-label`, `aria-orientation`, `role="tab"`, `id`, `aria-selected`,
`aria-controls`, `aria-label`, roving `tabIndex` and `onKeyDown` at `:107-160`.
*Fix:* adopt `SegmentedTabs` — **but read [tab-strip](./tab-strip.md) D1 first**,
because 21 of 21 of its call sites ship a dangling `aria-controls`, so adopting
it naively trades no-semantics for wrong-semantics. Declare the panel.

**D5 — P1, and the one nobody would find by reading the switcher.
`ResearchProjectListCartograph.tsx` silently drops a feature its siblings have.**
Capability markers counted per variant file:

| marker | `ResearchProjectList` (baseline) | `…Atelier` | `…Cartograph` |
|---|---:|---:|---:|
| `syncToObsidian` | 2 | 2 | **0** |
| `syncDailyNote` | 2 | 2 | **0** |
| `deleteProject` | 2 | 2 | 2 |
| `setActiveProject` | 2 | 2 | 2 |

`ResearchProjectList.tsx:55-69` builds `handleSync` from both store actions and
renders it at `:190`. `Cartograph` has neither the actions nor any button — a
grep of that file for `sync`/`Obsidian` returns only `handleDelete`. The Obsidian
sync affordance **exists or does not depending on which prototype tab you last
clicked**, and nothing declares that the variants should be equivalent. Two
smaller instances of the same shape: `SignalMeter` is used by the literature
Baseline and by neither variant; `debtText` by Baseline and Workbench but not
Atelier. *Fix:* per §4 step 7 — diff the capability sets, then fix or declare.

**D6 — P2. "Throwaway scaffolding", 114 days.** Both switchers born 2026-04-25
(`git log --follow`, `c3cbe48ab` / `8cf3f3d5a`), which
[`tab-strip.md` D10](./tab-strip.md) also records and this path independently
reproduces. Against a **median consolidated-variant lifetime of 0 days**, these
two are not a slow round; they are a round that never ended. *Fix:* pick the
winners. This path deliberately does not recommend "add a reminder" — §9 explains
why that instrument would be a no-op here.

**D7 — P3. The naming residue.** 7 of 8 surviving `*Variant*`/`variants/`
modules are sole renderers. `MosaicIsland.tsx` is imported only by
`MastermindHexMosaic.tsx`, which is imported only by `MastermindPage.tsx` — a
two-deep `variants/` tree with no variant in it. `personas-web` has the identical
residue (`team-canvas/variants/` holding one statically-imported file, §10).
*Fix (free, non-destructive):* rename on consolidation, as §4 step 8 says. Until
that is habit, **no tool can distinguish a variant from a winner by name**, which
is §9.

---

## §8 Gaps — what the primitives genuinely cannot do

1. **No primitive can express "this expires".** TypeScript has no lifetime on a
   module, ESLint has no clock, and the census counts what exists rather than how
   long it has existed. The only artifact in the repo that couples code to a date
   is `git`, and nothing reads it. §9 specifies the instrument that would.
2. **`SegmentedTabs` cannot be adopted without also fixing its panel contract.**
   It emits `aria-controls` unconditionally at an auto-generated id
   ([tab-strip](./tab-strip.md) §0), so a switcher that adopts it inherits a
   dangling reference unless the host declares a panel. That is a real blocker on
   D4, not an excuse — but it means D4 is two edits, not one.
3. **There is no router, so a variant cannot be deep-linked.** Confirmed against
   `package.json`: no `react-router`, no `@tanstack/router`, no `wouter`. So
   `brainiac`'s best clause (`?variant=`) is **unavailable here**, and the
   substitute — `localStorage` — cannot be shared, screenshotted with its state,
   or opened by a reviewer. This is a genuine capability the fleet has and this
   app does not.
4. **Nothing can assert that two variants are capability-equivalent.** D5 is
   found by counting store-action references, which is a heuristic, not a proof.
   A real check needs the two components' effect surfaces compared, and the
   variants deliberately differ in structure, which is the whole point of a
   variant. **The honest fix is a human step in the round's exit checklist**, and
   it belongs in `.claude/skills/prototype/SKILL.md`, not in a linter.
5. **`npm run check:themes` cannot see a missing token, and does not run in
   `npm run check`.** Established while testing the brief's theme hypothesis
   (§12.2) and recorded here because it is a real gap in a neighbouring gate: it
   resolves each theme by *layering overrides on `:root`*, so a token a theme
   never declares is invisible by construction, and it inspects **9 hardcoded
   token pairs** out of a 90-property surface. It also appears in
   `.github/workflows/ci.yml:144` and in **neither** `npm run check` nor
   `lefthook.yml`. Handed to [theming-and-contrast](./theming-and-contrast.md).

---

## §9 The missing gate — **declined, with the numbers that refused three
## candidate rules**

Per the [contract](../golden-path-contract.md), a reasoned decline with
measurements is a better §9 than a weak rule. This leaf produced three
candidates and all three failed measurement in different, informative ways.

### Candidate 1 — key on the naming convention. **Refused: 0/8 precision, 0/7 recall.**

The obvious rule is *"a file under `src/` named `*Variant*.tsx` or living in
`variants/`"*, ratcheted downward as rounds consolidate. Measured against the
tree on 2026-08-17:

- the pattern matches **8** files;
- **7** are consolidation winners with exactly one importer and no alternative —
  false positives;
- **1** is `TwinVariantTabs.tsx`, the switcher, not a variant — also a false
  positive;
- the **7 modules that are actually behind a live switcher** —
  `LiteratureSearchPanel{Atelier,Workbench}`,
  `ResearchProjectList{Atelier,Cartograph}`, `Tone{Atelier,Console,Baseline}` —
  match **none** of it.

**Precision 0/8. Recall 0/7. The signal and the condition are disjoint.** This is
[doctrine §2](../golden-path-doctrine.md)'s vocabulary-bounded-recall warning in
its strongest measured form — not "the word list misses the interesting cases"
but "the word list and the condition have empty intersection" — and it happens
for a reason that is structural rather than sloppy: **the convention is applied
at birth and the condition is decided at consolidation**, so the name records
what a module *was proposed as*, never what it *is*.

### Candidate 2 — key on the structure. **Refused: 19 of 22 matches are correct code.**

A TypeScript AST pass over all 2,083 non-test `.tsx` for a module that alternates
at runtime among ≥2 imported whole-surface renderers — guarded render
(`v === 'a' && <A/>`), a `render: () => <X/>` registry, or a switch — finds **22
files**. Exactly **3** are variant switchers (`LiteratureSearchPanel`,
`ResearchProjectList`, `TonePage`). The other 19 are navigation tab strips —
`TwinPage`, `DevToolsPage`, `TriggersPage`, `FleetPage`, `ObsidianBrainPage`,
`CompanionPluginPage`, `ArtistPage`, `DesignHub`, `EditorBody`,
`CapabilityRowTabs`, `FactoryProjectTabs`, `TriggerAddForm`,
`RecipePlaygroundModal`, `BrainAtelier`, and five registry-shaped cell/column
tables.

**Precision 3/22 = 13.6%.** And the reason is not a weak pattern: **a design
variant switcher and a tab strip are the same program.** The difference is
entirely in what the branches *mean* — alternative renderings of one surface
versus different surfaces — and that lives in the author's head and in the
variants' blurbs. No AST can recover it. This is the sharpest thing this leaf
has to say about gating, and it is why candidate 3 was tried at all.

### Candidate 3 — key on the self-declaration. **Refused: 2/7 precision, and the wrong end state.**

The only artifact that separates scaffolding from product is the comment the
author wrote. Searching all 4,801 `.ts`/`.tsx` comment bodies for
`throwaway` / `once a winner` / `temporary (component|file|strip|wrapper|scaffold)`
/ `scaffolding … remove` yields **7 files**. Two are the switchers. Five are
unrelated — a throwaway buffer in `audioToReferenceWav.ts`, a throwaway object in
`factoryModel.ts`, a throwaway id in `useDeckControls.tsx`, a test fixture, a
drawer note. **Precision 2/7 = 29%**, and tightening to *"throwaway" AND
("scaffolding" | "variant" | "prototype")* gives 2/2 — at which point the rule
matches two files and **the correct end state is zero**, which
[doctrine §4](../golden-path-doctrine.md) says the census cannot express: a rule
matching nothing fails structurally, so the moment the operator does the right
thing the gate breaks.

### What to build instead — an expiry checker, not a ratchet

The condition is *"a module declared temporary is still here on date D"*. That is
a **predicate over `git` and a clock**, not a count over source, so it needs a
script and not a census entry. Specification, so the next author does not
re-derive it:

- **Marker, machine-readable, not prose.** A single line the author must write to
  create a switcher: `// @scaffolding expires:2026-09-25 owner:<round>`. Deriving
  it from `git log --follow` alone is wrong — a rebase, a move or a squash resets
  the date, and this repo moved both switcher files on 2026-05-24 (§12.5).
- **Mechanism.** `scripts/check-scaffolding-expiry.mjs`, run in
  `npm run check`. Exit 1 past the date; print days remaining otherwise.
- **How it fails loudly when its own precondition is absent** — the requirement
  [`ci.yml` is a museum of gates that missed](../golden-path-contract.md). Two
  guards: **exit 2 if the walk sees fewer than 4,000 files** (the matcher is
  broken, not the tree clean), and **exit 2 if it finds zero markers while
  `PrototypeTabs.tsx`-shaped scaffolding exists** — concretely, if any file
  contains `throwaway` in a comment and carries no `@scaffolding` marker, the
  *checker* is out of date, not the code. Without the second guard this script
  becomes a green no-op the first time someone writes scaffolding without the
  marker, which is precisely the failure mode candidate 3 would have shipped.
- **Allowlist.** None. A permanent exemption is a statement that the module is
  product, and the correct edit is to delete the marker and rename the file.

**This is a specification, not an application** — writing the script and wiring
it into `npm run check` changes whether the build passes, which is held under the
campaign's standing rule.

### Existing rules checked for overlap, and named

`tabstrip-with-no-declared-panel` (tab-strip) — **site-level overlap checked, not
file-level**: it anchors on `SegmentedTabs`/`PanelTabBar` JSX, and neither
switcher mounts either, so the intersection is empty and would remain empty after
D4 is fixed only if the panel is declared. `durable-view-token-with-no-rehydrate-arm`
(view-state-persistence) — anchored on store `partialize` entries; `TwinVariantTabs`
uses `localStorage` directly and is the *compliant* form of that condition, not a
match. `raw-web-storage` — matches `TwinVariantTabs.tsx:37,45`; **that overlap is
real and is not a problem**, because a switcher's `localStorage` use is exactly
what that rule is counting and this path endorses it. `catalog-boundary-escape`
(shared-component-boundary) — neither switcher is in `shared/components/`.
`looping-framer-animation`, `typo-token-overpainted`, `hand-rolled-disabled-state`
— zero matches in either file.

---

## §10 Convergence — the label is **`mixed`, and it holds, for once**

Cohort established for this leaf at measurement time: `personas-web` (Next.js),
`brainiac` (Rust + Next.js console), `personas-cloud`, `vibeman`, `ascent`.
Lineage checked per doctrine — the finding below is **not** a port: `brainiac`'s
switcher shares no comment, no constant, no error string and no prop name with
either Personas switcher, and its central mechanism (the URL) is one this repo
cannot express.

**The independent reinvention: `brainiac/console/src/design/PrototypeSwitcher.tsx`,
158 lines.** Same author, different stack, arrived at the same object — and at
three clauses this repo does not have:

| clause | `brainiac` | Personas |
|---|---|---|
| choice in the **URL** (`?variant=`), so a round is shareable by link | ✅ `:52-56` | ✗ — no router exists (§8.3) |
| choice in `localStorage` too | ✅ `:43-46` | ✅ Twin only |
| rehydrated id **validated against the variant list** | ✅ `:45` | ✅ Twin only |
| **Baseline is always the default**, stated as a rule with a reason | ✅ (docstring) | ✅ in practice, undocumented |
| **scale toggle** — `?scale=large` swaps in a deterministic several-hundred-item corpus | ✅ `:59-65` | ✗ **nothing like it anywhere in this repo** |
| exit condition names the authority | ✅ *"DELETE THIS FILE when the round consolidates … per the prototype skill's exit checklist"* | partial — *"throwaway scaffolding"*, no date, no authority |

The scale toggle is the most valuable thing in this document that did not come
from this repo, and it comes with its own warrant, written in the file: *"every
one of these surfaces was designed against a fixture org of a dozen items and
quietly falls apart at organizational scale — so each variant must be inspectable
at both sizes, on demand, without a database."* That is a **cost observation** —
a sibling paying a measured price and building a mechanism to stop paying it —
which [doctrine §5](../golden-path-doctrine.md) ranks among the strongest signals
the oracle produces, and far above agreement. **It is added to §2 as clause (f)'s
neighbour and it is a gap in Personas, not a nicety.**

**The other half of `mixed`: a fleet-wide silence on the lifecycle.**
`personas-web` has a `components/sections/team-canvas/variants/` directory
containing **one** file, statically imported by `index.tsx:7`, with no switcher —
byte-for-byte the same residue as this repo's 7 survivors (§7 D7), in a repo with
no shared code for it. `personas-cloud`, `vibeman` and `ascent` have no variant
switcher at all. So: **2 of 5 siblings build the mechanism, 2 of 5 leave the
naming residue, 0 of 5 have anything that deletes scaffolding.** The fleet
converged on the disease for the lifecycle half and Personas is behind
`brainiac` on the mechanism half — which is exactly what a `mixed` label should
mean.

**`convergence: "mixed"` is upheld, and this is the second spine convergence
label the corpus has confirmed** (after
[`ai-draft-preview-apply`](./ai-draft-preview-apply.md)). Reported as loudly as
the thirteen failures, per doctrine. It survives for the same reason that one
did: it was tested clause by clause rather than as a single verdict.

---

## §11 Interaction with adjacent paths

- **[tab-strip](./tab-strip.md)** — the parent. Its D10 owns *"two throwaway
  switchers are 114 days old"* and this path does not restate it as a finding;
  everything here is downstream of it. **One tension:** its §2 says *render the
  row with `SegmentedTabs`*, and §7 D4 here says the same — but its own D1 says
  21 of 21 `SegmentedTabs` sites ship a dangling `aria-controls`. **Following
  both prescriptions naively makes a variant switcher's accessibility worse, not
  better.** Declare the panel, or you have traded silence for a lie. Named here
  because the contract asks composers to check what happens to someone who
  follows both.
- **[lazy-route-chunk](./lazy-route-chunk.md)** — §7 D2 is an instance of its
  condition. Its §2 warns that a raw `React.lazy` caches a rejected import
  promise permanently and prescribes `lazyRetry`; `TonePage.tsx:5-7` uses raw
  `lazy`, so the exemplar this path names is **already listed as a deviation
  there** (105 sites / 38 files). Both are right: copy `TonePage`'s *shape* and
  its `lazyRetry` fix when that path's backlog reaches it.
- **[view-state-persistence](./view-state-persistence.md)** — `TwinVariantTabs`'s
  validated rehydrate is the compliant form of its rule. Offered upward as an
  exemplar it does not currently cite.
- **[i18n-string-authoring](./i18n-string-authoring.md)** — owns D3's cause. See
  §12.4; this path adds a split its §7.D does not carry.
- **[theming-and-contrast](./theming-and-contrast.md)** — owns §8.5 and §12.2.
- **[design-token-usage](./design-token-usage.md)** — `TwinVariantTabs.tsx:76`
  paints the active pill `bg-violet-500/20 text-violet-300` (raw scale) while
  `PrototypeTabs.tsx:44` uses `bg-primary/15 text-primary` (semantic). The worse
  switcher is the better token citizen; recorded so nobody copies the wrong half
  of the wrong file.

---

## §12 Corrections owed

### 12.1 To this composer's brief — the framing was pointed at the wrong object

The brief said the enforcement story was *"the theme of today's wave"* and
supplied `custom/enforce-base-modal` at precision 0/8 and recall 0/19, the
`no-raw-*` share of the lint baseline, and the `--max-warnings` mechanism. All of
that is true and **none of it is this leaf's condition.** The leaf is
`why: "keeping several explored directions switchable without shipping dead
surfaces"` — a **lifecycle** problem, not a token or a lint problem. The brief's
one directly-usable instruction was *"establish what `check:themes` actually
asserts"*, and the answer is in §8.5 and belongs to a neighbouring path.

Where the brief's shape *did* pay off is unexpected and worth recording: its
`enforce-base-modal` precision/recall figure told me to measure candidate 1 the
same way rather than assume the naming convention worked — and candidate 1 came
back at **0/8 and 0/7**, worse than the example that prompted the check.

### 12.2 To this composer's brief — the theme-token hypothesis, tested and **not** confirmed

The brief asserted: *"A variant switcher's real failure is a token defined in one
theme and not the other, which renders as an invisible control rather than an
error. That is checkable: enumerate the token sets per theme and diff them."*

**Enumerated, twice, by two structurally different instruments** — (a) locate
each selector with a regex then brace-match its body; (b) a character-wise
selector-stack machine that attributes each `--name:` declaration to its
innermost enclosing selector. **What was enumerated, named precisely per the
brief's own warning: CSS custom-property *declaration sites* inside each theme
selector block in `globals.css` — not "tokens the theme uses" and not "tokens the
theme needs".**

| selector | declarations |
|---|---:|
| `:root` | **90** |
| `[data-theme="light-ice"]` | 38 |
| `[data-theme="light-news"]` | 34 |
| `[data-theme="light"]` | 33 |
| `[data-theme="dark-{bronze,purple,pink,red,matrix}"]` | 26 each |
| `[data-theme="dark-cyan"]` | 21 |
| `[data-theme="dark-frost"]` | 19 |

So **every theme "misses" 52–71 of `:root`'s 90 declarations**, and
`[data-theme="light"]` inherits **58**. On the brief's hypothesis that is a
catastrophe. **It is not a defect at all.** A theme is a partial override by
design; `check-themes.mjs` resolves each theme by layering its overrides on
`:root` and computes contrast on the *effective* map, which is the correct
model. The 12 colour-bearing names the light theme inherits are 7
`--status-*-raw` tokens plus `--btn-primary-fg` and the focus-ring triple — and
the `-raw` tokens are inherited **on purpose**: `globals.css:916-934` re-derives
every light-theme status colour as
`color-mix(in srgb, var(--status-*-raw) 82%, white)`, keyed on the brightness
setting. Inheriting the base is the mechanism, not an omission.

**The hypothesis is refuted.** What survives from the exercise is §8.5 — a real
gap in `check:themes` (9 hardcoded pairs, blind to absence, absent from
`npm run check` and `lefthook.yml`) — which is handed to
`theming-and-contrast.md` rather than claimed here.

### 12.3 To the spine — `sides: "client"` **holds**, and names the reason

The eighth `"client"` test in the corpus, and the first to survive. It holds for
the same structural reason the two prior upholdings did: **the server never sees
the DOM.** A design variant is a rendering of data the server has already sent;
there is no server-side half to omit, no IPC contract, no column. Every
deviation, the exemplar, all three refused rule candidates and the convergence
finding are client-side. `twoSided: false` is likewise correct.

Recorded precisely because the field has been contradicted seven times: the
discriminator that predicts an upholding is *"is the subject the DOM itself"*,
and this leaf is a third data point for it.

### 12.4 To [`i18n-string-authoring.md`](./i18n-string-authoring.md) §7.D — a replication and a refinement, not a correction

Before claiming §7 D3's `Prototype`-is-invisible finding as new, the corpus was
checked. **It is already published**: that path's §7.D table carries *"Single
words ≤ 20 chars — `isNonTranslatable` (`:83`) … **601 occurrences, 396 distinct
words**"*, and its §"C4" already prescribes the exact fix (delete the
`length <= 20` identifier branch). This composer's independent AST pass over
2,083 `.tsx` measured **594 exempted single-word JSX text nodes** — a near
replication from a different walk with slightly different exclusions, which is
worth having.

The refinement that path does not carry: **342 of the 594 (57.6%), across 186
files, begin with a capital letter** — i.e. they read as UI copy rather than as
an identifier or a glyph. Sampled: `Copy`, `Cancel`, `Delete`, `Refresh`,
`Disconnect`, `Pause`, `Enable`, `Send`, `Retry`, `Budget`, `Cost`, `Persona`,
`Live`, `Webhook`. Against the **229** nodes the rule *does* flag, the
capitalised blind spot alone is **1.49×** everything it reports. If C4 ever gets
sequenced, that split is the one to size it by.

### 12.5 A disagreement between this composer's own two history walks — each right about a different half

The two full-history instruments disagreed on **both** the population and the
dates, and neither was simply wrong:

| | walk A (`git log --follow` per path) | walk B (one `--name-status` stream) |
|---|---:|---:|
| population | 101 | **102** |
| consolidated | 80 | **94** |
| still shipping | 7 | **8** |
| `TwinVariantTabs.tsx` birth | **2026-04-25** | 2026-05-24 |
| `TeamStudioSplitVariant.tsx` birth | **2026-05-23** | 2026-06-05 |

- **B is right about the population.** A resolves each path's add-date with
  `--follow`, which cannot answer for a path that no longer exists in `HEAD`; it
  silently produced no add-date for **14** deleted files and A's own filter then
  dropped them. A reported 80 consolidated where the true figure is 94 — an 15%
  undercount that looked entirely plausible.
- **A is right about the dates.** B treats a rename as a death and a birth, so
  both switchers — moved into their current directories on 2026-05-24 — appeared
  **29 days younger** than they are. A's `--follow` figure (2026-04-25) is the
  one that matches `tab-strip.md` D10's independently-obtained
  `c3cbe48ab`/`8cf3f3d5a`.

Published figures therefore use **B for the population and A for every age**, and
the split is stated rather than smoothed. The general lesson, and the reason this
is in §12 rather than a footnote: **`--follow` and a single-stream walk answer
different questions, and both answers are shaped like the one you asked for.** A
composer that ran only one of them would have published a confident number with
no signal that anything was wrong — which is [doctrine §2](../golden-path-doctrine.md)'s
"two passes can agree because both searched the same wrong place", in the mirror.

### 12.6 What this path deliberately does **not** claim

`tab-strip.md` D10 asks for the winners to be picked and both switcher files
deleted. This path does not repeat that as its own finding and does not apply it:
choosing between `Atelier`, `Workbench`, `Cartograph`, `Console` and `Baseline`
is a product decision belonging to the operator, and deleting four shipped
surfaces changes what a live surface shows. Held under the standing rule. What
this path contributes instead is the **cost of not choosing** — 81,316 B, 13
untranslated strings, one silently-missing feature, and a naming convention that
has gone `0/8` — so that when the choice is made, its value is known.
