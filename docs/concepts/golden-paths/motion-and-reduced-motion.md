# Golden path — Motion and reduced motion

> Situation node: `ui-system/motion-and-accessibility/motion-and-reduced-motion` · [situation spine](../situation-spine.md)
> Composed 2026-08-14 at `c90a7e731`. Sweep: all **4,829** `src/**` `.ts`/`.tsx` files walked by the
> census engine, plus full reads of `useMotion.ts`, `App.tsx`, `globals.css` (all 8
> reduced-motion blocks + all 65 `@keyframes`), `typography.css`, `themeStore.ts`,
> `RevealItem.tsx`, `useProgressiveReveal.ts`, `UnifiedTable.tsx`, `RouteChunkSkeleton.tsx`,
> `Button.tsx`, `AsyncButton.tsx`, `motionPresets.ts`, `AnimatedCounter.tsx`,
> `eslint-rules/enforce-reduced-motion-fallback.cjs`, `docs/development/reduced-motion.md`,
> `.claude/Design.md`, the **framer-motion 12.38.0 dist source** (`motion-dom`'s
> `visual-element-target.mjs`, `keys-position.mjs`, `VisualElement.mjs`,
> `use-reduced-motion.mjs`), a scoped `npx eslint` run, and a full convergence census of the
> sibling repos `personas-web` (597 `.tsx`) and `personas-cloud` (negative control).
> Dimensions: **ui · function · code-quality · performance**.
> **Settles:** whether a piece of motion is allowed to move for a user who asked for less of it — and which of the four layers is responsible for stopping it.
>
> Shared counts are cited from [`shared-facts.json`](../shared-facts.json); everything else was
> measured during composition. Deviations become `violating` cells.

---

## The brief's premise was wrong, and the correction is the document

The leaf brief asked "whether **any** of it respects `prefers-reduced-motion`", and flagged a
blanket global rule as a hypothesis. **The blanket rule exists, and so do three more layers, a
design doc, and an ESLint rule.** This repo has one of the most complete reduced-motion systems
you will find outside a design-system vendor: `globals.css:4520` (OS media query),
`globals.css:5138` (in-app toggle mirror), `App.tsx:321` (`<MotionConfig>`),
`useMotion.ts` (`useReducedMotion` / `useMotion` / `useMotionVariants` / `toReducedVariants`),
`custom/enforce-reduced-motion-fallback`, and [`docs/development/reduced-motion.md`](../../development/reduced-motion.md)
describing all of it accurately.

So this path is not "add reduced-motion support". It is the harder document: **the four layers do
not compose, and the seams between them are where every remaining defect lives.** Two of those
seams produce a user-visible lie today (§7.A, §7.B) and one of them defeats a *different* golden
path's central mechanic (§7.C).

Three further premises in the brief are also stale or wrong, corrected in place: the shared
skeletons no longer default to a pulse (§7.G — `page-loading.md`'s text about that is now
false); `ToastContainer.tsx` does not use `useReducedMotion()` at all; and the `MOTION` design
token is not a reduced-motion mechanism (§Boundaries).

---

## Principle (stack-free head)

Per the [portability test](../research/portability-test.md), the head is physically separated and
every clause carries its **warrant**, so an adopting repo can tell physics from local
calibration. No file path, primitive name or count appears below this line until the head ends.

> **P1 — physics.** Reduced motion is not a preference about taste; it is a medical
> accommodation. For a user with a vestibular disorder, unrequested movement produces nausea and
> disorientation. Treat a motion decision the way you treat a contrast decision, not the way you
> treat a colour decision.
>
> **P2 — physics.** The preference has exactly one correct number of readers: **one**. Every
> additional place that asks the system "does this user want less motion?" is a place that can
> answer differently, and they will — because each reader is written against the signal its
> author happened to know about. Fan-out is the root defect; every seam below is downstream of it.
>
> **P3 — physics, and the reason a global reset feels sufficient and is not.** A declarative
> stylesheet reset can only reach animation the *stylesheet* owns. Any animation driven by a
> script writing values frame by frame is invisible to it. A codebase with both a blanket CSS
> reset and a JS animation library has covered the half it can see and produced maximum
> confidence about the half it cannot.
>
> **P4 — physics.** A library-level "respect the preference" switch is scoped to what the library
> considers a *movement* property — typically position and transform. Animation of opacity,
> colour, shadow, filter or stroke is left running, by design, because a cross-fade is usually
> acceptable. **That design assumption holds for one-shot animation and fails for looping
> animation.** A forever-looping opacity pulse is a flashing element, not a cross-fade.
> Therefore: *the sharp class is not "animation", it is "animation that never ends on a property
> the library does not consider movement".*
>
> **P5 — physics.** If the product ships its own in-app reduce-motion control **in addition to**
> the OS preference, then any mechanism that reads only the OS preference silently exempts
> itself from the control. A product-level control that reaches some layers and not others is
> worse than no control, because it converts a user's explicit request into a false belief.
>
> **P6 — physics.** Suppressing motion must not suppress *information*. Where motion was the
> only carrier of a state — busy, arriving, changed — removing it requires a static carrier to
> take over. "Freeze the animation" is a correct implementation of P1 and a defect against this
> clause whenever the frozen thing was the only signal.
>
> **P7 — ergonomics, with a measured cause.** Delay-based choreography (a placeholder that stays
> invisible for N ms so a fast fetch never paints it) is *timing*, not motion — but it is usually
> implemented **as** an animation, so a blanket "remove the animation" reset removes the delay
> with it and makes the placeholder paint instantly. Motion suppression and timing choreography
> must be separable, or reduced-motion users get more flashing, not less.
>
> **P8 — governance.** A preference-reading API that samples once at mount and never updates is
> not a bug in most usage and is a trap in all of it: the accommodation arrives only on the next
> full remount. Prefer a subscription; where the platform's own API does not subscribe, wrap it
> and forbid the raw one.
>
> **P9 — governance.** When a suppression list is duplicated so that two triggers (an OS query
> and an app flag) each get their own copy, the two copies diverge. Measure the divergence
> before trusting either; the copy written second is always the shorter one.

