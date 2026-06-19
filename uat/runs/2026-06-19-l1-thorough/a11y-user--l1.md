# Ben Carter — Keyboard / Screen-reader User — L1 report

- **Journey:** `first-run-onboarding` (First launch → first working automation, cold start)
- **Level:** L1 (theoretical, code-grounded; no live app)
- **Verdict:** **L1-conditional**
- **Surface model walked:** launch → Home (`HomeWelcome` → `NavigationGrid`) → first action via either (A) the first-run `OnboardingOverlay` (template adopt → run) or (B) the Agents build surface (`UnifiedBuildEntry` → `GlyphFullLayout`).

## Verdict rationale

There are **two** routes to "first working automation," and they diverge sharply on accessibility:

- **Route A — onboarding overlay (adopt a template, then run it).** Structurally completable keyboard-only. The modal (`@/lib/ui/BaseModal`) is a genuinely good a11y primitive: `role="dialog"`, `aria-modal`, `aria-labelledby`, a real Tab focus-trap, Escape-to-close, focus-first-on-open, and focus-return-to-trigger-on-close. Template cards and step CTAs are native `<button>`s with visible text. The job can finish on this route. Its gaps are majors/minors (selection state not announced; run result not announced), not blockers.

- **Route B — the default Agents build surface (`GlyphFullLayout`, layout pref `"glyph-full"`, the documented "flagship build surface").** **Blocked for keyboard/SR.** The from-scratch build requires answering the LLM's clarifying questions, and the only affordance to open a question is **clicking a petal of an SVG sigil** ("Tap a glowing leaf to answer"). The petals are bare SVG `<g>`/`<path>` with `onClick`/`onMouseEnter` only — no `role`, no `tabIndex`, no `aria-label`, no key handler. They are not in the tab order and cannot be activated by keyboard or perceived by a screen reader. The answer card the petal opens is itself fully accessible — but Ben can never reach it.

Because a complete first-value path exists (Route A) the **journey** does not structurally fail, so the verdict is **L1-conditional** rather than L1-fail. But Route B is a primary, default creation surface, and per Ben's own bar ("a single a11y wall = total block") it is a hard wall for anyone who lands there first. That is the headline major.

---

## Findings

### F1 — BLOCKER (build sub-path): the default build surface is a keyboard/SR dead-zone — clarifying questions are answerable only by clicking unlabeled SVG petals
- **type:** broken-flow / missing · **reachable:** yes (default layout) · **code_check:** confirmed-absent (no keyboard/role on petals)
- **dimensions:** completion (fail on this path), missing, senior-quality
- **Ben's criterion #4** (no critical action mouse-only) **and #1** (core path keyboard-completable) both fail on Route B.
- **Evidence — petals have no interactive semantics** (`src/features/shared/glyph/persona-sigil/GlyphHeroSigil.tsx:60-92`):
  ```jsx
  <g transform={`translate(${center} ${center}) rotate(${angle})`}>
    <g
      className={PULSE_CLASS[state]}
      style={{ cursor: "pointer", pointerEvents: "auto", /* … */ }}
      onMouseEnter={() => onHover(dim)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => { e.stopPropagation(); onClick(dim); }}
    >
      <path d={petalPath} /* fill/stroke only — no role, tabIndex, aria, key handler */ />
    </g>
  </g>
  ```
  `GlyphPetalIcons.tsx` likewise contains no `role` / `tabIndex` / `onKeyDown` / `<button>` (grep returned no matches).
- **Evidence — the petal IS the only trigger for the question card** (`src/features/agents/sub_glyph/GlyphFullLayout.tsx:172-174`):
  ```jsx
  const overlay = activeDim && activeQuestion
    ? <GlyphAnswerCard question={activeQuestion} onAnswer={onAnswer} onClose={closeActiveDim} />
    : null;
  ```
  `activeDim` is set only by `onClickDim` (the petal). The instruction text confirms the pointer-only mental model (`GlyphSigilFace.tsx:133`): *"Tap a glowing leaf to answer."*
