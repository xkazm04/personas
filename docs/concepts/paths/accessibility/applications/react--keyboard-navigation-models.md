---
layer: application
subject: accessibility
technique: keyboard-navigation-models
stack: react
---

# Keyboard navigation models — React shell and widgets (Personas)

Where the technique's models are implemented in this repo, and the measured
adoption gaps between the canonical mechanisms and the surfaces that should
consume them.

## Where each model lives

| Model | Implementation |
|---|---|
| Roving tabindex (arrows within, one stop outside) | `src/hooks/utility/interaction/useRovingTabIndex.ts` — WAI-ARIA pattern for horizontal composites: ArrowLeft/ArrowRight with wrap, Home/End, and the critical discipline that arrow movement moves *real focus and selection together* (`refs.current[next]?.focus()` after `onIndexChange`) |
| Skip link | `App.tsx:326-331` — first tab stop of the shell, `sr-only focus:not-sr-only`, jumps to the main-content anchor; visually hidden until focused, then painted as a real control (fixed, elevated, ring) |
| Landmarks | `Sidebar.tsx:169` — `role="navigation" aria-label="Primary"`; group rails labelled via `aria-labelledby` (`SidebarGroupNav.tsx:200,242`) |
| Shortcut discoverability | `src/lib/keyboard/ShortcutCheatSheet.tsx` — the `?` / Ctrl+/ overlay rendered entirely from `shortcutRegistry.ts`, the single authority both the cheat sheet and the bindings read; a binding added to the registry is discoverable by construction |
| Never-steal-typing guard | duplicated deliberately at every shortcut door: `isTypingTarget()` in `KeyboardNavMode.tsx:29-34` and `ShortcutCheatSheet.tsx:15-20`; `useQuestionnaireKeyboardNav.ts:44-88` applies the same semantics per-key (digits suppressed while typing, Shift+Enter keeps the textarea newline, arrows left to the caret while typing) |
| A designed modal navigation mode | `KeyboardNavMode.tsx` — `;` enters an explicit navigation mode (back, dock toggles), `Esc`/`;` exits, active state rendered as a viewport glow and hint keys under the dock capsules — a *visible* mode, not a hidden grammar; registered in `shortcutRegistry.ts` so the cheat sheet stays in sync |
| Global key ordering | `AppKeyboardProvider` (consumed by both chrome surfaces above) — the house convention the legacy corpus documented as P9: global handlers declare their position instead of racing `stopPropagation` |

## Where the implementation stops short of the technique

Reported, not re-registered:

- **The roving-tabindex mechanism has zero adopters.** No file outside
  `useRovingTabIndex.ts` imports it (re-verified this session; the legacy
  corpus measured the same on 2026-08-14). The canonical form exists while
  tab strips and toolbars hand-roll or omit arrow-key models — the
  N-tab-stops-per-widget failure the technique's split exists to prevent.
  Related registered finding: deferred fix #33, 21/21 tab strips with
  dangling `aria-controls`.
- **The hook is index-keyed by contract.** `useRovingTabIndex(count,
  activeIndex, onIndexChange)` leaves identity keying to the consumer; for
  static tablists that is fine, but any consumer with sortable/filterable
  members must map identity→index itself or inherit the teleporting-focus
  defect the technique bans. The technique's identity rule is a consumer
  obligation this signature cannot enforce.
- **Drag surfaces have no keyboard equivalent** — the registered
  `#w7-drag-drop` deviation (0/26 surfaces keyboard-operable, and
  `DragHandle` renders a focusable-looking affordance that no key can
  operate: the false-affordance ban violated at the shared-primitive
  level, which multiplies it into every consumer).
- **Keyboard focus does not hold a toast** — dwell pause is hover-only
  (`useToastTimer.ts`, registered at `#w3-toasts-notifications`): keyboard
  users get a strictly shorter action window than mouse users, the exact
  asymmetry the technique's reachable-on-demand rule targets.

## Transplant notes

The transplantable kernel is the *pairing*: a shortcut registry as the
single authority feeding both the bindings and the discoverability surface,
plus one shared `isTypingTarget` semantic at every door. The roving hook is
trivially portable but this repo's own measurement is the caution: shipping
the mechanism without wiring the composites is standard-without-adoption —
the gap belongs in whatever census or review gate the adopting repo runs.
