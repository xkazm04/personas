import { useTranslation } from '@/i18n/useTranslation';
import type { RowState, RowView } from '../../model/types';

/** The four families a state belongs to; PROPOSED / DECIDED / RUNNING never share one. */
const TONE: Record<RowState, string> = {
  proposed: 'sl-pill--proposed',
  decided: 'sl-pill--decided',
  running: 'sl-pill--running',
  done: 'sl-pill--done',
  skipped: 'sl-pill--quiet',
  waits: 'sl-pill--waits',
  blank: 'sl-pill--quiet',
  filler: 'sl-pill--quiet',
  refused: 'sl-pill--refused',
};

/**
 * The ledger's one state treatment per row: a fixed-width pill at the head of
 * the Decision column, so every decision text starts on the same left edge.
 * Proposed = dashed amber outline, decided = solid primary, running = a still
 * success hatch swatch on a success tint. The word is always written.
 */
export function StatePill({ row }: { row: Pick<RowView, 'state' | 'agentVerb'> }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.state;
  const label = row.state === 'proposed' && row.agentVerb
    ? tx(s.agent_question, { verb: row.agentVerb === 'create' ? s.verb_create : s.verb_retune })
    : s[row.state];
  return (
    <span className={`sl-pill typo-label ${TONE[row.state]}`}>
      {row.state === 'running' && <i className="sl-pill__hatch" aria-hidden="true" />}
      {label}
    </span>
  );
}