- **Net effect:** the answer card (`GlyphAnswerCard.tsx`) is fully accessible once open — real `<input autoFocus>`, Enter-to-submit, native option `<button>`s, labeled Close — but it can never be opened by keyboard. The accessible part is gated behind an inaccessible trigger.
- **l2_priority:** confirm with a real screen reader that the petals announce nothing and are skipped in the tab cycle; confirm there is no hidden keyboard alternative (e.g. an off-screen list) I did not find.

### F2 — MAJOR: "first working automation" result is not announced — no `aria-live` on the execution status or streaming output
- **type:** quality-gap / senior-quality · **reachable:** yes (onboarding Route A payoff) · **code_check:** confirmed-absent
- **Ben's criterion #5** (result perceivable via screen reader) fails.
- **Evidence** (`src/features/onboarding/components/ExecutionStep.tsx:130-169`): the status row swaps "executing" → "completed"/error text in place, and the terminal log streams lines, but neither container carries `role="status"` / `role="log"` / `aria-live`:
  ```jsx
  <div className="flex items-center gap-2">
    {finished ? ( /* CheckCircle2 + "execution_completed" */ ) : ( /* LoadingSpinner + "executing" */ )}
  </div>
  {/* terminal */}
  <div ref={terminalRef} className="… h-64 overflow-y-auto">
    {executionOutput.map((line, i) => <div key={i}>{line}</div>)}
  </div>
  ```
  The text exists and is reachable by manual SR navigation, so this is a major (degraded quality), not a blocker — but Ben gets no announcement that his first automation finished; he must hunt for the state change. The status is conveyed visually (color + icon) with no announced equivalent.
- **l2_priority:** confirm with NVDA/VoiceOver that the "completed" transition is silent.

### F3 — MAJOR: first-run option-group selectors expose no selected state to a screen reader (theme / text-size / language / brightness)
- **type:** quality-gap / clarity · **reachable:** yes (onboarding `AppearanceStep` is step 1) · **code_check:** confirmed-absent
- **Ben's criterion #2** (controls have accessible names **+ states**) partially fails — names are fine, *state* is not.
- These are native `<button>` grids where the current selection is signalled **only** by a visual `Check` icon + border color, with no `aria-pressed` / `aria-checked` / `aria-current` and no radio/listbox role. A screen reader announces every option as an identical, unpressed button; Ben cannot tell which theme / text size / language / density is active.
- **Evidence — language picker** (`src/features/onboarding/components/AppearanceStep.tsx:64-82`): `<button … onClick={() => setLanguage(lang.code)}>` with `{isActive && <Check/>}` and no aria state.
- **Evidence — text-size / brightness / theme** (`src/features/settings/components/AppearancePickers.tsx:91-112, 149-172, 205-224`): same pattern in `TextScalePicker`, `BrightnessPicker`, `SimpleThemePicker` — `isActive` drives a visual `<Check>` only.
- **Note:** the project ships `forms/AccessibleToggle` (correct `role="switch"`/`aria-checked`) and `forms/Listbox` (accessible select). These pickers predate or bypass those primitives. Low-vision Ben specifically depends on the text-size control announcing its state.

### F4 — MAJOR: the build surface's mode + layout toggles are hand-rolled buttons with no switch role/state, and rely on hover-only `title` tooltips
- **type:** confusion / clarity · **reachable:** yes (Route B header) · **code_check:** confirmed-absent
- **Evidence — one-shot toggle** (`src/features/agents/components/matrix/UnifiedBuildEntry.tsx:731-754`): a plain `<button>` toggling `oneShotEnabled`, state shown by a dot marked `aria-hidden` + label text, on/off conveyed via a `title=` tooltip (hover-only, not reliable for SR). No `role="switch"` / `aria-pressed`. The layout toggle buttons (`:756-781`) likewise lack `aria-pressed`.
- This is the on/off control that lets Ben skip the questionnaire (a possible workaround for F1) — and it is itself under-labeled, so even the escape hatch is hard to perceive as a stateful control.

