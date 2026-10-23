# Lifecycle Lens: migration plan

**Decision (2026-10-16):** contest `lifecycle-portfolio-r2`, winner **A/3 "Lens"**, with two changes the owner asked for:

> "A/3 is the winner, prepare migration plan with differences to have header section with fixed height. As it changes with each content type it manipulates now with DOM. Detail window on column item click then could become last nested layer instead of expanding on top of the columns so it has enough space to spread and style its content"

Winner source (git-ignored, kept by `wrap`): `.contest/arena/lifecycle-portfolio-r2/entries/claude-claude-opus-5-5_high-v2/variant-3/` (`index.html`, `model.js`, `words.js`, `art.js`, `NOTES.md`). Screenshots: `.contest/arena/lifecycle-portfolio-r2/archive/A-3/shots/`. Real data it was built on: `.contest/staging/lifecycle-portfolio/data/`.

What it replaces: `src/features/plugins/dev-tools/sub_lifecycle/` (the Layer 1 collar rail and the Layer 2 step screen, under `LifecyclePage.tsx`).

**Owner's decisions on the open questions (2026-10-16):**
1. "No active project selection": opening a project in the Lens never changes the app-wide active project. Lifecycle keeps its own focus (`lens/model/lensFocus.ts`).
2. "Plan approved": the Measure history figure moves into the Gate and Tests detail and leaves the project level.

## As built (2026-10-16): what differs from this plan, and why

- **No new Rust command (section 4).** The portfolio reads every project through the existing `dev_tools_get_lifecycle`, four at a time, through the page's own snapshot cache (`lens/data/usePortfolio.ts`). The 25-project payload is about 600 KB, a project opened next is already warm, and no Rust build or binding changed. Section 7's cost risk stands. If the reads prove slow on a larger portfolio, the batch command is still the next step.
- **No broken-count parsing (section 4).** A failure is ranked by its size in failing samples, computed from the figure's rate and `n` (`portfolioModel.failureSize`). The Docs reason string is shown, never parsed.
- **The project's actions sit in the header's right column, not the top bar (section 3).** At 1280 wide the top bar could not hold the trail and all five controls. The column wraps inside the header's fixed height.
- **No separate "last 20 changes" list on the detail (section 2).** The evidence steps' preset already tells that story (`presets/evidence/ChangeTimeline`), and so does the Docs change log.
- **No worktree (section 6).** The operator's standing rule allows one Personas worktree beside main (`sim-app`), so the work was done in the main checkout.
- **The setup checklist heads the Gate and Tests detail.** It is not a leaf of its own.
- **Verification ran in the page harness** (real components, real stylesheet, Vite), not the running app, for two reasons. The app was not running, and port 17320 was held by a process that could not be listed. Real data came from a local tape built from the 2026-10-16 capture of the 25 projects. The tape is never committed.
  - `scripts/style/lifecycle-lens-geometry.mjs` asserts the header (177.4 px) and the plane's top (y=279) are identical on every plane and on hover, at 1280x800 and 1920x1080, and that the detail has no columns in the document.
  - `lifecycle-a11y.mjs` passes on four themes.
  - `lifecycle-perf.mjs`: a hover sweep over 200 cells costs 1 commit (0.4 ms); a quiet revision costs 4.2 ms.

---

## 1. What we keep from A/3, and what changes

| | A/3 as built | The product version |
|---|---|---|
| **Columns** | Ten step columns. Each cell is a project on the portfolio plane and a commit on the project plane. Lit cells, lane rule, `fault` back-light on a failing step. | **Kept as is.** The column strip is the navigation instrument on both planes. |
| **Selection** | The selected column grows to `flex-grow: 9`, lifts by `translateY(-.375rem)`, and draws its list inside itself (`.col.lens > .lensbody`), as a raised panel over the strip. | **The column is lit but not magnified.** It keeps the lens light (top glow, accent or red border, watermark icon behind the cells), and its width changes by a bounded amount (about 1.6x). The list it drew moves to the detail layer. |
| **Detail** | Lives inside the lens: about 520 px wide at 1280, scrolling inside a card, cut off at the fold (`personas-web` row clipped at y=770). | **The last nested layer.** Clicking a column item opens a full-width detail plane. The columns leave the field (the camera moves in), and the detail gets the whole body width to lay out its content. |
| **Header** | `section.head` is rebuilt with `innerHTML` on every hover (`headStep`, `headProject`) and on every level (`headDefault`). Its contents differ per state: a 96 px rosette or none, a one- or two-line lede, an orange note. The field below moves (top at y=228 on the portfolio, y=220 on the project). | **One header with a fixed height across every level and state**, rendered by React into fixed slots. Hover never rewrites the headline. It writes one reserved readout line, which changes by opacity only. See section 3. |
| **Levels** | 2 planes: Portfolio, then Project. | **3 planes plus one sibling leaf.** Portfolio, then Project, then Detail. The portfolio step detail is a leaf at the same depth. See section 2. |
| **Intro** | Cells light column by column. A "Skip intro" chip overlapped the caption. | The light-up stays, on the first entrance per session only (`system/entrance`). **The chip is dropped**: the intro runs under 2 s, and any key or click skips it. |
| **Code** | String HTML: 59 `esc(` calls, 15 `innerHTML` writes, 19 hex and 19 `rgba(` literals, 6 document-level listeners. The status and outcome maps are typed in `model.js` and again in `words.js`. | Rebuilt under `port-quality.md` Q0 to Q5. React, tokens, one status map. Nothing is copied. |

