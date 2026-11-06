import type { ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { RowState, RowView } from '../../model/types';

/**
 * One selectable item of the briefing (a project, an agent change, an ask).
 * It keeps the page's listbox contract: `role="option"`, `aria-selected`, the
 * `standup-row-<key>` hook, and a click that moves the cursor here.
 */
export function Item({ row, index, selected, onSelect, className, children }: {
  row: RowView;
  index: number;
  selected: boolean;
  onSelect: (index: number) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      id={`sb-item-${row.key}`}
      role="option"
      aria-selected={selected}
      data-testid={`standup-row-${row.key}`}
      data-state={row.state}
      className={`sb-item ${selected ? 'is-sel' : ''} ${className ?? ''}`}
      onClick={() => onSelect(index)}
    >
      {children}
    </div>
  );
}

/**
 * The state tag. PROPOSED (dashed warning outline), DECIDED (solid primary)
 * and RUNNING (static success hatch) never share a treatment, and the word is
 * always written, so colour is never the only signal. Sentence case, no
 * tracking, no motion.
 */
export function Tag({ state, verb }: { state: RowState; verb?: 'create' | 'retune' }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.state;
  const label = state === 'proposed' && verb ? tx(s.agent_question, { verb: verb === 'create' ? s.verb_create : s.verb_retune }) : s[state];
  return <span className={`sb-tag sb-tag--${state} typo-label`}>{label}</span>;
}

/** The project's last standups as ticks (armed / off / not named), oldest first. */
export function HistoryTicks({ row }: { row: RowView }) {
  const { t } = useTranslation();
  if (!row.history) return null;
  return (
    <span className="su-hist sb-hist" role="img" aria-label={t.athena.standup.row.history_label}>
      {row.history.map((h, i) => <i key={i} className={h === 'armed' ? 'is-armed' : h === 'off' ? 'is-off' : ''} />)}
    </span>
  );
}