---

## Boundaries with adjacent paths — stated, per the leaf brief

**`design-token-usage.md` owns the token layer, not the accessibility layer.** It measures
`MOTION` (from `src/lib/utils/designTokens.ts:29`) at **14 hits / 7 files** against `duration-N`
utilities at **196 hits / 118 files** — 3.4% adoption (re-measured here at 197 hits / 118 files;
the one-hit difference is a `duration-` inside a comment and does not change the conclusion).
That is a *vocabulary* finding: which name a duration is written in. **It is not a reduced-motion
finding.** `MOTION.duration.normal` and `duration-250` are equally reachable and equally
unreachable by a reduced-motion preference — reachability depends on whether the value drives a
CSS transition (reachable, `globals.css:4520`) or a framer transition (not reachable). Do not
cite the 3.4% token-adoption number as motion-accessibility evidence; it measures something else.
This path takes no position on which spelling to use — go read that one.

**`page-loading.md` / [`docs/design/overview-loading.md`](../../design/overview-loading.md) own
loading choreography; this path owns whether that choreography is allowed to move.** The
boundary is exact and it is currently broken in one direction: `page-loading`'s central mechanic
is a ghost that stays invisible behind an `animationDelay` because `fill-mode: both` makes the
delay an invisibility window — and this path's global reset deletes that animation, taking the
invisibility window with it (§7.C). *Which* placeholder to render is `page-loading`'s call;
*whether it fades in* is this one's. When they conflict, P7 above says the timing wins and the
motion goes.

**`focus-management.md` is this path's sibling under `ui-system/motion-and-accessibility` and
shares no mechanism with it.** Focus is about *where keyboard control is*; motion is about
*whether pixels move*. They touch at exactly one place — a surface that animates its own entrance
must not delay moving focus until the entrance finishes, because under reduced motion the
entrance does not run and a focus call chained to `onAnimationComplete` never fires. That single
interaction is listed as an anti-pattern (§5.7) and is otherwise out of scope here.

---

## 1. Trigger

- "I'm adding a pulse / glow / shimmer / breathing indicator to show something is live."
- "This thing should spin forever while the job runs."
- "I want the rows to cascade in instead of appearing all at once."
- "Should I wrap this in `motion.div` or just use a CSS transition?"
- "I turned on Reduce motion in Settings and the app still animates."
- "If you are about to type `repeat: Infinity`, `animate-pulse`, `animate-ping`, or an
  `@keyframes … infinite`" — you are in this situation, whether or not you feel like you are.
- "If you are about to write `import { useReducedMotion } from 'framer-motion'`" — you are in
  this situation and about to make the mistake in §5.1.

## 2. The one way

Do not implement reduced motion; **inherit it**, then declare the one thing that cannot be
inherited. Write CSS transitions and CSS `@keyframes` and you are already covered — the global
reset at `globals.css:4520` collapses every CSS animation and transition and forces
`animation-iteration-count: 1`, and it reaches an inline `<style>` block in a component exactly
as well as it reaches the stylesheet. Write a one-shot `framer-motion` entrance or layout
animation and you are already covered — `App.tsx:321` wraps the tree in
`<MotionConfig reducedMotion=…>`, which replaces the transition with `{ type: false }` for every
positional key. **The one thing neither layer covers is a framer animation that both loops
forever and animates a non-positional property** — opacity, colour, `boxShadow`, `filter`,
`stroke` — because `MotionConfig` deliberately leaves those running and CSS cannot see them.
For that, and only that, take an explicit branch: call `useReducedMotion()` **from
`@/hooks/utility/interaction/useMotion`, never from `framer-motion`**, and render a *static
carrier of the same information* — a steady ring at the pulse's mid opacity, a solid dot, a
plain label — not nothing. If the loop is genuinely decorative and carries no state a static
element does not already carry, say so on the line with `// reduced-motion-ok: <reason>` and move
on. For a variants object that carries `staggerChildren` / `delayChildren` / `repeat`, pass it
through `useMotionVariants()` and stop — it strips movement keys and collapses the transition for
you. For a row cascade, use `RevealItem` + `useRevealTracker` and stop; they already branch.

## 3. Mandated primitives

- **`useReducedMotion()`** (`src/hooks/utility/interaction/useMotion.ts:16`) — the boolean. Built
  on `useSyncExternalStore` over `matchMedia('(prefers-reduced-motion: reduce)')`, so it **updates
  live** when the user changes the OS setting. This is the only sanctioned reader.
- **`useMotion()`** (`useMotion.ts:58`) — the same preference resolved into a `MotionConfig`:
  `{ shouldAnimate, duration, spring, transition, staggerDelay }`. Reach for it when you need a
  *number* (a duration, a stagger step) rather than a branch.
- **`useMotionVariants(variants)`** (`useMotion.ts:166`) — the variants gate. Returns the original
  object or a movement-free clone: transform keys dropped (element snaps to rest), `repeat` /
  `delay` / `staggerChildren` / `delayChildren` / `staggerDirection` / `repeatType` /
  `repeatDelay` removed, keyframe arrays collapsed to their final value, transition forced to
  `{ type: 'tween', duration: 0 }`. Opacity is deliberately preserved.
- **`toReducedVariants(variants)`** (`useMotion.ts:141`) — the pure, hook-free form, for a
  module-scope variants constant.
- **`<MotionConfig reducedMotion=…>`** (`src/App.tsx:321`) — the root framer gate. Already
  mounted; you never add a second one. It also flips to `"always"` while the document is hidden,
  which is a deliberate CPU/thermal measure, not an accessibility one.
- **The global CSS resets** (`globals.css:4520` for the OS query, `globals.css:5138` for the
  in-app toggle) — you do not add rules here for a normal component. Both blanket `*`,
  `*::before`, `*::after` to `animation-duration: 0.01ms`, `animation-iteration-count: 1`,
  `transition-duration: 0.01ms`, `scroll-behavior: auto`, all `!important`, and both hide SVG
  SMIL (`animate`, `animateTransform`, `animateMotion`).