---

## 2. The layer model

```
L1  Portfolio      every project x ten steps (cells = projects)
 |    click a cell  ------------------------------->  L2 Project
 |    click a column head / Enter on a column  ----->  L3' Step across the portfolio  (leaf)
 |                                                         row -> L2 Project (that project, same step)
L2  Project        one project x ten steps (cells = its last 20 commits)
 |    click a cell, a column head, or Enter  ------->  L3 Detail (project x step)    (leaf)
L3  Detail         full width: the step's verdict, the rule, its evidence, Next, the preset, related items
```

- **Esc goes up one level.** On L3 it goes to L2 with the same step lit. On L3' it goes to L1. On L2 it goes to L1.
- **Keys mean the same at every level:**
  - ←/→ moves between steps. On L3 and L3' it walks to the next step's detail in place, as Layer 2 does today.
  - ↑/↓ moves between items: cells, rows, commits.
  - Enter goes one level deeper.
  - `[` and `]` go to the previous or next project on L2 and L3.
  - The A/3 meanings of ↑/↓ differed by level, which `port-quality.md` names as a defect.
- **The state is one table, not flags.** It is a `LensRoute` union: `portfolio | portfolioStep(stepId) | project(projectId, stepId) | detail(projectId, stepId, focus?)`. Transitions are a data table (`lensRoutes.ts`), tested row by row, and replace `openStepId` and `selected` in `useLifecycleView`.
- **Deep links land on L3.** The existing `StepFocus` openers (`commands`, `coverage`, `run:<id>`) come from the Overseer, Next and other surfaces. They open `detail(activeProject, step, focus)` directly.
- **L3 is the current Layer 2, rehoused.** It keeps:
  - `StepBand` with its Gate and Tests history strip;
  - `NextPanel`;
  - the Docs, Gate, Tests and Generic presets, still lazy chunks warmed on idle;
  - `RelatedItems`.

  `StepMap` (the 10-pin mini-map) gives way to the fixed header's step crumb plus ←/→. A/3's "last 20 changes" list becomes the **first section** of L3 for every step, because it is the evidence behind the verdict. It sits above the preset, with the full width to show title, sha, outcome and detail on one line.
- **L3' is A/3's portfolio lens list at full width.** Its sections:
  - Failing rows: sigil, name and qualifier, reason, size of the failure in mono, last change.
  - Quiet rows: compact.
  - The step's rule and facts at the top.

  At full width, the failing rows can be a two-column grid at 1920 instead of one clipped list.

---

## 3. The fixed-height header

One component, `LensHeader`, used by every level. Its height is set by the design scale (about 9 rem at 1280x800, scaled the A/3 way above it). **No state may change it.**

| Slot | Size | Portfolio | Project | Detail |
|---|---|---|---|---|
| Mark | 96 px square, always reserved | the portfolio mark: ten petals for the ten step verdict mixes | the project's sigil (`art.rosette`) | the step's drawn icon, lit by its verdict |
| Eyebrow | 1 line, ellipsis | `Portfolio · 25 projects · captured … · no Measure has ever run` | `Project 1 of 25 by attention · changed today · 20 changes read` | `personas · Docs · after the task · step 7 of 10` |
| Title | 1 line, ellipsis, `3rem` (never a font that fits itself) | `Docs is failing in 8 projects.` | `personas xkazm04/personas` | `Docs · Failing` |
| Lede | at most 2 lines, `line-clamp: 2`, full text in a tooltip when clamped | who to start with | the weakest step sentence | the verdict reason |
| Readout | 1 line, reserved even when empty | **hover target**: the hovered column's sentence, or the hovered cell's project and verdict | the hovered commit | empty |
| Actions | fixed row at the right of the top bar | none | Measure · Overseer · Ask Athena · Install | the same |

