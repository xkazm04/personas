# Reduced-motion compliance

The app honours the user's `prefers-reduced-motion` preference (and an in-app
override) across **four** layers. WCAG 2.3.3 (Animation from Interactions) and
the vestibular-disorder accessibility case are the why; the layered design is so
that no single category of animation — Framer transforms, CSS keyframes, SVG
SMIL, or JS-driven loops — can slip the gate.

## The four layers

1. **Global Framer gate — `<MotionConfig reducedMotion=…>`** (`src/App.tsx`).
   Wraps the whole tree. With `reducedMotion="user"`, Framer Motion disables
   **one-shot transform and layout animations** when the OS requests reduced
   motion, while preserving opacity. This covers the bulk of entrance/exit
   transitions for free. **It does _not_ stop looping animations** (`repeat`)
   or animations on non-transform properties (an opacity pulse keeps cycling).

2. **Global CSS reset** (`src/styles/globals.css`).
   - `@media (prefers-reduced-motion: reduce)` collapses every CSS
     animation/transition to `0.01ms`, forces `animation-iteration-count: 1`
     (kills infinite loops), hides SVG SMIL (`<animate>`/`<animateTransform>`/
     `<animateMotion>`), and zeroes the glow/shimmer keyframe system.
   - `html[data-motion="reduce"]` mirrors the same ruleset for the **in-app
     toggle** (independent of the OS setting). Keep the two blocks in sync — the
     toggle block previously omitted the iteration-count / SMIL / loop handling,
     leaving infinite animations spinning at 0.01ms (a silent busy-paint loop).

3. **`useMotionVariants()` — the variants gate**
   (`src/hooks/utility/interaction/useMotion.ts`).
   The single wrapper for Framer `variants`. Pass full-motion variants, get back
   either the originals or an instant, **movement-free** clone (translate / scale
   / rotate stripped, `staggerChildren` / `delayChildren` / `repeat` / `delay`
   removed, keyframe arrays collapsed to their final value, transition forced to
   an instant tween). Use it whenever a variant relies on a stagger cascade or a
   non-transform/looping property that layer 1 won't catch.

   ```tsx
   import { useMotionVariants } from '@/hooks/utility/interaction/useMotion';
   const variants = useMotionVariants(staggerContainer);
   <motion.div variants={variants} initial="hidden" animate="visible" />
   ```

   `toReducedVariants(variants)` is the pure, hook-free version for module scope.
   For raw inline loops (not variants), gate with `useReducedMotion()` and render
   a static state instead — see `ProcessActivityIndicator.tsx` for the pattern.

4. **ESLint guard — `custom/enforce-reduced-motion-fallback`**
   (`eslint-rules/enforce-reduced-motion-fallback.cjs`, warn-level).
   Flags `motion.*` / `m.*` elements whose `animate` prop drives a **repeating**
   animation (`transition.repeat`) in a file with no reduced-motion fallback —
   precisely the gap layer 1 leaves open. A file is trusted (and skipped) if it
   references `useReducedMotion`, `useMotion`, `useMotionVariants`,
   `useTemplateMotion`, `toReducedVariants`, `prefersReducedMotion`, or
   `shouldAnimate`. Silence a deliberate one-off with `// reduced-motion-ok: …`.

## Fixing a flagged component

- **Variants-based** → wrap with `useMotionVariants()`.
- **Inline looping `animate`** → gate with `useReducedMotion()`; render a static
  fallback (e.g. a steady ring at the pulse's mid opacity) when reduced.
- **Genuinely fine** (loop is essential and non-vestibular, e.g. a spinner the
  global CSS already neutralises) → `// reduced-motion-ok: <reason>`.

Per the repo's fix-as-you-touch policy, do not bulk-migrate; clear the warning
on files you're already editing.
