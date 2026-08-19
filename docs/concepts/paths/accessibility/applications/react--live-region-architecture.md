---
layer: application
subject: accessibility
technique: live-region-architecture
stack: react
---

# Live region architecture — React announcer (Personas)

The technique's one-provider/drain-queue/keyed-remount architecture, as
implemented by `AriaLiveProvider`, and the measured places where the repo
still runs scattered regions beside it.

## Where each mechanism lives

| Mechanism | Implementation |
|---|---|
| One provider, mounted with the shell | `src/features/shared/components/feedback/AriaLiveProvider.tsx`, mounted exactly once inside `App.tsx` (verified single mount; the legacy corpus re-confirmed it at `App.tsx:322`) |
| Two persistent regions, one per politeness | `AriaLiveProvider.tsx:96-116` — polite is `role="status" aria-live="polite" aria-atomic`, assertive is `role="alert" aria-live="assertive"`, both `sr-only`, both alive for the session (regions exist *before* the news — platform semantics #1) |
| One imperative door for non-component writers | `_registerAnnounce` / `announceImperative` (`AriaLiveProvider.tsx:147-160`) — store subscribers announce without owning a region; the module-level handle no-ops before mount rather than throwing |
| Drain queue for bursts | `queueRef` + `drain()` (`AriaLiveProvider.tsx:39-59`). The in-file comment names the exact failure the queue kills: React coalesces same-tick state sets, so a burst would voice only the LAST message — semantics #2 (last write wins) manifesting through the framework's own batching |
| Serial spacing | `setTimeout(drain, 150)` (`:58`) — one message per drain tick so the reader finishes an utterance before the region's text is replaced |
| Deliberate re-announcement of repeats | keyed remount: every drain mints `++keyRef.current` and renders `key={`polite-${politeKey}`}` (`:48`, `:98`), forcing a fresh node so an identical consecutive string is a genuine mutation — semantics #3 defeated on purpose, at the provider, invisible to call sites |
| Reaper on the drain timer | unmount effect clears `timerRef` (`:83-90`), and the unregister guard only nulls the imperative handle if it still owns it (`:74-79`) — a remounted provider is not silenced by its predecessor's cleanup |
| Politeness decided by the calling domain | `toastStore.ts:138` maps severity → politeness (`error` announces assertive, the rest polite); `:168` maps healing urgency. The provider carries no consumer taxonomy — the mapping table lives with the severity vocabulary that owns it |

## Where the implementation stops short of the technique

Reported, not re-registered — the announcement-side gaps are anchored at
`#w3-toasts-notifications` in `docs/concepts/golden-path-deferred-fixes.md`:

- **The one-writer rule does not hold repo-wide.** `ToastContainer.tsx:282-284`
  is itself `role="status" aria-live="polite" aria-relevant="additions removals"`
  while `toastStore` also routes every toast through `announceImperative` —
  the registered double-announcement, with error toasts voicing raw copy via
  the provider and friendly copy via the container. Beyond toasts, ~40 files
  carry their own `aria-live` attributes (e.g. the sidebar's badge region at
  `Sidebar.tsx:178-184`, `AthenaChatLiveRegion.tsx`, `AlertToastContainer.tsx`
  — the second toast stack, which has no announcement path at all). Some are
  legitimate pattern-internal live semantics (results counts, streaming
  status); the population as a whole is unenumerated, so "what does this
  product ever say?" has no grep-shaped answer yet.
- **The queue has no coalescing and no bound.** `drain()` is strictly FIFO:
  no semantic-key dedup, no assertive-preempts-polite ordering (an assertive
  message queues behind earlier polite ones), and no storm shedding — a
  burst of N identical failures voices N utterances, 150ms apart.
- **Queue policy is untested.** The provider's utterance sequence — order,
  spacing, repeat remounts — is testable pure logic (the technique's
  strongest testability claim) but no test currently drives it.

## Transplant notes

The provider is ~160 lines with zero repo-specific imports beyond the
framework — the cleanest possible seed for a sibling repo. What a
transplant must carry along: the mount-once-at-shell rule, the
severity→politeness mapping staying in the consumer's vocabulary module,
and a lint or census rule that inventories stray `aria-live` attributes —
the architecture decays by scattered regions, and this repo measures what
that looks like.