- **`@media (prefers-reduced-motion: no-preference)`** (`globals.css:1825`) — the *inverse* gate,
  and the strongest pattern available: an ambient decorative loop defined inside it never exists
  under reduced motion rather than being suppressed afterwards. Use it for anything purely
  atmospheric.
- **`display/RevealItem`** + **`useRevealTracker(resetKey)`**
  (`RevealItem.tsx:48`, `useProgressiveReveal.ts:184`) — the row-entrance cascade. `RevealItem`
  reads `useReducedMotion()` at line 52 and under reduce applies neither the class nor the
  `animationDelay`, and marks the row entered immediately.
- **`useProgressiveReveal(total, opts)`** (`useProgressiveReveal.ts:77`) — spreads *mounting* of a
  large list; `revealAll = !enabled || reducedMotion` at line 89.
- **`display/motionPresets.ts`** — the `/motionize` glyph preset library. Every preset carries a
  required `reduced: 'opacity-only' | 'none'` field, so a preset cannot be authored without
  answering the question. Deliberately CSS-keyframe data rather than framer variants, because
  `MotionConfig`'s `"always"` branch would otherwise snap the reveal away entirely.
- **`custom/enforce-reduced-motion-fallback`** (`eslint-rules/…cjs`, `eslint.config.js:108`,
  **warn**) — flags `motion.X` / `m.X` with an `animate` prop whose `transition` object requests a
  `repeat`, in a file with no fallback token. See §7.D for its measured precision, which is 0.

## 4. Steps

1. **Ask which layer already owns it.** CSS transition or `@keyframes` → layer 2, done, write no
   code. One-shot framer entrance/exit/layout on transform / `x` / `y` / `scale` / `width` /
   `height` / `top` / `left` → layer 1, done, write no code. SVG SMIL → layer 2, done. Only a
   *looping* framer animation, or a variants object carrying stagger/delay/repeat, reaches step 2.
2. **If it is a variants object → `useMotionVariants(v)` and stop.** Two files do this today
   (`useMotion.ts` is imported for it in 2 files); it is the least-used and highest-leverage
   primitive in the set.
3. **If it is an inline looping `animate` → branch, and render a static carrier.** Call
   `useReducedMotion()` from `@/hooks/utility/interaction/useMotion` and ternary the *element*,
   not just the transition — `TitleBarDock.tsx:148` is the shape to copy. Branching only the
   `transition` (`transition={reduced ? {duration:0} : {…, repeat: Infinity}}`) is acceptable when
   the resting `animate` target is already a legible state (`LiveStreamTab.tsx:367`); branching
   only the transition while `animate` stays a keyframe array is not, because framer will still
   apply the array's last frame and you may land on `opacity: 0`.
4. **Decide what the static carrier says (P6).** The frozen animation is almost never it. A
   spinner frozen mid-arc says nothing; the pulse that meant "running" must become a steady ring
   or a labelled badge. If you cannot name the static carrier, the loop was decorative — which is
   fine, and takes you to step 5.
5. **If decorative, opt out explicitly on the line**: `// reduced-motion-ok: <why the static
   state already conveys everything this loop conveys>`. `PhaseIndicator.tsx:67`,
   `ucPowerRail.tsx:45` and `ucClockVariant.tsx:113` are three well-written examples. A bare
   `eslint-disable` is not equivalent — the reason is the artefact.
6. **Never write a new `matchMedia('(prefers-reduced-motion: reduce)')`.** There is exactly one
   legal one, at `useMotion.ts:5`. There are currently two (§7.E).
7. **Do not add a selector to either `globals.css` reduced-motion block** unless the animation
   genuinely needs `animation: none` semantics rather than a 0.01ms duration — and if you do,
   **add it to both blocks**. They are 23-vs-5 selectors out of sync today (§7.F).

### Can the primitive's signature make the wrong call impossible? — the type-over-gate question, answered up front

