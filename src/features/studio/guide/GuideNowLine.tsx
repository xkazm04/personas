import { useTranslation } from '@/i18n/useTranslation';
import { AUTO_MAX_TURNS } from '../studioStore';
import type { StudioActivity } from '../studioActivity';
import { activityText, guideStrings } from './guideCopy';
import { clock, useElapsed } from './useGuideRuntime';

// One plain line under the frame: what Athena is doing now, with honest elapsed
// time and never a percentage. The orb at its left opens her tools.
export default function GuideNowLine({
  name,
  settingUp,
  busy,
  autonomous,
  autoTurns,
  step,
  turnStartedAt,
  lastTurnSecs,
  activity,
  questionWaiting,
  questionHidden,
  queued,
  estimate,
  onOrb,
  onShowQuestion,
  toolsOpen,
}: {
  name: string;
  settingUp: boolean;
  busy: boolean;
  autonomous: boolean;
  autoTurns: number;
  step: number;
  turnStartedAt: number | null;
  lastTurnSecs: number | null;
  activity: StudioActivity[];
  questionWaiting: boolean;
  questionHidden: boolean;
  queued: number;
  estimate: string;
  onOrb: () => void;
  onShowQuestion: () => void;
  /** The tool arc the orb opens is showing. */
  toolsOpen: boolean;
}) {
  const { t, tx } = useTranslation();
  const g = guideStrings(t);
  const elapsed = useElapsed(busy ? turnStartedAt : null);
  const last = activity[activity.length - 1];

  let lead: string;
  let rest: string | null = null;
  if (settingUp) {
    lead = tx(g.now_setting_up, { name });
  } else if (busy) {
    lead = last ? activityText(g, last) : g.now_thinking;
    rest = tx(g.now_step_running, { step, elapsed: clock(elapsed), estimate });
  } else if (questionWaiting) {
    lead = g.needs_you;
    rest = lastTurnSecs !== null ? tx(g.now_step_took, { step, took: clock(lastTurnSecs) }) : null;
  } else if (step > 0) {
    lead = tx(g.now_step_done, { step });
    rest = g.now_pick;
  } else {
    lead = g.now_ready;
  }

  return (
    <div className="flex min-h-10 items-center gap-3 px-1">
      <button
        type="button"
        onClick={onOrb}
        aria-label={g.tools_open}
        aria-haspopup="menu"
        aria-expanded={toolsOpen}
        className="group relative h-9 w-9 shrink-0 rounded-full"
        style={{
          background:
            'radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--foreground) 85%, transparent) 0 6%, color-mix(in srgb, var(--primary) 70%, var(--foreground)) 26%, var(--primary) 58%, color-mix(in srgb, var(--primary) 45%, var(--background)) 82%)',
          boxShadow: '0 0 18px color-mix(in srgb, var(--primary) 45%, transparent)',
        }}
      >
        {busy && <span className="absolute inset-0 animate-ping rounded-full border border-primary/60" />}
        <kbd className="absolute -right-2 -top-1.5 rounded border border-border bg-background px-1 font-mono text-xs leading-4 text-foreground/90 opacity-0 transition-opacity group-hover:opacity-100">
          O
        </kbd>
      </button>
      {/* Only the lead is a live region: the rest carries a clock that ticks
          every second and would be re-announced each time. */}
      <p className="min-w-0 flex-1 truncate typo-body text-foreground/90">
        <span role="status" className={`font-semibold ${questionWaiting && !busy ? 'text-status-warning' : 'text-foreground'}`}>
          {lead}
        </span>
        {rest && <span> {rest}</span>}
      </p>
      {autonomous && (
        <span className="shrink-0 rounded-full border border-primary/50 px-2.5 py-0.5 typo-caption text-primary">
          {tx(g.on_her_own, { n: autoTurns + 1, max: AUTO_MAX_TURNS })}
        </span>
      )}
      {queued > 0 && (
        <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 typo-caption text-foreground/90">
          {tx(g.notes_waiting, { count: queued })}
        </span>
      )}
      {questionWaiting && questionHidden && <YourCallButton label={g.your_call} onClick={onShowQuestion} />}
    </div>
  );
}

/** Brings back a question the user tucked away (Esc or the card's hide). */
export function YourCallButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pointer-events-auto shrink-0 rounded-full border border-status-warning/60 bg-background/85 px-2.5 py-0.5 typo-caption text-status-warning hover:bg-status-warning/10"
    >
      {label}
    </button>
  );
}
