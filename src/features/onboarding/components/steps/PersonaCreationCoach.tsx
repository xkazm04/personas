import { Check, MessageSquare, Sparkles, FlaskConical, Rocket, PenLine } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

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
              className={`flex-1 flex items-center gap-1.5 px-2 py-1.5 rounded-card text-[11px] transition-all ${
                isComplete
                  ? 'bg-emerald-500/10 text-emerald-400'
                  : isCurrent
                    ? 'bg-emerald-500/5 text-emerald-300 font-medium border border-emerald-500/20'
                    : 'bg-secondary/20 text-foreground'
              }`}
            >
              {isComplete ? <Check className="w-2.5 h-2.5 flex-shrink-0" /> : <step.icon className="w-2.5 h-2.5 flex-shrink-0" />}
              <span className="truncate">{t.onboarding[step.labelKey]}</span>
            </div>
          );
        })}
      </div>

      {/* Build phase indicator */}
      <div className="flex items-center gap-2 p-2 rounded-card bg-secondary/20 border border-primary/8" data-testid="tour-coach-phase">
        <div className={`w-2 h-2 rounded-full ${
          buildPhase === 'promoted' ? 'bg-emerald-400' :
          buildPhase === 'test_complete' ? (buildTestPassed ? 'bg-emerald-400' : 'bg-red-400') :
          buildPhase === 'failed' ? 'bg-red-400' :
          'bg-amber-400 animate-pulse'
        }`} />
        <span className="text-[11px] text-foreground capitalize">{buildPhase.replace(/_/g, ' ')}</span>
        {buildProgress > 0 && buildProgress < 100 && (
          <span className="text-[11px] text-foreground ml-auto">{Math.round(buildProgress)}%</span>
        )}
      </div>

      {/* Dynamic content per sub-step */}
      {effectiveSubStep === 0 && (
        <div className="space-y-3">
          <p className="typo-body text-foreground">
            {t.onboarding.describe_intent}
          </p>
          <div className="space-y-1.5">
            <span className="text-[11px] text-foreground uppercase tracking-wider">{t.onboarding.example_intents_label}</span>
            {EXAMPLE_INTENT_KEYS.map((key) => (
              <div key={key} className="px-3 py-2 rounded-card bg-emerald-500/5 border border-emerald-500/10 typo-body text-emerald-300/70">
                "{t.onboarding[key]}"
              </div>
            ))}
          </div>
          <p className="text-[11px] text-foreground italic">
            {t.onboarding.intent_field_hint}
          </p>
        </div>
      )}

      {effectiveSubStep === 1 && (
        <div className="space-y-3">
          <p className="typo-body text-foreground">
            {t.onboarding.analyzing_hint}
          </p>
          {pendingQuestions.length > 0 && (
            <div className="p-3 rounded-modal bg-amber-500/5 border border-amber-500/15">
              <p className="typo-body text-amber-300/80 font-medium">
                {tx(pendingQuestions.length === 1 ? t.onboarding.questions_waiting_one : t.onboarding.questions_waiting_other, { count: pendingQuestions.length })}
              </p>
              <p className="text-[11px] text-foreground mt-1">
                {t.onboarding.answer_questions_hint}
              </p>
            </div>
          )}
          <p className="text-[11px] text-foreground italic">
            {t.onboarding.answers_help_hint}
          </p>
        </div>
      )}

      {effectiveSubStep === 2 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="typo-body text-foreground">{t.onboarding.matrix_heading}</p>
            <span className="text-[11px] text-emerald-400 font-medium" data-testid="tour-coach-completeness">
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
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-card text-[11px] ${
                    isResolved ? 'bg-emerald-500/5' : 'bg-secondary/10'
                  }`}
                >
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: dim.color }} />
                  <span className={isResolved ? 'text-foreground font-medium' : 'text-foreground'}>
                    {t.onboarding[dim.labelKey]}
                  </span>
                  <span className="text-foreground ml-auto truncate max-w-[120px]">{t.onboarding[dim.descKey]}</span>
                  {isResolved && <Check className="w-2.5 h-2.5 text-emerald-400 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {effectiveSubStep === 3 && (
        <div className="space-y-3">
          {buildTestPassed === true ? (
            <div className="p-3 rounded-modal bg-emerald-500/10 border border-emerald-500/20">
              <p className="typo-body text-emerald-300 font-medium">{t.onboarding.all_tests_passed}</p>
              <p className="text-[11px] text-foreground mt-1">
                {t.onboarding.promote_hint}
              </p>
            </div>
          ) : buildTestPassed === false ? (
            <div className="p-3 rounded-modal bg-red-500/10 border border-red-500/20">
              <p className="typo-body text-red-300 font-medium">{t.onboarding.some_tests_failed}</p>
              <p className="text-[11px] text-foreground mt-1">
                {t.onboarding.refine_hint}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="typo-body text-foreground">
                {t.onboarding.testing_description}
              </p>
              <div className="p-3 rounded-modal bg-emerald-500/5 border border-emerald-500/15">
                <div className="flex items-center gap-2">
                  <FlaskConical className="w-4 h-4 text-emerald-400" />
                  <p className="typo-body text-emerald-300/80 font-medium">{t.onboarding.what_testing_checks}</p>
                </div>
                <ul className="mt-2 space-y-1 text-[11px] text-foreground">
                  <li>• {t.onboarding.test_check_api}</li>
                  <li>• {t.onboarding.test_check_creds}</li>
                  <li>• {t.onboarding.test_check_format}</li>
                </ul>
              </div>
              <p className="text-[11px] text-foreground italic">
                {t.onboarding.run_test_hint}
              </p>
            </div>
          )}

          {buildPhase === 'promoted' && (
            <div className="p-3 rounded-modal bg-emerald-500/15 border border-emerald-500/25">
              <div className="flex items-center gap-2">
                <Rocket className="w-4 h-4 text-emerald-400" />
                <p className="typo-body text-emerald-300 font-medium">{t.onboarding.agent_promoted}</p>
              </div>
              <p className="text-[11px] text-foreground mt-1">
                {t.onboarding.agent_promoted_hint}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Skip option */}
      {effectiveSubStep < 3 && buildPhase !== 'promoted' && (
        <button
          onClick={() => {
            useSystemStore.getState().emitTourEvent('tour:persona-promoted');
          }}
          className="w-full text-center text-[11px] text-foreground hover:text-muted-foreground/60 transition-colors py-1"
          data-testid="tour-coach-skip"
        >
          {t.onboarding.skip_build}
        </button>
      )}
    </div>
  );
}