**Partly, and the two available type moves are worth more than any gate in §9.** See
[the contract's "Prefer a type over a gate"](../golden-path-contract.md#prefer-a-type-over-a-gate--checked-three-times).

- **Type move 1 — make the wrong hook unimportable.** `eslint.config.js:73` already runs
  `no-restricted-imports` at **`"error"`** (it is how raw `invoke` is banned). Adding
  `{ name: "framer-motion", importNames: ["useReducedMotion"], message: "…" }` makes the
  mount-snapshot hook (§7.E) **impossible to import**, at error severity, using a mechanism whose
  severity is already established. It removes 28 files' worth of a defect class permanently and
  needs no count, no baseline and no ratchet. This is the single highest-value change in the
  document.
- **Type move 2 — make the fan-out unrepresentable.** Fold the in-app toggle into
  `useReducedMotion()` (`themeStore.reduceMotion || MQ.matches`) and feed `MotionConfig` from the
  same hook. Then there is *one* predicate, P2 is satisfied by construction, and §7.A/§7.B cannot
  recur — not because a rule catches them, but because there is no second signal to diverge from.
- **The move that is NOT available.** A required-prop primitive
  (`<Loop animate={…} reducedAnimate={…}>` refusing `repeat` without a reduced target) would make
  §7.D unrepresentable too — but it does not exist, `motionPresets.ts` covers only `/motionize`
  glyphs, and inventing it is out of scope for a path. It is filed in Gaps (§8.5) as the type the
  repo is missing, and the §9 census rule is explicitly **the ratchet that holds the line until it
  lands** — which is the contract's prescribed relationship between the two.

## 5. Anti-patterns

1. **`import { useReducedMotion } from 'framer-motion'`.** Framer 12.38.0 implements it as
   `useState(prefersReducedMotion.current)` — a snapshot with a literal `TODO See if people miss
   automatically updating` beside it (`framer-motion/dist/es/utils/reduced-motion/use-reduced-motion.mjs:37`).
   The user turns on Reduce motion in the OS and **nothing changes until that component
   remounts.** The local hook at `useMotion.ts:16` is a live subscription. 28 files import the
   wrong one.
2. **Assuming `<MotionConfig reducedMotion="user">` covers your animation.** It replaces the
   transition with `{ type: false }` only when the key is in `positionalKeys` —
   `width`, `height`, `top`, `left`, `right`, `bottom` plus the transform props
   (`motion-dom/dist/es/animation/interfaces/visual-element-target.mjs:76`,
   `render/utils/keys-position.mjs`). Opacity, `boxShadow`, `filter`, colour and `stroke` are
   **not** in it and keep their full transition, `repeat: Infinity` included.
3. **Freezing instead of substituting (P6).** `animation: none` on a spinner leaves a static
   partial arc that reads as broken, not as busy.
4. **A second `matchMedia` call.** It will drift from the hook, it will not participate in the
   in-app toggle when that is fixed, and it duplicates a `useSyncExternalStore` subscription with
   a `useState`+`useEffect` one that flashes the wrong value on first paint.
5. **Branching only the `transition` while `animate` is a keyframe array.** `animate={{ opacity:
   [1, 0, 1] }}` with `transition={reduced ? { duration: 0 } : {…}}` still runs the array; you get
   an instant jump to the last frame, which may be the invisible one.
6. **Adding a rule to one `globals.css` reduced-motion block and not the other.** The OS block and
   the `html[data-motion="reduce"]` block are two hand-maintained copies; the doc says keep them
   in sync and they are not (§7.F).
7. **Chaining focus (or any correctness-bearing side effect) to `onAnimationComplete` /
   `animationend`.** Under reduced motion the animation does not run and the callback does not
   fire. `RevealItem.tsx:56` shows the correct shape — it marks entry in a `useEffect` when
   `reduced`, precisely because the `animationend` path is dead in that mode.
8. **Reaching for `<MotionConfig>` locally to "fix" a subtree.** There is one, at the root. A
   nested one with `reducedMotion="always"` snaps *opacity* too, which is how you delete a reveal
   (`motionPresets.ts:10` documents this being discovered the hard way).

## 6. Evidence

**The one site to copy: `src/features/shared/chrome/TitleBarDock.tsx:148-160`.** A running-fleet
indicator. Under reduced motion it renders a completely different element — a static
`border-primary/50 opacity-50` ring — and only otherwise renders the `motion.span` with
`opacity: [0.15, 0.6, 0.15]` / `repeat: Infinity`. It uses the local hook (line 4), branches the
element rather than the transition, and the static carrier conveys the same "something is
running" state (P6). Every clause of §2 is visible in twelve lines.

Supporting exemplars, in descending order of how much they teach:

| Site | What it demonstrates |
| --- | --- |
| `src/hooks/utility/interaction/useMotion.ts:114-166` | `toReducedVariants` — the transform-key strip. The `TRANSFORM_KEYS` / `TIMING_KEYS` sets are the repo's written answer to P4, and they match framer's own `positionalKeys` closely enough to be interchangeable. |
| `src/features/shared/components/display/RevealItem.tsx:52-60,72-73` | Reduced motion removes the class **and** the `animationDelay`, and marks entry via effect rather than `animationend`. The full §5.7 fix in four lines. |
| `src/features/plugins/companion/AthenaAvatar.tsx:31,88,149` | The strongest form of suppression: under reduced motion it mounts **no `<video>` at all**. Not "pause the clip" — never decode it. Also a performance win, which is why P1 and the thermal argument point the same way here. |
| `src/features/triggers/sub_live_stream/LiveStreamTab.tsx:367-370` | The legitimate transition-only branch: `animate={reduceMotion ? { opacity: 1 } : { opacity: [0.4,1,0.4] }}` — the reduced target is a *resting* value, not the array's last frame. |
| `src/features/agents/sub_design/PhaseIndicator.tsx:67-76` | A `reduced-motion-ok` opt-out whose reason names the static carrier ("conveys no information beyond the static colored dot beside it"). This is what the comment is for. |
| `src/styles/globals.css:1825-1838` | `@media (prefers-reduced-motion: no-preference)` wrapping `.animate-hero-orb-drift`. The inverse gate — the decoration is never defined under reduce, so nothing has to suppress it. |
| `src/features/agents/sub_executions/components/ExecutionLifecycleIcons.tsx:46,76,112,148` | Four inline `<style>` blocks each carrying their own `@media (prefers-reduced-motion: reduce)`. Strictly redundant (the global blanket already reaches them) but harmless and self-documenting. |
| `src/features/shared/components/display/motionPresets.ts:46` | `reduced: 'opacity-only' \| 'none'` as a **required** field on `MotionPreset` — the only place in the repo where the type system currently forces the question. This is the shape §8.5 wants generalised. |

## 7. Deviations found

### A. The in-app "Reduce motion" toggle does not reach framer-motion at all — **200 files**

`themeStore.ts:197` sets `html[data-motion="reduce"]`. `globals.css:5138` mirrors the CSS reset
for it. Nothing else reads it. `App.tsx:321` reads `useDocumentVisibility()`;
`useMotion.ts:5` reads `matchMedia` only; framer's own hook reads `matchMedia` only. So a user
who turns the setting on gets CSS suppressed and **every framer-motion animation in the app still
running** — 200 files render `<motion.*>` / `<m.*>` elements, 221 import the library.

The setting's own copy (`en.json:10834`) promises: *"Disables transitions and animations across
the app."* It disables the transitions. It disables none of the animations that a JS library
drives. This is P5 exactly: an explicit user request converted into a false belief.

**Fix:** type move 2 in §4 — one predicate, fed to both `MotionConfig` and the hook.

### B. Six readers of one preference — **the root cause (P2)**

| Reader | Signal | Live? | Covers |
| --- | --- | --- | --- |
| `globals.css:4520` | OS media query | n/a | CSS only |
| `globals.css:5138` | `html[data-motion]` (app toggle) | n/a | CSS only |
| `App.tsx:321` `MotionConfig` | OS + document visibility | yes | framer, positional keys only |
| `useMotion.ts:16` (local) — **23 files** | OS | **yes** | whatever the call site branches |
| `framer-motion` `useReducedMotion` — **28 files** | OS | **no — mount snapshot** | whatever the call site branches |
| `AnimatedCounter.tsx:194-210` (private) | OS | yes (post-hydration) | that one component |

Two signals, six readers, three different liveness semantics, and no reader sees both signals.
Every entry in §7.A, §7.D and §7.E is a consequence.

### C. The global reset defeats `page-loading.md`'s delayed-ghost mechanic — **cross-path**

`globals.css:4539` lists `.animate-fade-in` in the `animation: none !important` set. `animation:
none` removes the animation *and therefore its `animation-delay` and its `fill-mode: both`*. But
that fill-mode **is** the invisibility window that `page-loading.md` §2 relies on. So under
`prefers-reduced-motion`:

- `UnifiedTable.tsx:289` — `TableGhostRows` renders 8 rows with `animationDelay: 120 + r*35`ms
  (up to 365ms). Under reduce they all paint **on frame 1**. Every table fetch, however fast,
  now flashes a full ghost body then replaces it — the exact flash the design prevents.
  `DataGrid` shares the branch.
- `RouteChunkSkeleton.tsx:39-40` — `animate-fade-in` + `animationDelay: '150ms'`. Under reduce
  every lazy chunk paints a header skeleton immediately, including warm ones that resolve in 5ms.

Reduced-motion users get *more* visual churn than everyone else, from the accessibility feature.
This is P7. The fix is to make the delay survive: either keep `animation-duration: 0.01ms`
(the blanket already does) instead of `animation: none` for `.animate-fade-in`, or move the
invisibility window off the animation entirely. Note the irony worth recording: the **in-app
toggle path preserves the mechanic correctly**, because its block never nulls the animation.

### D. `custom/enforce-reduced-motion-fallback` — **3 findings, 0 true positives, 6 misses**

Measured with `npx eslint` over all 26 files containing `repeat: Infinity`.

**All 3 warnings are false positives.** `DialogueComposePanel.tsx:193`,
`GlyphCinemaLayout.tsx:254` and `:424` are shimmer bars animating `x: ["-100%", "352%"]` — `x` is
a transform, in framer's `positionalKeys`, so `MotionConfig` already replaces the transition with
`{ type: false }` and the loop never runs. The rule flags exactly the class layer 1 handles.

**It cannot see 6 further sites**, every one of them in a file with no fallback token at all —
because `attrObject()` (`…cjs:77-87`) returns `null` for any `transition=` value that is not a
bare `ObjectExpression`. Two distinct shapes defeat it: a **ConditionalExpression**
(`transition={firing ? {…} : undefined}`) and a **per-property transition**
(`transition={{ y: { repeat: Infinity } }}`, where `repeat` is one level deeper than
`transitionRepeats()` looks).

| Site | Shape | Animated key | Positional? | Runs forever under reduce? |
| --- | --- | --- | --- | --- |
| `ucPicker/ucTimeCard.tsx:51-52` | ternary | `opacity: [0.5, 0.15, 0.5]` | no | **yes** |
| `ucPicker/ucTimeCard.tsx:57-58` | ternary | `opacity: [1, 0, 1]` | no | **yes** |
| `ucPicker/ucRouteToggle.tsx:39-46` | ternary | `boxShadow` ring | no | **yes** |
| `ucPicker/ucDeliverCard.tsx:67-75` | ternary | `filter: drop-shadow(…)` | no | **yes** |
| `GlyphDialogueCinemaLayout.tsx:251-252` | ternary + per-property | `y: [0,-3,0]` | yes | no |
| `GlyphCinemaLayout.tsx:290-291` | ternary + per-property | `y: [0,-4,0]` | yes | no |

**4 genuine defects across 3 files** — flashing elements, no gate, WCAG 2.3.3. `ucTimeCard`'s two
are an opacity strobe cycling `1 → 0 → 1` every 1.2s indefinitely. The other 2 are transform-only
and layer 1 saves them; they are listed because they are the same blind spot, and the next one
that lands there may not animate `y`.

This is the contract's §9 correction reproduced verbatim: *a signal keyed on the markup a
deviation happened to wear, not on the semantic condition.* The rule keys on
`transition={{…}}`. The condition is "a loop on a non-positional property".

### E. Two extra readers of the preference — **1 private hook, 28 wrong imports**

- `AnimatedCounter.tsx:194-210` defines a second `useReducedMotion`, with the comment *"avoids
  pulling in framer-motion's useReducedMotion (which has additional behavior we don't need)"* —
  correct diagnosis, wrong conclusion: the local `useMotion.ts` hook already is that, and is
  better (`useSyncExternalStore` has no first-paint wrong value).