Rules:
- **Hover writes only the Readout line.** The text crossfades by opacity, so there is no reflow. A/3's "head is centre stage" hover becomes this line plus the cell outline across columns, which A/3 already draws.
- **No `innerHTML`, no conditional slots.** Each slot renders always, with an empty value where there is none. The "Same commit as personas (dev-mode)" note A/3 appended is a chip in the Eyebrow, not a third lede line.
- **Long running states stay in their slot.** A running Measure shows its progress in the Actions slot, where `MeasureControl` already turns into its progress, and its time left in the Eyebrow. Install shows in Actions. The setup checklist for a never-measured project opens as an L3 leaf ("Set up Measure") instead of taking a slot.
- **The test asserts geometry.** `getBoundingClientRect().height` of the header, and `top` of the field, must be identical across portfolio, hover, project, detail and a running Measure, at 1280x800 and 1920x1080. This is a Vitest DOM test plus a Playwright check in the fidelity pass. It is the owner's first requirement, so it gets an executable check, not a screenshot.

The product's `ContentHeader` and `HeaderToolbar` are replaced on this page by the top bar plus `LensHeader`:
- The top bar holds the crumb, the depth indicator, the key hints and Actions.
- `LifecycleProjectPicker` is retired, because the portfolio is the picker.

---

## 4. Data

| Need | Today | Plan |
|---|---|---|
| Portfolio: every project's step health, reasons, Docs broken count, last 20 evidence outcomes, last change | `getLifecycle(projectId)`, one project at a time | **New command `dev_tools_lifecycle_portfolio`** returning `Vec<LifecyclePortfolioRow>` (ts-rs binding), computed in one `run_blocking`. Each row carries only what L1 and L3' draw: project id, name and qualifier, preset, per-step `{health, reason, broken?}`, `evidence[0..20]` as `{sha, at, outcomes}`, `rules.minSamples`. Not the full snapshot. A bounded worker pool reads git per project. |
| Project plane | snapshot evidence | Unchanged: `useLifecycleSnapshot` with its warm cache and revalidation. |
| Detail | `useStepDetail` | Unchanged. |
| Live refresh | `lifecycleRevision` on `DEV_TOOLS_LIFECYCLE_CHANGED` | The portfolio hook revalidates on the same revision. Rows are compared by JSON as the snapshot hook does, so an unchanged reply re-renders nothing. |

Derivations from `model.js` and `words.js` move into one pure, tested module, `lens/portfolioModel.ts`:
- attention rank and band (`act` / `blind`);
- weakest step and the `RANK` order;
- Docs broken count;
- duplicate-name qualifier (three projects are named `personas`).

`brokenDocs` currently parses the reason string (`/^(\d+) docs? names? /`). The Rust row carries `broken` as a number instead, so the UI never parses prose.

The honesty rules in `.contest/staging/lifecycle-portfolio/data/SCHEMA.md` become test cases:
- no Measure has ever run, so "never measured" stays visible;
- Docs verdicts come from one scan;
- absence stays `null`, never `0`.

**Open question for the owner, before this phase:** does opening a project on L1 set the app-wide `activeProjectId`, or does Lifecycle keep its own focused project? The plan assumes **its own**, seeded from the active project when one is set, so browsing the portfolio does not move every other surface.

---

## 5. Structure, gates and budgets (port-quality Q0 to Q4)

- **Q0, inventory:** the counts in section 1, plus the duplicate maps to collapse:
  - `HEALTH` in `model.js` vs the status logic in `words.js`;
  - `OUT` vs `journeyLabels`;
  - the step names, which already exist in `stepLabel`.
- **Q1, structure:** a new `lifecycleView/lens/` folder.
  - `shell/`: `LensHeader`, `TopBar`, `Field`, `Column`, `Cell`, the camera.
  - `planes/`: `PortfolioPlane`, `ProjectPlane`, `DetailPlane`, `PortfolioStepPlane`.
  - `art/`: the sigil and step icons as React SVG components.
  - `model/`: `portfolioModel`, `lensRoutes`, `lensWords`.
  - `lens.css`: A/3's gradients, glows and pseudo-elements, kept as a stylesheet on the tokens, because that is the form the winner expressed them in (promotion rule 2).

  Presets, measure, overseer and history stay where they are and are imported by `DetailPlane`. Component files stay under 200 lines.
- **Q2, gates at zero for `lens/`, each seeded red once:**
  - no hex or `rgba(` outside `lens.css` token definitions;
  - no hardcoded JSX text (every string is `t.plugins.dev_lifecycle.*`, in all 14 locales in the same change);
  - no `innerHTML` or `dangerouslySetInnerHTML`;
  - no em dash in app text.
