# Dev Experience Fix Wave 4.4 — copy-to-clipboard mechanical tail

> 5 atomic commits across 5 batched clusters. Baseline tsc 0 → 0 errors maintained.

## Commits

| # | Commit | Cluster | Sites |
|---|---|---|---:|
| 1 | `05dc2a61` refactor(triggers): migrate 3 inline copy-to-clipboard sites to shared hook | triggers (W4.4a) | 3 (WebhookConfig, useTriggerDetail twin, EventDetailModal) |
| 2 | `97248a7a` refactor: migrate 3 inline copy-to-clipboard sites (sharing + editors) | sharing+editors (W4.4b) | 3 (IdentitySettings, DraftJsonTab, ErrorBoundary) |
| 3 | `2b3ce08d` refactor(vault): migrate 4 inline copy-to-clipboard sites to shared hook | vault (W4.4c) | 4 (OverviewTab, ResponseViewer, setupMarkdownComponents.CopyButton, AutoCredLogEntries.CopyLogButton) |
| 4 | `8561a5d2` refactor: migrate 5 inline copy-to-clipboard sites (overview/recipes/deployment/templates) | overview/recipes/deploy/templates (W4.4d) | 5 (MessageDetailModal, RecipeOutputSection twin, ApiPlayground, TestReportModal, useDesignRunnerState) |
| 5 | `c9d87ade` feat(hooks): add useKeyedCopyFlag + migrate 5 keyed-by-id copy sites | keyed (W4.4e) | 6 (DeploymentCard, CloudWebhooksTab, WebhookRequestInspector, ChatTab, QueryResultTable + useCredentialTags) |

**Total this wave:** 21 sites migrated across 19 files, ~140 LOC removed.

## What was added

- **`useKeyedCopyFlag<K>(timeout?)`** in `src/hooks/utility/interaction/useKeyedCopyFlag.ts` — keyed sibling of `useCopyToClipboard`. Returns `{ copiedKey, copy(key, text) }`. Same unmount-cleanup discipline as the boolean hook.

## What was deferred (4 sites left in repo)

| Site | Reason |
|---|---|
| `ChatBubbles.CopyBtn` | Has `legacyCopy` fallback for non-secure-context Tauri configs that the hook doesn't model. Migration would either lose the fallback or require expanding the hook's API to accept a fallback callback. |
| `BundleExportDialog` (2 sites) | Wraps writes with `scheduleSensitiveClipboardClear` (security feature for bundle data + share-link data). Migration would lose the security wrapping or require a "before-write hook" surface. |
| `FieldCaptureHelpers.handleCopy` | Has security-critical clipboard-wipe-after-TTL path that depends on knowing when the copy completed; the hook's fire-and-forget promise can't easily expose that. |
| `EventLogList` + `EventLogItem` | `setCopiedPayload` is passed as a prop across components AND explicitly reset on dialog close; needs refactor to colocate state before the hook can replace it. |
| 5 sites in old `sub_executions/detail/views/` | In the W1.2-deferred old tree; will be migrated as part of that consolidation. |

## Cumulative status across the whole scan

| Wave | Status |
|---|---|
| 1 (dead trees) | All criticals closed or deferred-with-blocker |
| 2 (test infra) | not started |
| 3 (type drift) | 5 of 6 closed (W3.6 ts-rs deferred) |
| 4 (shared primitives) | **KpiTile complete + ~25 copy-to-clipboard sites migrated + 1 keyed-copy hook added.** Remaining: mapOverallStatus dedup + usePickerFilters factory + 7 deferred copy sites with structural blockers. |
| 5 (race-condition consolidation) | starter pass done |
| 6 (mega-monolith decomposition + docs) | not started |

The "copy-to-clipboard mechanical tail" is now substantially closed. The 7 deferred sites need structural changes (cross-component refactor, or hook-API expansion for fallback/security paths) — those are no longer "mechanical migrations" but small designable follow-ups.

## Patterns established (item 16)

16. **When the simple primitive doesn't fit, design a sibling, don't bloat the original.** W4.4e needed keyed-by-id copy feedback (different from boolean copy feedback). Adding a `key?: K` parameter to `useCopyToClipboard` would have made the simple case worse (every consumer would have to opt out of keying); creating `useKeyedCopyFlag<K>` as a separate, focused hook keeps both cleanly typed. The two hooks share the same unmount-cleanup pattern, so they read as deliberate variants rather than independent implementations.
