import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useTourStore } from '@/stores/tourStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useResumeContext, clearLastEdited, ackFailure, type ResumeContext } from './useResumeContext';

export interface ResumeAction {
  kind: ResumeContext['kind'];
  /** The one sentence the pointer says. */
  label: string;
  /** Jump to the right surface: the persona's activity, the paused tour, the editor. */
  resume: () => void;
  /** Clear the signal so the next-ranked one takes its place. */
  dismiss: () => void;
}

/**
 * The "continue where you left off" pointer as data and handlers, shared by the Cockpit's banner
 * (ResumeBanner) and the Welcome surface's kit card (ResumeSection). `null` when there is no
 * signal worth surfacing; the ranking lives in {@link useResumeContext}.
 *
 * Dismissing an `edit` clears the localStorage marker; dismissing a `failure` acknowledges that
 * run so the next-ranked signal takes its place; dismissing a `tour` dismisses the tour.
 */
export function useResumeAction(): ResumeAction | null {
  const ctx = useResumeContext();
  const { t, tx } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const startTour = useTourStore((s) => s.startTour);
  const dismissTour = useTourStore((s) => s.dismissTour);
  const selectPersona = useAgentStore((s) => s.selectPersona);

  if (!ctx) return null;

  const resume = () => {
    if (ctx.kind === 'tour') {
      startTour(ctx.tourId as Parameters<typeof startTour>[0]);
      return;
    }
    selectPersona(ctx.personaId);
    setSidebarSection('personas');
    setEditorTab(ctx.kind === 'failure' ? 'activity' : 'matrix');
  };

  const dismiss = () => {
    if (ctx.kind === 'edit') clearLastEdited();
    if (ctx.kind === 'tour') dismissTour();
    if (ctx.kind === 'failure') ackFailure(ctx.failureKey);
  };

  const label = ctx.kind === 'failure'
    ? tx(t.home.resume.failure, { personaName: ctx.personaName })
    : ctx.kind === 'tour'
      ? tx(t.home.resume.tour, {
        tourTitle: ctx.tourTitle,
        stepIndex: ctx.stepIndex,
        totalSteps: ctx.totalSteps,
        stepTitle: ctx.stepTitle,
      })
      : tx(t.home.resume.edit, { personaName: ctx.personaName });

  return { kind: ctx.kind, label, resume, dismiss };
}
