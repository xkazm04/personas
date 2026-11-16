import { Check, MessageSquare, Sparkles, FlaskConical, Rocket, PenLine } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useTourStore } from '@/stores/tourStore';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

const SUB_STEPS = [
  { id: 'enter-intent', labelKey: 'coach_substep_describe', icon: PenLine },
  { id: 'answer-questions', labelKey: 'coach_substep_answer', icon: MessageSquare },
  { id: 'review-draft', labelKey: 'coach_substep_review', icon: Sparkles },
  { id: 'test-promote', labelKey: 'coach_substep_promote', icon: Rocket },
] as const;

// The eight Glyph sigils, in petal order (see shared/glyph/dimMeta.ts).
// `key` MUST match the build engine's `buildCellStates` keys so each
// sigil's resolved-tick lights up as the build fills it in; colors mirror
// DIM_META so the coach reads as the same glyph the user is watching.
const MATRIX_DIMENSIONS = [
  { key: 'trigger', labelKey: 'dim_triggers', descKey: 'dim_triggers_desc', color: '#fbbf24' },
  { key: 'task', labelKey: 'dim_use_cases', descKey: 'dim_use_cases_desc', color: '#a78bfa' },
  { key: 'connector', labelKey: 'dim_connectors', descKey: 'dim_connectors_desc', color: '#22d3ee' },
  { key: 'message', labelKey: 'dim_messages', descKey: 'dim_messages_desc', color: '#60a5fa' },
  { key: 'review', labelKey: 'dim_human_review', descKey: 'dim_human_review_desc', color: '#fb7185' },
  { key: 'memory', labelKey: 'dim_memory', descKey: 'dim_memory_desc', color: '#c084fc' },
  { key: 'event', labelKey: 'dim_events', descKey: 'dim_events_desc', color: '#2dd4bf' },
  { key: 'error', labelKey: 'dim_error_handling', descKey: 'dim_error_handling_desc', color: '#fb923c' },
] as const;

const EXAMPLE_INTENT_KEYS = ['example_intent_1', 'example_intent_2', 'example_intent_3'] as const;

interface Props {
  subStepIndex: number;
}

