// RailBits — the leaves every variant needs, hoisted the moment the second
// variant wanted them (Phase 4 of the prototype workflow: hoist mid-prototype,
// not at consolidation, or every refinement has to be made three times).
//
// These carry NO variant opinion. A bit decides what a thing IS — a timestamp,
// a selection control, an unread mark — and the variant decides where it sits
// and how loud it is.

import { memo } from 'react';
import { Check, X } from 'lucide-react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { PILE_VISUAL } from '../skin/piles';
import { TONE_FILL, type RailRow, type TriageTone } from './railModel';

/**
 * A row's tone as the skin's `--fb-tone`, so the skin's bar and ink classes
 * paint it. Danger and warning are a persona NEEDING you and take the Board's
 * own colours (`PILE_VISUAL`, whose warning lifts to a fill on light themes);
 * the other tones are not persona states and keep the deck's fill token, read
 * off `TONE_FILL` rather than re-picked (`bg-primary` -> `var(--primary)`).
 */
export function railToneVar(tone: TriageTone): string {
  if (tone === 'danger') return PILE_VISUAL.critical.tone;
  if (tone === 'warning') return PILE_VISUAL.warning.tone;
  return `var(--${TONE_FILL[tone].slice('bg-'.length)})`;
}

/**
 * The row's face, in the Board rail's slot: the persona's framed icon when the
 * row belongs to one, else the row's kind glyph in a frame of the same size,
 * tinted by the row's tone, so the column of faces stays one width.
 */
export function RailFace({ row }: { row: RailRow }) {
  if (row.persona) {
    return (
      <PersonaIcon icon={row.persona.icon} color={row.persona.color} name={row.persona.name ?? null} display="framed" frameSize="md" />
    );
  }
  const Icon = row.icon;
  return (
    <span aria-hidden className="icon-frame icon-frame-md" style={{ background: 'color-mix(in oklab, var(--fb-tone) 14%, transparent)' }}>
      <span className="flex items-center justify-center">
        <Icon className="h-5 w-5 fb-ink" />
      </span>
    </span>
  );
}

/** The row's instant. Always `tabular-nums` so a column of times does not
 *  shimmer as the shared clock ticks each one. */
export function RailTime({ at, className = '' }: { at: string | number | null; className?: string }) {
  if (at === null) return null;
  return (
    <RelativeTime
      timestamp={at}
      showTooltip={false}
      className={`flex-shrink-0 tabular-nums ${className}`}
    />
  );
}

/**
 * The selection control for a selectable row.
 *
 * A real `<input type="checkbox">` inside a `<label>`, exactly as
 * `DeckAcceptedList` does it: the browser gives us keyboard and checked
 * semantics for free, and the row becomes the hit target. `aria-label` names
 * WHICH row, because a screen reader reading a 90-character title as the
 * control's name is not usable.
 */
export const RailCheckbox = memo(function RailCheckbox({
  row, checked, onToggle, className = '',
}: {
  row: RailRow;
  checked: boolean;
  onToggle: (id: string) => void;
  className?: string;
}) {
  const { t, tx } = useTranslation();
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={() => onToggle(row.id)}
      aria-label={tx(t.monitor.triage_accepted_row_aria, { title: row.title })}
      className={`h-3.5 w-3.5 flex-shrink-0 cursor-pointer rounded border-primary/30 bg-secondary/30 accent-primary ${className}`}
    />
  );
});

/** The unread mark. `aria-hidden` plus an `sr-only` companion — the same
 *  contract the deck's kind icon needed: a glyph nobody announces is a state
 *  that does not exist for a screen reader. */
export function RailUnread({ unread }: { unread: boolean }) {
  const { t } = useTranslation();
  if (!unread) return null;
  return (
    <>
      <span aria-hidden className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${TONE_FILL.accent}`} />
      <span className="sr-only">{t.monitor.grid_rail_unread}</span>
    </>
  );
}

/** The producing persona's face, when the row has one. */
export function RailAvatar({ row, size = 'w-3.5 h-3.5' }: { row: RailRow; size?: string }) {
  if (!row.persona) return null;
  return <PersonaIcon icon={row.persona.icon} color={row.persona.color} size={size} />;
}

/** The two quick verdicts. Icon-only — at rail width a labelled pair would take
 *  the title's room, and the icons are the triage card's own verdict glyphs. */
export const RailVerdicts = memo(function RailVerdicts({
  row, onAccept, onReject,
}: {
  row: RailRow;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const stop = (e: React.MouseEvent) => {
    // The row itself opens the card. A verdict is not an "open", so the click
    // must not reach the row, or accepting would throw the modal up as well.
    e.stopPropagation();
    e.preventDefault();
  };
  const base =
    'inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-interactive border transition-colors';
  return (
    <span className="flex flex-shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={(e) => { stop(e); onAccept(row.id); }}
        aria-label={tx(t.monitor.grid_rail_accept_aria, { title: row.title })}
        data-testid="rail-row-accept"
        className={`${base} border-status-success/30 text-status-success hover:bg-status-success/15`}
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={(e) => { stop(e); onReject(row.id); }}
        aria-label={tx(t.monitor.grid_rail_reject_aria, { title: row.title })}
        data-testid="rail-row-reject"
        className={`${base} border-status-error/30 text-status-error hover:bg-status-error/15`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
});