- **Q3, extract:** the sigil (`art.rosette`) is a candidate shared primitive. Projects appear in Dev Tools, Fleet and the Monitor, so it goes to `src/features/shared/components/` with a `@catalog` tag if a second surface adopts it in the same change. Otherwise it stays local.
- **Q4, budgets by count**, extending `scripts/style/lifecycle-perf.mjs`:
  - hovering across all 250 portfolio cells re-renders only the Readout line and the outlined cells, with zero Column re-renders;
  - a level change mounts one plane;
  - one IPC call for L1.

  `lifecycle-a11y.mjs` covers:
  - roles: columns as a listbox, cells as options, the readout as `aria-live="polite"`;
  - focus returns to the cell that was opened on every Esc;
  - reduced motion is still.

---

## 6. Phases (worktree, one commit each)

Each phase is one commit on a `worktree-lifecycle-lens` worktree, registered in `.claude/active-runs.md`, and verified with `npm run verify:affected -- --files <files>`.

1. **Contract capture.** Write the owner's roles in `roles.json`:
   - lit cells;
   - the lens light on the selected column;
   - fault back-light;
   - header slot sizes;
   - detail at full width.

   Then run `style-contract.py capture` against A/3 and add the header-height and field-top assertions as roles.
2. **Data.** Add the Rust `dev_tools_lifecycle_portfolio` command and the `LifecyclePortfolioRow` binding (`npm run test:rust -- export_bindings`), plus `src/api/devTools/lifecycle.ts` and `usePortfolio` with its cache. Rust tests cover:
   - a project with no commits;
   - a never-measured project;
   - duplicate names.
3. **Pure model.** Add `portfolioModel`, `lensRoutes` (the transition table), `lensWords` and the i18n keys in 14 locales, with unit tests that include the honesty cases.
4. **Shell.** Build `TopBar`, `LensHeader` (fixed slots), `Field`, `Column` and `Cell`, the camera transition and the key map, and write the header geometry test.
5. **L1 Portfolio and L3' Step across the portfolio.**
6. **L2 Project.**
7. **L3 Detail.** Rehouse `StepBand`, `NextPanel`, the presets and `RelatedItems`, and add the evidence list section. Move the setup checklist and the Measure panel into L3 leaves and slots, and keep the deep-link `StepFocus` working.
8. **Cut over and delete in the same commit:**
   - `layer1/rail/`, `layer1/status/`, `Layer1.tsx`, `Layer1Ghost.tsx`;
   - `TactileKeys.tsx` and the key-fly;
   - `layer2/nav/StepMap`, `LifecycleProjectPicker.tsx`;
   - `HeaderToolbar` and `HeaderSubtitle` on this page;
   - their tests, replaced by L1, L2 and L3 tests.

   Rewrite `journey/__tests__/LifecyclePage.test.tsx` and `sameData.test.tsx` against the new planes.

   Before this commit, re-read `HistorySection` (the Measure history figure on today's Layer 1). The plan moves it into L3 for Gate and Tests, where `StepBand` already carries a strip, and drops it from L2. **Confirm that with the owner.**
9. **Fidelity and live verification:**
   - `style-contract.py check` to 0 deviations;
   - drive every named interaction: hover readout, cell to project, column to detail, Esc chain, ←/→ in detail, `[` `]`;
   - `side-by-side.py` against A/3;
   - then the live app at 1280x800 and 1920x1080, dark and light. Today's Lifecycle has light-mode shots in `docs/design/lifecycle-l1/`; A/3 was only dark, so light is new design work for the `lens.css` tokens.
10. **Docs:**
    - `docs/features/plugins/dev tools/dev-tools.md`;
    - the `plugin-dev-tools` onboarding flow;
    - the marketing `plugins` module through `/guide-sync`;
    - a `CHANGELOG.md` `[Unreleased]` entry;
    - `npm run census -- --update` only for drops this change caused.

**Exit:** all of these hold at once:
- 0 style deviations, and the header height is invariant in the test;
- the interactions are driven in the live app;
- the gates are green at zero for `lens/`;
- the budgets hold;
- the old layer code is gone.

---

## 7. Risks

- **Scale of the portfolio column.** 25 cells fit at 1280x800. Past about 60 projects, cells fall under 4 px. The rule: cells keep a 4 px floor, and beyond that the column shows the attention-ranked top N plus a `+k` cell that opens L3'. Decide the N in phase 5 with the real count.
- **Portfolio cost.** The command reads git for every project. Measure it on the 25-project machine in phase 2, and fall back to a cached last-known row with a freshness stamp if it is over 1 s.
- **Light theme.** A/3 was designed only on midnight. The glows need light-theme token values, and `check:themes` must pass.
