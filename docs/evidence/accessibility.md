---
subject: accessibility
evidence:
  - src/features/shared/components/feedback/AriaLiveProvider.tsx    # one provider, polite+assertive persistent regions, serial drain queue, keyed remount for duplicate re-announcement, imperative door for non-component writers, timer reaped on unmount (WCAG 4.1.3 cited in-file)
  - src/features/shared/components/forms/AccessibleToggle.tsx       # the primitive contract in one file: native button, switch role + checked state property, REQUIRED label prop, Enter/Space, focus-visible ring, sr-only state text
  - src/hooks/utility/interaction/useRovingTabIndex.ts              # the shared roving-tabindex mechanism: arrows/Home/End, wrap, focus+selection moved together
  - src/features/templates/sub_generated/adoption/questionnaire/useQuestionnaireKeyboardNav.ts   # shortcut layer with the never-steal-typing guard on all three bindings (digits, Enter, arrows)
  - src/App.tsx                                                     # skip link (sr-only until focused, targets main content) as an early tab stop; AriaLiveProvider mounted exactly once at the shell; reduced-motion preference wired at the root
  - src/features/shared/chrome/sidebar/Sidebar.tsx                  # landmark navigation with accessible name; badge count changes announced via a visually-hidden polite region (translated sr strings)
  - src/lib/keyboard/ShortcutCheatSheet.tsx                         # shortcut discoverability: `?` cheat sheet rendered from the single shortcutRegistry authority
  - scripts/check-themes.mjs                                        # the contrast floor as a hard CI gate at the token-definition site: AA 4.5:1 across every theme, including the opacity-tinted caption edge
counter_evidence:
  - src/hooks/utility/interaction/useRovingTabIndex.ts              # same file, adoption half: zero consumers outside its own file — the canonical mechanism exists and composites hand-roll or omit arrow-key models
deviations:
  - w10-accessibility   # anchor in docs/concepts/golden-path-deferred-fixes.md
  - w7-drag-drop              # 0/26 drag surfaces keyboard-operable; DragHandle false affordance — anchor in docs/concepts/golden-path-deferred-fixes.md
  - w3-data-viz               # no chart carries a text equivalent
  - w3-toasts-notifications   # hover-only timer pause (keyboard focus doesn't hold a toast); double live-region announcement
  - w3-design-tokens          # derived custom themes bypass the contrast gate — user-authored themes ship below AA
---

# Accessibility - evidence

How this codebase measures against the [`accessibility`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
