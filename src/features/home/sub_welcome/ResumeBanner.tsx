import { AlertCircle, Compass, PenLine, ChevronRight, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useResumeContext, clearLastEdited } from './useResumeContext';
import { useTranslation } from '@/i18n/useTranslation';
import { debtText } from '@/i18n/DebtText';


/**
 * Resume-where-you-left-off banner. Surfaces a single high-signal
 * "continue working" pointer above HeroHeader. Renders nothing if there's
 * no useful signal — see {@link useResumeContext} for the ranking.
 *
 * One click jumps the user directly to the right surface: failed
 * executions go to the persona's activity tab; tours resume via
 * `startTour`; edits open the persona editor.
 *
 * The banner is dismissible (X). Dismissing an `edit` entry clears the
 * localStorage marker so it doesn't reappear; tours and failures are
 * derived from store state and re-render only when the underlying signal
 * changes.
 */
export default function ResumeBanner() {
  const ctx = useResumeContext();
  const { t, tx } = useTranslation();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setEditorTab = useSystemStore((s) => s.setEditorTab);
  const startTour = useSystemStore((s) => s.startTour);
  const dismissTour = useSystemStore((s) => s.dismissTour);
  const selectPersona = useAgentStore((s) => s.selectPersona);

  if (!ctx) return null;

  const handleResume = () => {
    if (ctx.kind === 'tour') {
      startTour(ctx.tourId as Parameters<typeof startTour>[0]);
      return;
    }
    if (ctx.kind === 'failure' || ctx.kind === 'edit') {
      selectPersona(ctx.personaId);
      setSidebarSection('personas');
      setEditorTab(ctx.kind === 'failure' ? 'activity' : 'matrix');
    }
  };

  const handleDismiss = () => {
    if (ctx.kind === 'edit') clearLastEdited();
    if (ctx.kind === 'tour') dismissTour();
    // failures dismiss themselves once acknowledged via the activity tab;
    // there's no per-execution "ack" today, so dismiss() is a no-op.
  };

  const { Icon, label, accent } = bannerStyle(ctx, t, tx);

  // Resume and dismiss are two independent, separately-focusable controls in a
  // flex row — not a button nested inside a button. The previous markup put a
  // `role="button"` span inside the outer <button> (invalid nesting that leaned
  // on stopPropagation); keyboard/AT users now get two real buttons.
  return (
    <div
      className={`animate-fade-slide-in motion-reduce:animate-none w-full flex items-center gap-2 px-4 py-2.5 rounded-modal border ${accent} bg-secondary/30 backdrop-blur-sm transition-colors`}
    >
      <button
        type="button"
        onClick={handleResume}
        data-testid="resume-banner"
        className="group flex flex-1 min-w-0 items-center gap-3 rounded-input outline-none hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-current transition-colors"
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left typo-body text-foreground truncate">{label}</span>
        <ChevronRight className="w-4 h-4 text-foreground opacity-60 group-hover:translate-x-0.5 transition-transform" />
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="flex-shrink-0 p-1 rounded-input text-foreground opacity-50 outline-none hover:opacity-100 hover:bg-secondary/40 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-current transition-opacity"
        aria-label={debtText("auto_dismiss_resume_banner_ccff3f60")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

function bannerStyle(
  ctx: NonNullable<ReturnType<typeof useResumeContext>>,
  t: ReturnType<typeof useTranslation>['t'],
  tx: ReturnType<typeof useTranslation>['tx'],
) {
  if (ctx.kind === 'failure') {
    return {
      Icon: AlertCircle,
      label: tx(t.home.resume.failure, { personaName: ctx.personaName }),
      accent: 'border-red-500/30 text-red-400',
    };
  }
  if (ctx.kind === 'tour') {
    return {
      Icon: Compass,
      label: tx(t.home.resume.tour, {
        tourTitle: ctx.tourTitle,
        stepIndex: ctx.stepIndex,
        totalSteps: ctx.totalSteps,
        stepTitle: ctx.stepTitle,
      }),
      accent: 'border-violet-500/30 text-violet-300',
    };
  }
  return {
    Icon: PenLine,
    label: tx(t.home.resume.edit, { personaName: ctx.personaName }),
    accent: 'border-primary/25 text-primary',
  };
}
