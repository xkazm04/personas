---
subject: draft-editing
evidence:
  - src/features/agents/sub_editor/libs/PersonaDraft.ts               # draft type + key groups + compile-time group-map exhaustiveness + incident-documented timeout default
  - src/features/agents/sub_editor/hooks/useEditorDraft.ts            # construction, patch door, identity-guarded reseed, corrupt-source save suppression
  - src/features/agents/sub_editor/libs/useEditorSave.ts              # per-group derived dirty + per-group baseline advance on confirmed success
  - src/features/agents/sub_editor/libs/useDebouncedSaveGroup.ts      # in-flight lock + sent-payload snapshot comparison (race 2)
  - src/features/agents/sub_editor/libs/EditorDocument.tsx            # region registry: dirty aggregate, saveAll stop-on-first-failure, dirty-tab-without-save throws
  - src/hooks/utility/interaction/useUnsavedGuard.ts                  # the exit interceptor (nav + window close, save/discard/stay)
  - src/features/agents/sub_editor/libs/usePersonaReadiness.ts        # single readiness resolver: reasons + badge derived from one place
  - src/api/agents/personas.ts                                        # operation union + buildUpdateInput — apply as intent-derived diff, never call-site payloads
  - docs/concepts/golden-paths/entity-draft-editing.md                # legacy census: 55 reseeds, 17 dirty mechanisms, replay-proven diff-not-record result
  - docs/concepts/golden-paths/debounced-autosave.md                  # legacy census: 13 debounced write sites, executed teardown scenarios, zero window-close drains
counter_evidence:
  - src/lib/ui/BaseModal.tsx                                          # escape/backdrop close unconditionally — a draft in a modal cannot join the interceptor
deviations:
  - w7-draft-editing   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Draft Editing - evidence

How this codebase measures against the [`draft-editing`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
