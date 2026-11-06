import type { ReactNode } from 'react';
import { Lock, MessageCircle } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import type { RowView } from '../../model/types';
import { Kbd } from '../../parts/Kbd';
import { StateChip } from '../../parts/StateChip';
import { FOCUS_COPY as F } from './copy';
import type { RowActions } from './useRowActions';

/** An agent change: one proposal card (dashed until accepted, then solid), accept or skip. */
export function AgentDecision({ row, editable, a, tools }: { row: RowView; editable: boolean; a: RowActions; tools: ReactNode }) {
  const open = row.state === 'proposed';
  return (
    <div className="sf-decision">
      <div className={`sf-card ${open ? 'is-open' : row.state === 'skipped' ? 'is-dim' : 'is-decided'}`}>
        <div className="sf-card__head">
          <span className="typo-label text-foreground">{row.agentVerb === 'create' ? F.agent_create : F.agent_retune}</span>
          <StateChip row={row} />
        </div>
        <p className="typo-body k-strong text-foreground">{row.name}</p>
      </div>
      <div className="sf-acts">
        {editable && open && <Button variant="primary" size="sm" icon={<Kbd>1</Kbd>} onClick={() => a.accept(row)}>{F.accept}</Button>}
        {editable && row.state !== 'skipped' && <Button variant="ghost" size="sm" icon={<Kbd>S</Kbd>} onClick={() => a.skip(row)}>{F.skip}</Button>}
        {editable && !open && <Button variant="ghost" size="sm" icon={<Kbd>⌫</Kbd>} onClick={() => a.undo(row)}>{F.undo}</Button>}
        <span className="sf-acts__tools">{tools}</span>
      </div>
    </div>
  );
}

/** A parked ask: the question front and centre, the options Athena sees, and the one way to answer it. */
export function AskDecision({ row, a, tools }: { row: RowView; a: RowActions; tools: ReactNode }) {
  return (
    <div className="sf-decision">
      <div className="sf-ask">
        <span className="typo-label text-status-error">{F.ask_title}</span>
        <p className="typo-body k-strong text-foreground">{row.headline}</p>
        {row.ask && row.ask.options.length > 0 && (
          <div className="sf-ask__opts" aria-label={F.ask_options}>
            {row.ask.options.map((o) => <span key={o} className="sf-chip typo-label text-foreground">{o}</span>)}
          </div>
        )}
        <p className="typo-caption">{F.ask_need}</p>
      </div>
      <div className="sf-acts">
        {row.itemId && <Button variant="primary" size="sm" icon={<MessageCircle className="w-4 h-4" />} iconRight={<Kbd>T</Kbd>} onClick={() => a.talk(row)}>{F.answer}</Button>}
        <span className="sf-acts__tools">{tools}</span>
      </div>
    </div>
  );
}

/** Refused and filler lines: nothing to decide, said once and plainly. */
export function NoteDecision({ row, tools }: { row: RowView; tools: ReactNode }) {
  const refused = row.state === 'refused';
  return (
    <div className="sf-decision">
      <div className="sf-note sf-note--quiet">
        {refused && <Lock className="w-4 h-4 sf-note__icon" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="typo-body k-strong text-foreground">{refused ? F.refused_title : F.filler_title}</p>
          {refused && row.refusal && <p className="typo-body text-foreground">{row.refusal}</p>}
          <p className="typo-caption">{refused ? F.refused_note : F.filler_note}</p>
        </div>
      </div>
      <div className="sf-acts"><span className="sf-acts__tools">{tools}</span></div>
    </div>
  );
}
