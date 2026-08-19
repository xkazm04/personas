---
layer: application
subject: toasts-notifications
technique: queue-discipline
stack: react
---

# Queue discipline — React toast stack (Personas)

The technique's queue-with-policy, as implemented by the Zustand toast store
plus its single renderer, and where the implementation stops short of the
standard.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| State cap vs render budget (two numbers) | `src/stores/toastStore.ts` — `MAX_TOASTS = 10` (state), `MAX_VISIBLE_TOASTS = 3` (screen) |
| Eviction by importance, not recency | `capToasts()` (`toastStore.ts:89-95`): sorts by `priority` desc then timestamp, slices to 10, restores timestamp order. Its docstring names the failure it prevents — a burst of successes must not push out an unseen critical |
| Priority ladder | `STANDARD_PRIORITY` / `HEALING_PRIORITY` (`toastStore.ts:54-65`): healing critical 40 > high 30 > medium 25 > error 20 > warning 18 > healing low 15 > success 10 |
| Dwell per severity | `DEFAULT_DURATION` (`toastStore.ts:71-75`): success 3000ms, warning 4000ms, error 5000ms; healing 8000ms. A measured 93.3% of call sites pass no duration — the policy genuinely holds |
| Overflow made visible | `ToastContainer.tsx:288-299` — sorted list sliced to `MAX_VISIBLE_TOASTS`; the remainder renders a counted chip (`toast_overflow` with `{ count }`), never a silent drop |
| Attention pauses the clock | `useToastTimer.ts` — one RAF loop; `isPaused = paused || !isDocumentVisible` (hover pause + hidden-window pause), and `lastTickRef.current = Date.now()` on mouse-leave is the drift correction that stops the hovered interval from counting as elapsed |
| Identity, not position | every toast gets `id` at creation (`toast-${++nextId}`); rendering, `AnimatePresence` exit, and dismissal all key on it. Healing toasts mint identity from the domain (`healing-${issueId}`) |
| Dedup | healing toasts dedup by `issueId` — a repeat replaces the live toast for the same issue (`addHealingToast`, `toastStore.ts:160-164`) instead of stacking a sibling |
| Reduced motion | `useReducedMotion()` in the container swaps slide/scale entrances for opacity-only |

## Judgment calls worth copying

- **The cap sorts twice.** `capToasts` sorts by priority to *choose survivors*,
  then re-sorts by timestamp to *restore display order*. Eviction policy and
  ordering policy are different decisions and the code keeps them separate.
- **The dwell timer is not the progress bar.** The RAF loop owns dismissal;
  the visible countdown is a CSS animation paused via a `data-paused`
  attribute. Pause/resume stays smooth because the two clocks never fight.
- **A hidden window is a pause.** `useDocumentVisibility()` feeds the same
  paused bit as hover, so a backgrounded app does not burn dwell on messages
  nobody could have read. A sibling repo measured without this ships an undo
  timer that commits an irreversible bulk write while the tab is hidden —
  the exact defect class this line prevents.

## Gaps against the technique (deviations, reported not fixed)

- **No keyboard/focus pause.** `useToastTimer` returns only
  `onMouseEnter`/`onMouseLeave`; the action and dismiss buttons are focusable,
  so a keyboard user can tab into a toast that dismisses under them. The
  technique requires focus to pause dwell equally with hover.
- **No semantic-key coalescing for standard toasts.** Only the healing
  variant dedups (by `issueId`); a repeating standard error earns a toast per
  occurrence with no counted coalescing and no cooldown window.
- **No persistence tier.** `duration` is a bare number with no
  persist-until-acted escape; action-required messages auto-dismiss like
  everything else. Call sites that needed persistence spelled it as a magic
  30000ms — the missing feature expressed as a workaround.
- **Overflowed toasts do not age.** Only visible items mount a timer, so
  ranks 4–10 wait un-clocked and receive a full fresh dwell on promotion; a
  burst of ten drains in ~50s of old news — the technique's
  summarize-the-tail step is absent.
- **A second, independent stack exists.**
  `src/features/overview/sub_observability/components/AlertToastContainer.tsx`
  re-implements the queue with none of the policy: fixed 8s dwell, no pause,
  silent drop past five, its own tone vocabulary. It is the counter-example
  for the whole technique — the sixth-surface failure mode caught at n=2.
