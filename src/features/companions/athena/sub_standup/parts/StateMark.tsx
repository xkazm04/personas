import type { ReactNode } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { RowState, RowView } from '../model/types';

/**
 * One glyph per state, drawn on a 12px grid. The glyph carries the signal
 * colour; the word stays on the text greys (decided alone takes the accent).
 * Proposed = dashed ring, decided = filled square, running = hatched bar,
 * done = check, waits = filled diamond, refused = struck ring.
 */
const GLYPH: Record<RowState, ReactNode> = {
  proposed: <circle cx="6" cy="6" r="4.25" className="g-ring" strokeDasharray="2.2 1.6" />,
  decided: <rect x="2" y="2" width="8" height="8" className="g-fill" />,
  running: <rect x="0.75" y="3.25" width="10.5" height="5.5" className="g-hatch" />,
  done: <polyline points="2.25,6.25 4.9,8.75 9.75,3.25" className="g-line" />,
  skipped: <line x1="2.5" y1="6" x2="9.5" y2="6" className="g-line" />,
  waits: <rect x="2.6" y="2.6" width="6.8" height="6.8" transform="rotate(45 6 6)" className="g-fill" />,
  blank: <circle cx="6" cy="6" r="4.25" className="g-ring" strokeDasharray="0.1 2.2" />,
  filler: <rect x="2" y="2" width="8" height="8" className="g-dots" />,
  refused: <><circle cx="6" cy="6" r="4.25" className="g-ring" /><line x1="3" y1="9" x2="9" y2="3" className="g-line" /></>,
};

export function StateGlyph({ state }: { state: RowState }) {
  return (
    <svg className={`sc-glyph sc-glyph--${state}`} viewBox="0 0 12 12" aria-hidden="true">{GLYPH[state]}</svg>
  );
}

/** The fixed-width state column at the head of every decision: glyph + word, one left edge for all text after it. */
export function StateMark({ row }: { row: Pick<RowView, 'state' | 'agentVerb'> }) {
  const { t, tx } = useTranslation();
  const s = t.athena.standup.state;
  const label = row.state === 'proposed' && row.agentVerb
    ? tx(s.agent_question, { verb: row.agentVerb === 'create' ? s.verb_create : s.verb_retune })
    : row.state === 'waits' ? t.athena.standup.console.state_waits : s[row.state];
  return (
    <span className={`sc-state sc-state--${row.state}`}>
      <StateGlyph state={row.state} />
      <span className="sc-state__word">{label}</span>
    </span>
  );
}
