/**
 * SetupReadinessRow — ONE thin horizontal strip that replaces the old
 * right-hand readiness panel.
 *
 * Four segments, one per checklist slot. Each carries its status as COLOUR
 * and as SHAPE (the `twinStatus` table owns both, so the strip stays legible
 * for a colour-blind reader and in either theme), its own short measured fact,
 * and a click that moves the guided flow to that slot. The overall score is
 * printed exactly once, at the end of the strip, as a number plus a meter.
 *
 * No paragraphs live here on purpose: the operator's brief is a glyph or a
 * bar over a sentence.
 */

import { twinStatusEntry, type TwinSlotStatus } from '../shared/twinStatus';
import { useTranslation } from '@/i18n/useTranslation';
import type { SetupChecklistItem, SetupFocus } from './setupContract';

interface SetupReadinessRowProps {
  checklist: SetupChecklistItem[];
  /** 0-100, the single completion authority. Rendered once. */
  score: number;
  /** The slot the guided flow is on right now. */
  focus: SetupFocus;
  onFocus: (focus: SetupFocus) => void;
}

/** Status as shape: a solid disc, a half-filled disc, or an empty ring. */
function StatusGlyph({ status }: { status: TwinSlotStatus }) {
  const entry = twinStatusEntry(status);
  if (entry.shape === 'filled') {
    return <span aria-hidden className={`w-2.5 h-2.5 rounded-full ${entry.dot}`} />;
  }
  if (entry.shape === 'half') {
    return (
      <span aria-hidden className={`w-2.5 h-2.5 rounded-full ring-1 ${entry.ring} flex overflow-hidden`}>
        <span className={`w-1/2 h-full ${entry.dot}`} />
      </span>
    );
  }
  return <span aria-hidden className={`w-2.5 h-2.5 rounded-full ring-1 ${entry.ring}`} />;
}

export function SetupReadinessRow({ checklist, score, focus, onFocus }: SetupReadinessRowProps) {
  const { t } = useTranslation();
  const ts = t.twin.setup;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));

  return (
    <div
      className="flex-shrink-0 flex items-stretch gap-px border-b border-primary/10 bg-secondary/20"
      role="group"
      aria-label={ts.readinessLabel}
    >
      {checklist.map((item) => {
        const entry = twinStatusEntry(item.status);
        const active = item.id === focus;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onFocus(item.id)}
            aria-current={active ? 'step' : undefined}
            data-testid={`setup-readiness-${item.id}`}
            className={[
              'group relative flex-1 min-w-0 flex items-center gap-2 px-3 py-1.5 text-left transition-colors',
              active ? 'bg-secondary/60' : 'hover:bg-secondary/40',
            ].join(' ')}
          >
            <StatusGlyph status={item.status} />
            <span className="min-w-0 flex items-baseline gap-2">
              <span className={`typo-caption font-medium truncate ${active ? 'text-foreground' : ''}`}>
                {ts.checklist[item.labelKey]}
              </span>
              <span className={`typo-caption tabular-nums truncate ${entry.text}`}>{item.detail}</span>
            </span>
            <span className="sr-only">{ts.status[entry.labelKey]}</span>
            {/* The segment's own state bar. Sits flush with the strip's edge so
                four of them read as one meter broken into four. */}
            <span
              aria-hidden
              className={[
                'absolute left-0 bottom-0 h-0.5 transition-all duration-300',
                entry.dot,
                item.status === 'set' ? 'w-full' : item.status === 'partial' ? 'w-1/2' : 'w-0',
              ].join(' ')}
            />
            {active && <span aria-hidden className="absolute left-0 top-0 h-0.5 w-full bg-primary/50" />}
          </button>
        );
      })}

      {/* The score, once. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 border-l border-primary/10">
        <span className="typo-caption uppercase tracking-[0.18em] hidden sm:inline">
          {ts.scoreLabel}
        </span>
        <span aria-hidden className="w-16 h-1 rounded-full bg-foreground/10 overflow-hidden hidden sm:block">
          <span
            className={`block h-full rounded-full transition-all duration-500 ${
              clamped >= 80 ? 'bg-status-success' : clamped >= 40 ? 'bg-status-warning' : 'bg-foreground/30'
            }`}
            style={{ width: `${clamped}%` }}
          />
        </span>
        <span className="typo-data tabular-nums text-foreground" data-testid="setup-readiness-score">
          {clamped}
        </span>
      </div>
    </div>
  );
}

export default SetupReadinessRow;
