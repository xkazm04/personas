import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { usePendingInteractions } from './usePendingInteractions';
import { QuickAnswerQuestionGroup } from './QuickAnswerQuestionGroup';
import { QuickAnswerReviewStepper } from './QuickAnswerReviewStepper';

/**
 * The Quick Answer content — pending build/adoption questions + human reviews —
 * with no positioning chrome of its own. Extracted from `QuickAnswerPopover` so
 * the SAME surface can live in the titlebar popover AND embedded as a panel
 * (e.g. the Channel Timeline workspace's right sidebar). Owns its data via
 * `usePendingInteractions`; the host supplies only an optional post-navigation
 * callback (the popover closes itself when deep-linking to a builder).
 */

/** Deep-link to a persona's builder surface (the C-ready seam for complex
 *  questions), mirroring the Monitor's process navigation. */
function openBuilder(personaId: string, after?: () => void) {
  const system = useSystemStore.getState();
  system.setSidebarSection('personas');
  system.setEditorTab('matrix' as Parameters<typeof system.setEditorTab>[0]);
  useAgentStore.getState().selectPersona(personaId);
  after?.();
}

export function QuickAnswerBody({ onAfterBuilderNav }: { onAfterBuilderNav?: () => void }) {
  // Standalone host (e.g. ConversationBriefing): mount the data layer here.
  const interactions = usePendingInteractions();
  return <QuickAnswerBodyView interactions={interactions} onAfterBuilderNav={onAfterBuilderNav} />;
}

/**
 * Pure view over an already-mounted `usePendingInteractions` instance. The
 * popover mounts the hook ONCE and renders this directly — previously both
 * the popover (for the header count) and the body mounted independent hook
 * instances, doubling every initial fetch and all four polling loops
 * (including a 300-row message scan) while the popover was open.
 */
export function QuickAnswerBodyView({ interactions, onAfterBuilderNav }: {
  interactions: ReturnType<typeof usePendingInteractions>;
  onAfterBuilderNav?: () => void;
}) {
  const { t } = useTranslation();
  const {
    questionGroups, reviews, total, loading, reviewsError, isProcessing,
    submitQuestionAnswers, handleReviewAction, handleDispatchAction,
  } = interactions;

  // Three states, not one. The hook has always returned `loading` and this view
  // never destructured it, so the "all caught up" checkmark was shown on first
  // paint — before a single fetch had landed — and again on a fetch that FAILED,
  // because a failed review load reached here as an empty array and nothing
  // else. Both read as "nothing is waiting on you".
  if (total === 0 && loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
        {/* The spinner IS the announcement (it renders an `sr-only`
            `role="status"` and nothing else), so the visible copy is hidden
            from assistive tech rather than read out twice. */}
        <LoadingSpinner label={t.monitor.quick_loading} />
        <span className="typo-body text-foreground" aria-hidden>
          {t.monitor.quick_loading}
        </span>
      </div>
    );
  }

  if (total === 0 && reviewsError) {
    return (
      <InlineErrorBanner
        severity="error"
        title={t.monitor.quick_error_title}
        message={t.monitor.quick_error_body}
        compact
      />
    );
  }

  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
        <CheckCircle2 className="w-9 h-9 text-emerald-400/80" />
        <span className="typo-body-lg font-medium text-foreground">{t.monitor.quick_empty_title}</span>
        <span className="typo-body text-foreground max-w-[300px]">{t.monitor.quick_empty_body}</span>
      </div>
    );
  }

  return (
    <>
      {/* A PARTIAL failure still has to say so: the questions rendered below are
          real, and the reviews half of this surface is missing. */}
      {reviewsError ? (
        <InlineErrorBanner
          severity="warning"
          message={t.monitor.quick_error_body}
          compact
        />
      ) : null}
      {questionGroups.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <span className="typo-label font-bold text-foreground">
            {t.monitor.quick_questions_header}
          </span>
          {questionGroups.map((g) => (
            <QuickAnswerQuestionGroup
              key={g.sessionId}
              group={g}
              busy={isProcessing}
              onSubmit={submitQuestionAnswers}
              onOpenBuilder={(pid) => openBuilder(pid, onAfterBuilderNav)}
            />
          ))}
        </section>
      )}
      {reviews.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <span className="typo-label font-bold text-foreground">
            {t.monitor.quick_reviews_header}
          </span>
          {/* One decision at a time, full description + the suggested actions
              as clickable triage branches. */}
          <QuickAnswerReviewStepper
            reviews={reviews}
            busy={isProcessing}
            onAction={handleReviewAction}
            onDispatchAction={handleDispatchAction}
          />
        </section>
      )}
    </>
  );
}

export default QuickAnswerBody;
