// RailBits — the leaves every variant needs, hoisted the moment the second
// variant wanted them (Phase 4 of the prototype workflow: hoist mid-prototype,
// not at consolidation, or every refinement has to be made three times).
//
// These carry NO variant opinion. A bit decides what a thing IS — a timestamp,
// a selection control, an unread mark — and the variant decides where it sits
// and how loud it is.

import { memo } from 'react';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { TONE_FILL, type RailRow } from './railModel';

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
