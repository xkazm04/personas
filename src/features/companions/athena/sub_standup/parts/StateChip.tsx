import { useTranslation } from '@/i18n/useTranslation';
import type { RowState, RowView } from '../model/types';

const CLASS: Record<RowState, string> = {
  proposed: 'su-st--proposed',
  decided: 'su-st--decided',
  running: 'su-st--running',
  done: 'su-st--done',
  skipped: 'su-st--quiet',
  waits: 'su-st--waits',
  blank: 'su-st--quiet',
  filler: 'su-st--quiet',
  refused: 'su-st--refused',
};

/**
 * The decision column's one chip. PROPOSED (dashed warning), DECIDED (solid
 * primary) and RUNNING (marching success hatch) never share a treatment,
 * and the word is always written, so colour is never the only signal.
 */
export function StateChip({ row }: { row: Pick<RowView, 'state' | 'agentVerb'> }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.state;
  const label = row.state === 'proposed' && row.agentVerb
    ? tx(s.agent_question, { verb: row.agentVerb === 'create' ? s.verb_create : s.verb_retune })
    : s[row.state];
  return <span className={`su-st typo-label ${CLASS[row.state]}`}>{label}</span>;
}
