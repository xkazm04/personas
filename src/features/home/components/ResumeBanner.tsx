import { AlertCircle, Compass, PenLine, ChevronRight, X } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { useResumeContext, clearLastEdited } from './useResumeContext';

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

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (ctx.kind === 'edit') clearLastEdited();
    if (ctx.kind === 'tour') dismissTour();
    // failures dismiss themselves once acknowledged via the activity tab;
    // there's no per-execution "ack" today, so dismiss() is a no-op.
  };

  const { Icon, label, accent } = bannerStyle(ctx);

  return (
    <button
      type="button"
      onClick={handleResume}
      data-testid="resume-banner"
      className={`animate-fade-slide-in motion-reduce:animate-none w-full flex items-center gap-3 px-4 py-2.5 rounded-modal border ${accent} bg-secondary/30 backdrop-blur-sm hover:bg-secondary/50 transition-colors group`}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      <span className="flex-1 text-left typo-body text-foreground truncate">{label}</span>
      <ChevronRight className="w-4 h-4 text-foreground opacity-60 group-hover:translate-x-0.5 transition-transform" />
      <span
        role="button"
        tabIndex={0}
        onClick={handleDismiss}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleDismiss(e as unknown as React.MouseEvent); } }}
        className="p-1 rounded-input text-foreground opacity-50 hover:opacity-100 hover:bg-secondary/40"
        aria-label="Dismiss resume banner"
      >
        <X className="w-3.5 h-3.5" />
      </span>
    </button>
  );
}

function bannerStyle(ctx: NonNullable<ReturnType<typeof useResumeContext>>) {
  if (ctx.kind === 'failure') {
    return {
      Icon: AlertCircle,
      label: `Unread failure in ${ctx.personaName} — investigate`,
      accent: 'border-red-500/30 text-red-400',
    };
  }
  if (ctx.kind === 'tour') {
    return {
      Icon: Compass,
      label: `Resume ${ctx.tourTitle} (${ctx.stepIndex}/${ctx.totalSteps}) — ${ctx.stepTitle}`,
      accent: 'border-violet-500/30 text-violet-300',
    };
  }
  return {
    Icon: PenLine,
    label: `Continue editing ${ctx.personaName}`,
    accent: 'border-primary/25 text-primary',
  };
}
