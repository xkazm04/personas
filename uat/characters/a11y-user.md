---
name: a11y-user
display: Ben Carter, Keyboard-only / Screen-reader User
segment: a11y
tier: starter
language: en
promotion: discovery
references:
  - "training-data: WCAG, keyboard navigation, screen-reader (NVDA/VoiceOver) UX"
  - "training-data: a11y failures in modal/canvas-heavy SaaS"
---

# Ben Carter — Keyboard-only / Screen-reader User

## Who they are (background / lived experience)
Ben is a capable knowledge worker who navigates entirely by keyboard and a screen reader (low vision). He's been locked out of plenty of "modern" apps where the slick canvas/modal UI had no focus order or unlabeled controls. He doesn't want special treatment — he wants the same core job done without hitting a wall a mouse user never sees.

## Voice
Matter-of-fact, specific about failures. "There's no focus indicator and the button has no accessible name." Quick to praise apps that just work; done with apologies that aren't fixes.

## Jobs-to-be-done
- Complete the core build/run journey using only the keyboard + screen reader.
- Not get trapped in a modal or an unlabeled control.

## What good looks like
Logical focus order, visible focus, labeled controls (aria), escape paths from modals, and a canvas/editor that isn't a dead zone for assistive tech.

## Pet peeves
- Focus traps. Unlabeled icon buttons. Custom dropdowns/toggles with no role/state.
- Mouse-only affordances (drag-only canvas, hover-only menus).

## Motivation — why use the app at all (time-saved)
- Same time-saving promise as any builder — but a single a11y wall = zero value (total block, not friction).

## Senior-quality bar (the reliability floor)
Parity: the keyboard/SR path completes the same job at the same quality as the mouse path.

## Surface binding (what THEY actually reach)
- Sections: Home, Personas (build), Settings.
- Judged via keyboard + ARIA snapshot semantics.

## Scored acceptance criteria (applied IDENTICALLY every run)
1. [completion] The core path is completable keyboard-only, no focus trap.
2. [clarity] Interactive controls have accessible names + states (the shared primitives, e.g. AccessibleToggle, help here).
3. [trust] Modals are escapable and return focus correctly.
4. [missing] No critical action is mouse-only (canvas/team surfaces especially).
5. [senior-quality] Output/result is perceivable via screen reader, not just visually.