- **28 files** import `useReducedMotion` from `'framer-motion'` vs **23** from
  `@/hooks/utility/interaction/useMotion`. All 28 are mount-snapshots (§5.1). Notable ones because
  they are always mounted: `AthenaAvatar.tsx:2`, `AthenaOrb.tsx:17`, `ChannelMap.tsx:2`,
  `DashboardHomeMissionControl.tsx:11`.

### F. The two CSS reduced-motion blocks are 23-vs-5 selectors out of sync

`docs/development/reduced-motion.md:24` instructs "Keep the two blocks in sync". Diffed
programmatically over `globals.css`:

- **23 selectors** are handled only under `@media (prefers-reduced-motion: reduce)`:
  `.animate-pulse`, `.animate-spin`, `.animate-pulse-slow`, `.animate-spin-slow`, `.animate-float`,
  `.animate-hero-orb-drift`, `.animate-fade-in`, `.animate-fade-scale-in`, `.animate-expand-in`,
  `.animate-shake-error`, `.animate-char-budget-shake`, `.animate-draw-check`, `.animate-sort-pulse`,
  `.athena-flash-label`, `.dropzone-dash-march`, `.drop-zone-illuminated[data-dragging="true"]`,
  `.glyph-petal-filling`, `.glyph-petal-pending`, `.kbd-nav-glow`, `.surface-blur-{modal,popover,tooltip}`,
  `[class*="backdrop-blur-"]`.
