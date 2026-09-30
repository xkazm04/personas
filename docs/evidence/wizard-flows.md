---
subject: wizard-flows
evidence:
  - src/features/templates/sub_n8n/reducers/navigationReducer.ts          # precondition inside the transition (GO_TO_STEP returns unchanged slice on failure) + one shared clamp for restore and fallback
  - src/features/templates/sub_n8n/hooks/useN8nSession.ts                 # durable pointer: debounced sync of step+payload to the session row, unmount flush
  - src/features/templates/sub_generated/adoption/questionnaire/useQuestionnaireKeyboardNav.ts  # guarded keyboard advancement (QuestionnaireForm.tsx, the unmounted composition, was deleted in e1eeeffa7)
  - src-tauri/core/src/models/build_session.rs                            # server-side resumable FSM: AwaitingInput phase, validate_transition, durable pending_question, hydration payload
  - src/features/plugins/twin/sub_training/useTrainingSession.ts          # generated interview: rubric coverage scoring, one-bounded follow-ups, per-answer promotion to durable memories, static fallback on generator failure
  - src/hooks/utility/data/usePersistedContext.ts                         # re-attach to an in-flight background job by id, max-age expiry of stale contexts
counter_evidence:
  # (src/features/shared/components/progress/WizardStepper.tsx, the shared stepper with two-state markers and zero live render paths, was deleted 2026-09-25 with the never-mounted CreateTemplateModal)
  - src/features/scraper/ScrapeEditorWizard.tsx                           # rail jumps to any step unguarded; the flow is saved only by a terminal re-check outside it
deviations:
  - w3-wizard-flows   # anchor in docs/concepts/golden-path-deferred-fixes.md
---

# Wizard Flows - evidence

How this codebase measures against the [`wizard-flows`](https://github.com/xkazm04/ai-registry) golden path. The standard lives in the registry; this file is the consumer-side layer and is edited here. Deviation anchors resolve in [golden-path-deferred-fixes.md](../concepts/golden-path-deferred-fixes.md).