export default function PersonaCreationCoach({ subStepIndex }: Props) {
  const { t, tx } = useTranslation();
  const buildPhase = useAgentStore((s) => s.buildPhase);
  const buildProgress = useAgentStore((s) => s.buildProgress);
  const pendingQuestions = useAgentStore((s) => s.buildPendingQuestions);
  const buildCellStates = useAgentStore((s) => s.buildCellStates);
  const buildTestPassed = useAgentStore((s) => s.buildTestPassed);

  // Auto-advance sub-steps based on build phase
  const effectiveSubStep = (() => {
    if (buildPhase === 'promoted' || buildPhase === 'test_complete') return 3;
    if (buildPhase === 'draft_ready') return 2;
    if (pendingQuestions.length > 0 && buildPhase === 'resolving') return 1;
    if (buildPhase === 'analyzing' || buildPhase === 'resolving') return 1;
    return subStepIndex;
  })();

  const resolvedCount = Object.values(buildCellStates).filter((s) => s === 'resolved').length;
  const completeness = resolvedCount > 0 ? Math.round((resolvedCount / 8) * 100) : 0;

  return (
    <div className="space-y-4" data-testid="tour-coach-root">
      {/* Sub-step progress */}
      <div className="flex items-center gap-1" data-testid="tour-coach-substep-progress">
        {SUB_STEPS.map((step, i) => {
          const isComplete = i < effectiveSubStep;
          const isCurrent = i === effectiveSubStep;
          return (
            <div
              key={step.id}
              data-testid={`tour-coach-substep-${step.id}`}
              className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-card typo-caption transition-all ${
                isComplete
                  ? 'bg-status-success/10 text-status-success'
                  : isCurrent
                    ? 'bg-status-success/5 text-status-success border border-status-success/20'
                    : 'bg-surface-1 text-ink-1'
              }`}
            >
              {isComplete ? <Check className="w-2.5 h-2.5 flex-shrink-0" /> : <step.icon className="w-2.5 h-2.5 flex-shrink-0" />}
              <span className="truncate">{t.onboarding[step.labelKey]}</span>
            </div>
          );
        })}
      </div>

      {/* Build phase indicator */}
      <div className="flex items-center gap-2 p-2 rounded-card bg-surface-1 border border-primary/8" data-testid="tour-coach-phase">
        <div className={`w-2 h-2 rounded-full ${
          buildPhase === 'promoted' ? 'bg-status-success' :
          buildPhase === 'test_complete' ? (buildTestPassed ? 'bg-status-success' : 'bg-status-error') :
          buildPhase === 'failed' ? 'bg-status-error' :
          'bg-status-warning animate-pulse'
        }`} />
        <span className="typo-caption text-ink-2 capitalize">{buildPhase.replace(/_/g, ' ')}</span>
        {buildProgress > 0 && buildProgress < 100 && (
          <span className="typo-caption text-ink-2 ml-auto">{Math.round(buildProgress)}%</span>
        )}
      </div>

      {/* Dynamic content per sub-step */}
      {effectiveSubStep === 0 && (
        <div className="space-y-3">
          <p className="typo-body text-ink-1">
            {t.onboarding.describe_intent}
          </p>
          <div className="space-y-1.5">
            <span className="typo-eyebrow text-ink-1">{t.onboarding.example_intents_label}</span>
            {EXAMPLE_INTENT_KEYS.map((key) => (
              <div key={key} className="px-3 py-2 rounded-card bg-status-success/5 border border-status-success/10 typo-body text-status-success">
                "{t.onboarding[key]}"
              </div>
            ))}
          </div>
          <p className="typo-caption text-ink-2 italic">
            {t.onboarding.intent_field_hint}
          </p>
        </div>
      )}

      {effectiveSubStep === 1 && (
        <div className="space-y-3">
          <p className="typo-body text-ink-1">
            {t.onboarding.analyzing_hint}
          </p>
          {pendingQuestions.length > 0 && (
            <div className="p-3 rounded-modal bg-status-warning/5 border border-status-warning/15">
              <p className="typo-body text-status-warning">
                {tx(pendingQuestions.length === 1 ? t.onboarding.questions_waiting_one : t.onboarding.questions_waiting_other, { count: pendingQuestions.length })}
              </p>
              <p className="typo-caption text-ink-2 mt-1">
                {t.onboarding.answer_questions_hint}
              </p>
            </div>
          )}
          <p className="typo-caption text-ink-2 italic">
            {t.onboarding.answers_help_hint}
          </p>
        </div>
      )}

      {effectiveSubStep === 2 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="typo-body text-ink-1">{t.onboarding.matrix_heading}</p>
            <span className="typo-caption text-status-success" data-testid="tour-coach-completeness">
              {tx(t.onboarding.matrix_completeness, { pct: completeness })}
            </span>
          </div>
          <div className="space-y-1">
            {MATRIX_DIMENSIONS.map((dim) => {
              const status = buildCellStates[dim.key];
              const isResolved = status === 'resolved';
              return (
                <div
                  key={dim.key}
                  data-testid={`tour-coach-matrix-cell-${dim.key}`}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-card typo-caption ${
                    isResolved ? 'bg-status-success/5' : 'bg-surface-1'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dim.color }} />
                  <span className={isResolved ? 'text-ink-1 font-medium' : 'text-ink-1'}>
                    {t.onboarding[dim.labelKey]}
                  </span>
                  <span className="text-ink-1 ml-auto truncate max-w-[120px]">{t.onboarding[dim.descKey]}</span>
                  {isResolved && <Check className="w-2.5 h-2.5 text-status-success flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {effectiveSubStep === 3 && (
        <div className="space-y-3">
          {buildTestPassed === true ? (
            <div className="p-3 rounded-modal bg-status-success/10 border border-status-success/20">
              <p className="typo-body text-status-success">{t.onboarding.all_tests_passed}</p>
              <p className="typo-caption text-ink-2 mt-1">
                {t.onboarding.promote_hint}
              </p>
            </div>
          ) : buildTestPassed === false ? (
            <div className="p-3 rounded-modal bg-status-error/10 border border-status-error/20">
              <p className="typo-body text-status-error">{t.onboarding.some_tests_failed}</p>
              <p className="typo-caption text-ink-2 mt-1">
                {t.onboarding.refine_hint}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="typo-body text-ink-1">
                {t.onboarding.testing_description}
              </p>
              <div className="p-3 rounded-modal bg-status-success/5 border border-status-success/15">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-status-success" />
                  <p className="typo-body text-status-success">{t.onboarding.what_testing_checks}</p>
                </div>
                <ul className="mt-2 space-y-1 typo-caption text-ink-1">
                  <li>• {t.onboarding.test_check_api}</li>
                  <li>• {t.onboarding.test_check_creds}</li>
                  <li>• {t.onboarding.test_check_format}</li>
                </ul>
              </div>
              <p className="typo-caption text-ink-2 italic">
                {t.onboarding.run_test_hint}
              </p>
            </div>
          )}

          {buildPhase === 'promoted' && (
            <div className="p-3 rounded-modal bg-status-success/15 border border-status-success/25">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-status-success" />
                <p className="typo-body text-status-success">{t.onboarding.agent_promoted}</p>
              </div>
              <p className="typo-caption text-ink-2 mt-1">
                {t.onboarding.agent_promoted_hint}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Skip option */}
      {effectiveSubStep < 3 && buildPhase !== 'promoted' && (
        <Button
          type="button"
          onClick={() => {
            useTourStore.getState().emitTourEvent('tour:persona-promoted');
          }}
          data-testid="tour-coach-skip"
          variant="ghost"
          size="sm"
          className="w-full"
        >{t.onboarding.skip_build}</Button>
      )}
    </div>
  );
}
