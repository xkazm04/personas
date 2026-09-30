---
subject: modal-stack
evidence:
  - src/lib/ui/ModalStackContext.tsx                                  # the app-wide overlay stack registry: minted ids, depth/total/isTopmost, subscriber notification
  - src/lib/ui/BaseModal.tsx                                          # the one modal host: dialog semantics, topmost-only escape, focus capture/cycle/restore, depth-derived layer
  - src/features/shared/components/overlays/ConfirmDestructiveModal.tsx  # friction proportional to blast radius: type-to-confirm, detail rows, blast-radius slot
counter_evidence:
  - src/features/templates/sub_generated/adoption/chronology/TestReportModal.tsx  # hand-rolled overlay outside the stack, z-bumped past the host's portal base to win a paint fight
deviations:
  - w1-modal-stack   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Modal Stack - evidence

How this codebase measures against the [`modal-stack`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
