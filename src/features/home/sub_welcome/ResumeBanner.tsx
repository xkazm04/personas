import { AlertCircle, Compass, PenLine, ChevronRight, X } from 'lucide-react';
import { debtText } from '@/i18n/DebtText';
import { useResumeAction, type ResumeAction } from './useResumeAction';

/**
 * Resume-where-you-left-off banner on the production Cockpit landing. Surfaces a single
 * high-signal "continue working" pointer; renders nothing if there is no useful signal (see
 * {@link useResumeAction} and the ranking in useResumeContext). One click jumps to the right
 * surface; the X dismisses the signal so the next-ranked one takes its place.
 *
 * The Welcome surface shows the same pointer as a kit card (ResumeSection).
 */
export default function ResumeBanner() {
  const action = useResumeAction();
  if (!action) return null;

  const { Icon, accent } = KIND_STYLE[action.kind];

  // Resume and dismiss are two independent, separately-focusable controls in a
  // flex row, not a button nested inside a button.
  return (
    <div
      className={`animate-fade-slide-in motion-reduce:animate-none w-full flex items-center gap-2 px-4 py-2.5 rounded-modal border ${accent} bg-secondary/30 backdrop-blur-sm transition-colors`}
    >
      <button
        type="button"
        onClick={action.resume}
        data-testid="resume-banner"
        className="group flex flex-1 min-w-0 items-center gap-3 rounded-input outline-none hover:bg-secondary/40 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-current transition-colors"
      >
        <Icon className="w-4 h-4 flex-shrink-0" />
        <span className="flex-1 text-left typo-body text-foreground truncate">{action.label}</span>
        <ChevronRight className="w-4 h-4 text-foreground opacity-60 group-hover:translate-x-0.5 transition-transform" />
      </button>
      <button
        type="button"
        onClick={action.dismiss}
        className="flex-shrink-0 p-1 rounded-input text-foreground opacity-50 outline-none hover:opacity-100 hover:bg-secondary/40 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:ring-current transition-opacity"
        aria-label={debtText("auto_dismiss_resume_banner_ccff3f60")}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

/** Colour by meaning: a failure is an error, a paused tour is guidance (info), an edit is the theme's own hue. */
const KIND_STYLE: Record<ResumeAction['kind'], { Icon: typeof AlertCircle; accent: string }> = {
  failure: { Icon: AlertCircle, accent: 'border-status-error/30 text-status-error' },
  tour: { Icon: Compass, accent: 'border-status-info/30 text-status-info' },
  edit: { Icon: PenLine, accent: 'border-primary/25 text-primary' },
};
