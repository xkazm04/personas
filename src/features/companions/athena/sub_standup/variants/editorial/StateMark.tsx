import { Check } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { RowState, RowView } from '../../model/types';
import { ED_COPY } from './copy';

/**
 * The row's state as a typographic mark, not a chip: a small glyph and the word, each state set
 * its own way so the three that matter can never be confused.
 *  proposed  italic serif, dotted amber underline, a dotted ring
 *  decided   upright small caps in ink, a solid primary square
 *  running   small caps in green, a still hatched bar
 *  done      a green check, the word in the quiet ink
 *  skipped   struck through in the quiet ink
 *  waits     small caps in red with a red rule (the row also carries a red marginal mark)
 */
export function StateMark({ row }: { row: Pick<RowView, 'state' | 'agentVerb'> }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.state;
  const own: Partial<Record<RowState, string>> = ED_COPY.state;
  const label = row.state === 'proposed' && row.agentVerb
    ? tx(s.agent_question, { verb: row.agentVerb === 'create' ? s.verb_create : s.verb_retune })
    : own[row.state] ?? s[row.state];
  return (
    <span className={`se-mark se-mark--${row.state}`}>
      {row.state === 'done'
        ? <Check className="se-glyph w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
        : <i className="se-glyph" aria-hidden="true" />}
      <span className="se-mark__word">{label}</span>
    </span>
  );
}