- **5 selectors** only under `html[data-motion="reduce"]`: `.animate-channel-row-in`,
  `.animate-map-dash`, `.animate-map-spin`, `.companion-autonomous`, `.companion-typing-dot`.

Most of the 23 are cosmetically covered by the toggle block's blanket `animation-duration:
0.01ms`, so the practical damage is smaller than the count. The material exceptions are the four
`backdrop-filter` suppressions (a WebView2 paint mitigation the toggle does not get at all) and
`.dropzone-dash-march` / `.glyph-petal-*`, which want `animation: none` semantics. P9: the copy
written second is the shorter one, and it is.

### G. Correction — the skeletons no longer default to a pulse

`page-loading.md` §3 states the shared skeletons must be used "**only with `calm`** (their default
is a banned pulse)". **That is no longer true at `c90a7e731`.** `ContentHeaderSkeleton.tsx:30`,
`ListSkeleton.tsx:24` and `TableSkeleton.tsx:39` all now carry `calm?: boolean` marked
`@deprecated No-op — calm is now the only treatment`, and none of the three contains
`animate-pulse` anywhere. The defect was fixed; the doc was not updated. Filed here rather than
fixed because editing another path mid-wave is how a corpus loses entries.

### H. Three `reduced-motion-ok` opt-outs are on looping **opacity**, not decoration

`ucPowerRail.tsx:45` (`opacity: [0.3, 1, 0.3]`), `PhaseIndicator.tsx:67` (`opacity: [0.4, 0,
0.4]`) and `GlyphCoreContent.tsx:138` (`opacity: [0.55, 1, 0.55]`) all carry well-written reasons
and are all genuinely small and decorative — but all three are *flashing elements that never
stop*, which is the WCAG 2.2.2 (Pause, Stop, Hide) shape rather than the 2.3.3 one the opt-out
was designed for. Not listed as defects; listed as the three opt-outs a reviewer should
re-examine first if the app is ever formally audited, and as evidence that the comment's
"decorative" test is doing more work than its author intended. `ucClockVariant.tsx:113`
(a rotating second hand) is a transform and is neutralised by layer 1 regardless of its comment —
its opt-out is unnecessary, not wrong.

### Not a deviation, verified: inline `@keyframes` in components

7 `.tsx` files inject `@keyframes` through an inline `<style>` block (20 occurrences); 4 of them
(`CircuitBreakerIndicator`, `RecipePageFlipLoader`, `GlyphOrbitProgress`, `ThinkingLoader`) carry
no reduced-motion block of their own. **They are covered anyway** — the global blanket's
`!important` on `*` reaches any stylesheet the document parses, including an injected one. This is
the blanket rule earning its keep, and it is worth stating explicitly so nobody "fixes" it.

## 8. Gaps in the primitives

1. **`MotionConfig` cannot express "reduce non-positional loops but keep one-shot opacity".**
   Its three values are `"user"` / `"always"` / `"never"`, and `"always"` snaps opacity too, which
   deletes reveals — `motionPresets.ts:10` documents that discovery. So the middle ground P4
   describes has no library-level expression and must be hand-written per call site. This single
   gap is upstream of §7.D and of every `reduced-motion-ok` comment in the repo.
2. **`useMotionVariants` only helps variants, and almost nothing uses variants.** 2 files call it;
   the dominant idiom here is inline `animate` + `transition` props. The best primitive in the set
   is aimed at the idiom this codebase does not use.
3. **CSS cannot separate "suppress motion" from "suppress delay".** `animation: none` takes the
   `fill-mode: both` invisibility window with it (§7.C); `animation-duration: 0.01ms` keeps the
   window but leaves the animation nominally running. There is no third option in CSS, which is
   why P7 has to be stated as doctrine rather than enforced by a primitive.
4. **The blanket rule never resets `animation-delay` or `transition-delay`.** Harmless today —
   the 276 `animationDelay` co-occurrences are almost all with `.animate-fade-in`, which is
   nulled outright — but it is a live trap: any future `both`-filled entrance class *not* on the
   `globals.css:4532` list, given an inline delay, will hold its element invisible for the full
   delay under reduced motion. Adding a class to that list is currently a manual, unenforced step.
5. **There is no primitive that makes a looping animation's reduced fallback a required
   argument.** `motionPresets.ts:46` does exactly this for `/motionize` glyphs (`reduced` is
   non-optional) and it works — zero glyph presets are missing a fallback. Nothing equivalent
   exists for the framer path, which is where all 28 loops live. This is the type §4 wants and
   the repo does not have.
6. **Reduced motion has no static substitute for "busy" (P6).** `Button.tsx:230,237` and
   `AsyncButton.tsx:96` both render `animate-spin`, which `globals.css:4533` sets to
   `animation: none !important`. A reduced-motion user pressing Save gets a **frozen partial
   arc**, an unchanged label (`AsyncButton`'s `loadingText` is optional and defaults to
   `children`), and `disabled`. `aria-busy` covers assistive tech; sighted reduced-motion users
   have no visual busy affordance at all. This is the sharpest cross-path consequence of the
   whole document — `inline-busy-state.md` mandates a spinner as the busy carrier and this path's
   layer 2 deletes it — and neither path can fix it alone.
7. **No test asserts any of this.** There is one unit test (`__tests__/useMotion.test.ts`, which
   is why it is the census rule's sole exclusion) covering `toReducedVariants`. Nothing asserts
   that the app renders differently under an emulated `prefers-reduced-motion`, and Playwright's
   `reducedMotion: 'reduce'` context option is not used anywhere.

## 9. The missing gate

### The semantic condition, stated stack-free

> **A JS-driven animation that repeats without end, on a property the framework's own
> reduced-motion switch does not consider movement.**

That is the class no global mechanism in any stack can reach: a stylesheet reset cannot see
script-driven values, and a library switch deliberately exempts non-positional properties.
An adopting repo should re-derive its own proxy for *this*, not copy the regex below — the regex
keys on `repeat: Infinity`, which is framer's spelling and nothing else's.

### Why not an ESLint rule (the rule exists and measures 0/3)

The obvious mechanism is already built and already failing: `custom/enforce-reduced-motion-fallback`
scores **0 true positives and 5 false negatives** at HEAD (§7.D). Its recall gap is structural
(any `transition=` that is not a literal `ObjectExpression` is invisible) and its precision gap
is conceptual (it does not check whether the animated key is positional). Both are fixable —
handle `ConditionalExpression` and `LogicalExpression`, walk per-property transitions, and test
the `animate` target's keys against framer's `positionalKeys` set — and that fix is worth doing.
But an AST rule that must resolve which keys a possibly-computed `animate` object contains will
never be complete, and it is warn-level, which per the repo's own measurement enforces nothing at
either gate at any count. So: **fix the ESLint rule for authoring-time feedback; ratchet the
population with a census rule so a regression cannot land silently.** That is the contract's
prescribed composition — the rule reports, the census ratchets.

### The rule

```json
{
  "rules": [
    {
      "id": "looping-framer-animation",
      "goldenPath": "docs/concepts/golden-paths/motion-and-reduced-motion.md",
      "title": "Framer animation that loops forever",
      "roots": ["src"],
      "extensions": [".ts", ".tsx"],
      "signal": {
        "pattern": "repeat:\\s*Infinity",
        "flags": "g",
        "ignoreCommentLines": true,
        "description": "framer-motion transitions with repeat: Infinity — the one animation class neither the global CSS reduced-motion reset (script-driven values are invisible to it) nor <MotionConfig reducedMotion=\"user\"> (non-positional keys are exempt by design) can stop. Every one needs a useReducedMotion branch, a useMotionVariants wrap, or a `// reduced-motion-ok:` reason."
      },
      "exclude": [
        {
          "path": "src/hooks/utility/interaction/__tests__/useMotion.test.ts",
          "reason": "the reduced-motion primitive's own unit test — it asserts that toReducedVariants strips repeat, so the token must appear in the fixture"
        }
      ],
      "baseline": { "files": 25, "matches": 28 },
      "floor": 4000
    }
  ]
}
```

**It is a review ratchet on a population, not a violation count, and that is deliberate.** 19 of
the 25 files carry a gate token or an explicit `reduced-motion-ok`; the rule counts them anyway. The census engine cannot
express "…in a file with no fallback token", and a regex that tried would be a
catastrophic-backtracking whole-file negative lookahead that matches once per file. What the
ratchet buys is exact: **no new infinite framer animation can enter this repo without either a
fix or an explicit `npm run census -- --update` with a commit message.** Given that the ESLint
rule provably catches none of them, that is the entire enforcement surface for §7.D, and it costs
one line in a JSON file.

`repeat: Infinity` and the broader `repeat:\s*(Infinity|\d+)` return **identical** counts (29 raw,
28 after the exclusion) — there are no finite repeats in the codebase — so the narrow, semantically
precise pattern loses nothing. CSS `infinite` (29 declarations in `globals.css`) is deliberately
**not** in scope: the blanket reset provably reaches it, and counting it would dilute the signal
with the one class that is already safe.

### Validation — baseline reproduces exactly, faults reported

Validated standalone against the real engine (`scripts/census/lib/engine.mjs`) with a
composer-unique scratch harness, then **re-extracted from the fenced block above and re-run**;
both runs identical. `rules.json` was not edited — merge with
`scripts/census/merge-published-rules.mjs`.

```
looping-framer-animation: walked=4829 scanned=4828 files=25 matches=28 commentSkipped=0
  OK — baseline reproduces exactly.