### F5 — MINOR: template-card and language-card selection is visual-only (no `aria-pressed`/`aria-selected`)
- **type:** quality-gap / clarity · **reachable:** yes · **code_check:** confirmed-absent
- **Evidence** (`src/features/onboarding/components/TemplatePickerStep.tsx:122-135`): `<button data-testid="template-card-…" onClick={() => onSelect(review.id)}>` with selection shown by a `Check` icon + border; no `aria-pressed`/`aria-selected`. Ben can pick a template but won't hear that it became the selected one — he must infer from the Continue button enabling.

---

## What passed (strengths — do not regress)

- **`BaseModal` is a model a11y primitive** (`src/lib/ui/BaseModal.tsx:183-233`): `role="dialog"` + `aria-modal="true"` + `aria-labelledby`; Tab/Shift-Tab focus trap (`:205-226`); Escape closes when topmost (`:198-202`); focus-first-focusable on open (`:187-194`); **focus returns to the triggering element on close** (`:229-233`). The onboarding overlay, glyph composer, and answer flows all sit on this — modal trust (criterion #3) passes.
- **Sidebar nav is fully keyboard/SR-correct** (`src/features/shared/chrome/sidebar/SidebarLevel1.tsx:197-218`): native `<button>` per section with `aria-label`, `aria-current="page"` on the active item, and a disabled state. Ben can traverse the whole app top-level by keyboard with announced labels and current-page semantics.
- **Home nav cards are real buttons with visible focus** (`src/features/home/sub_welcome/NavigationGrid.tsx:39-53`): `motion.button` with the card label as text content and `focus-visible:ring-2 … focus-visible:ring-offset-4`. Reachable, named, visibly focusable — and the "go" arrow reveals on `group-focus-visible`, so focus state is visible, not hover-only.
- **`AccessibleToggle` is correct** (`src/features/shared/components/forms/AccessibleToggle.tsx`): `role="switch"`, `aria-checked`, `aria-label`, Enter/Space handler, focus ring, and an `sr-only` enabled/disabled label. The right primitive exists — the findings above are about core-path surfaces *not using* it.
- **The onboarding overlay close button is labeled** (`src/features/onboarding/components/OnboardingOverlay.tsx:117-124`): icon-only `X` with `aria-label={t.onboarding.skip_tooltip}`. The `GlyphAnswerCard` Close is labeled too (`GlyphAnswerCard.tsx:68-75`).
- **The glyph compose-summon and draft/test/promote actions are real buttons** (`src/features/agents/sub_glyph/GlyphCoreContent.tsx:124-153, 236-277`): `motion.button` with `aria-label` + focus ring for "Click to begin," and native `<button>`s with text for Run test / Refine / Open. So the *center* of the sigil is operable — it is specifically the **petal ring** (the question-answering affordance) that is the dead-zone.

---

## Character voice

I can get into this app fine. The sidebar buttons announce their names and tell me which page I'm on, the home cards take focus and show a focus ring, and the modals are genuinely well built — they trap focus, Escape closes them, and focus comes back to where I was. Someone here knows how a dialog is supposed to behave.

Then I tried to build an agent from scratch, and I hit the wall I always hit. The whole creation surface is a "sigil" — a flower of petals — and when the assistant asks me a question, the only way to answer is to "tap a glowing leaf." Those leaves are SVG paths with a click handler and nothing else: no role, not in the tab order, no label. My screen reader doesn't even know they're there. The answer box behind them is perfectly usable once it opens — a real text field, real buttons, Enter to send — but I can't open it. The accessible part is locked behind a control I can't operate. That's a total block, not friction.

The safer route — adopt a template in the first-run wizard, then run it — does work end to end, and I'm glad it's there. But two things still nag me. On the very first screen I pick a theme, a text size, and a language, and not one of them tells me which one is currently selected — they're all just buttons, no "selected" state, only a checkmark I can't see. And when my first automation finally finishes, nothing says so. The status flips from "executing" to "completed" silently; I have to go fishing for it. The button has no accessible name, the toggle has no state, and the result has no announcement — the usual three. Use your own `AccessibleToggle` and `Listbox`, put `aria-live` on the result, and give those petals a keyboard path, and I'd have no complaints.