```

`walked=4829` independently reproduces `shared-facts.json`'s `frontend.tsFiles: 4829`.
Cross-checked against a second implementation (`grep -rn "repeat:\s*Infinity"` → 29 hits / 26
files, minus the one excluded test file = 28 / 25). **Agreement is exact**, and
`commentSkipped=0` means the engine's multiline comment-consumption hazard cannot apply to this
pattern — nothing was skipped, so nothing could have been swallowed.

Induced faults, with the exit code each produces:

| Fault | `npm run census` | `npm run census:check` | Problem raised |
| --- | --- | --- | --- |
| control | **0** | **0** | — |
| a new looping animation lands (baseline 24/27) | 0 | **1** | `drift/rose` on both metrics |
| a count drops silently (baseline 26/29) | 0 | **1** | `drift/dropped` on both metrics |
| roots/extensions stop describing the repo (`floor: 9000`) | **1** | **1** | `structural/floor` — "matcher broken, not codebase clean" |
| the excluded test file moves or is deleted | **1** | **1** | `structural/stale-exclude` (+ the resulting rise) |
| the pattern stops matching (typo'd regex) | **1** | **1** | `structural/zero-matches` (+ dropped) |
| the rule loses `floor` | **1** | **1** | shape-invalid, refused before scanning |

**How it fails loudly if its own precondition is absent:** the `floor: 4000` assertion is the one
that matters. If `src/` is restructured, an extension is renamed, or the walk is pointed
somewhere wrong, the run does not report "0 violations, clean" — it exits 1 saying the matcher is
broken. And `zero-matches` means a typo in the pattern cannot masquerade as a completed
migration. Both were induced and both fired.

### Sequencing

1. **Type move 1** (`no-restricted-imports` on framer's `useReducedMotion`, error-level) — removes
   §7.E's 28 files as a class. No count needed.
2. **Type move 2** (one predicate feeding both `MotionConfig` and the hook) — removes §7.A and
   makes §7.B unrepresentable.
3. **Merge this census rule** — freezes the population at 25 files / 28 matches while §7.D's 4
   real defects are fixed, then `--update` to 22 / 24 and lock the win in.
4. **Fix the ESLint rule** (`ConditionalExpression`, per-property transitions, positional-key
   check) — restores authoring-time feedback that currently points only at false positives.
5. §7.C and §8.6 are cross-path and need `page-loading.md` / `inline-busy-state.md` at the table.

## Convergence — `personas-web` (597 `.tsx`, no shared code) and `personas-cloud` (negative control)

`personas-cloud` confirmed clean as a control: **0** `.tsx`, **0** `.css`, **0**
`prefers-reduced-motion`. Everything below is `personas-web` independently rediscovering — or
not — each mechanic.

| Mechanic | Verdict | What it means for this path |
| --- | --- | --- |
| Global `@media (prefers-reduced-motion: reduce)` blanket with `animation-iteration-count: 1` | **REINVENTED** — `globals.css:794-826`, near-identical property list | **Physics.** Two codebases, no shared document, same four properties, same `!important`, same iteration-count kill. §2's "inherit it" is not local taste. |
| Inverse `@media (prefers-reduced-motion: no-preference)` opt-in for decorative loops | **REINVENTED** — 20 classes defined inside it (theirs is a larger, more disciplined use than ours) | **Physics.** Strengthens §3's recommendation of this pattern; they lean on it harder than we do and get a cleaner result. |
| A hand-rolled preference hook rather than the library's | **REINVENTED** — `QualityContext.tsx:146-175` (`useState`+`useEffect`, Context-hoisted) | **Physics that the library's hook is inadequate — two teams independently refused it.** But *our* `useSyncExternalStore` implementation is **local calibration**: theirs has the first-paint-wrong-value flash ours avoids. |
| `<MotionConfig reducedMotion="user">` | **REINVENTED, partial** — present on the `/m` route only; their own doc flags the gap | **Physics**, and evidence the root-wrapper placement is the hard part in both repos. |
| A motion-token / duration constant map | **REINVENTED** — `lib/animations.ts` flat `TRANSITION_*` consts + `EASE_CURVE`, plus `lib/timings.ts` | Confirms the `MOTION` token is a **vocabulary** mechanism, not an accessibility one — exactly the boundary asserted above. |
| A staggered-reveal primitive | **REINVENTED, partial** — `useStaggeredReveal` (mount-batching; gated: reduced motion returns the whole list at once) | **Physics.** Their gate does the same thing `RevealItem.tsx:53` does. No `useRevealTracker` equivalent. |
| **`toReducedVariants` / a variants transformer** | **ABSENT** — 5 name patterns searched, 0 hits | **Local calibration, and marked as such.** They hand-write the ternary in dozens of files. Ours is better, but §8.2 shows almost nothing uses it — a mechanism nobody else reinvented and our own repo barely adopts is a candidate for retirement, not promotion. |
| **An in-app global motion toggle** | **ABSENT** — no `data-motion`, no store key; only a non-persisted per-section pause button | **Local calibration.** The entire §7.A defect class is a cost this repo pays *for a feature the sibling chose not to build*. That does not make the setting wrong — it makes §7.A a self-inflicted obligation that must be honoured or the setting removed. |
| A custom ESLint rule about motion, at **warn** | **REINVENTED** — `require-animation-gating.js`, warn-level, in CI via `npm run lint` | **Physics, and the finding that matters most.** Two teams independently built a motion lint rule, both at warn, and **both rules are structurally blind to framer `repeat: Infinity`** — theirs keys on `requestAnimationFrame`/`<canvas>`, ours on `transition={{…}}`. The blind spot is convergent. |
| Runtime quality-tier degradation (FPS-sampled) | **REINVENTED**, not on our list | An orthogonal *performance* axis of motion reduction we do not have. Noted, not prescribed. |

**Where convergence contradicts me, honestly.** The sibling has the same disease and worse:
**8 of 34** framer `repeat: Infinity` files ungated (including both navbar logo glyphs, which loop
on every route), plus **1 ungated SVG SMIL** `repeatCount="indefinite"` that neither their CSS
blanket nor any `MotionConfig` can reach — where our SMIL is covered by `globals.css:4557`. Their
own doc even reasons its way to the wrong conclusion, asserting that framer components are
"quieted because framer-motion emits CSS/WAAPI animations that the global reduced-motion rule
pauses" — which is false for React `motion` components, as the framer 12.38.0 source read in §5.2
shows.

**That agreement is evidence about the shape of the problem, not a vote.** Both codebases built a
blanket CSS reset, both got the *appearance* of full coverage from it, and both left the JS loops
running underneath — because the reset is visible and the gap is not. P3 is stated the way it is
because two independent teams walked into it. **An accessibility floor is not settled by a
two-codebase majority**: the fact that the sibling also ships flashing elements to
reduced-motion users makes §7.D more urgent, not less.

---

**Sweep receipts.** 4,829 files walked · 221 files import `framer-motion` · 200 render
`<motion.*>`/`<m.*>` · 87 reference any reduced-motion token · 63 of the 200 do · 53 call
`useReducedMotion()` (28 from the wrong module, 23 from the right one, 2 private/other) · 27 call
`useMotion()` · 2 call `useMotionVariants()` · 3 reference `toReducedVariants` · 28 `repeat:
Infinity` in 25 files (6 invisible to the lint rule, of which 4 are genuine defects in 3 files) ·
1,240 `animate-*` class hits across 598
files (`animate-fade-slide-in` 339, `animate-fade-in` 322, `animate-spin` 254, `animate-pulse`
220, `animate-ping` 40) · 3,264 `transition-*` hits · 65 `@keyframes` in `src/styles` (29
`infinite`) + 20 injected from 7 `.tsx` files · 8 reduced-motion CSS blocks, 23-vs-5 selectors out
of sync · 5 SMIL `repeatCount` attributes in 4 files, all covered · 3 ESLint findings, all false
positives.
