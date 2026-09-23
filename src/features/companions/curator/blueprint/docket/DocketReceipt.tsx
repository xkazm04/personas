/**
 * FORM 2 - answered AT THE GATE by a standing grant: a receipt.
 *
 * Not a question. The operator's standing grant already answered it, so what
 * the drawer owes is the record and the way back: what was written, where, and
 * the exact command that undoes it. The punched top edge is a mask, not a
 * fill - the two stops are "cut" and "keep", not colours - so it survives
 * every theme without a second palette.
 */
import type { DocketEntry } from '../model/docket';
import { useWords } from '../words';

import { CardDetail } from './DocketCard';
import { DocketOptions } from './DocketOptions';

interface ReceiptProps {
  entry: DocketEntry;
  selected: boolean;
  expanded: boolean;
  onSelect: (id: string) => void;
  onAnswer: (entry: DocketEntry, option: string) => void;
}

export function DocketReceipt({ entry, selected, expanded, onSelect, onAnswer }: ReceiptProps) {
  const { w } = useWords();
  return (
    <div
      className={`cb-receipt${selected ? ' cb-sel' : ''}`}
      data-role="cb-docket-receipt"
      data-cb-card={entry.id}
      role="presentation"
      onClick={() => {
        onSelect(entry.id);
      }}
    >
      <span className="cb-stamp typo-label cb-up">{w.docket_recorded}</span>
      <div className="typo-title-lg cb-rtitle">{entry.title}</div>
      <div className="cb-rl typo-code">
        {w.docket_answered_by} <b>{entry.answeredBy}</b>
      </div>
      {entry.commit && (
        <>
          <div className="cb-rl typo-code">
            {w.docket_commit} <b>{entry.commit.sha}</b> {`${entry.commit.repo}/${entry.commit.branch}`}{' '}
            {entry.commit.files.join(', ')}
          </div>
          <div className="cb-rl typo-code">
            {w.docket_revert} <b>{`git revert ${entry.commit.sha}`}</b>
          </div>
        </>
      )}
      <div style={{ marginTop: '7px' }}>
        <DocketOptions entry={entry} onAnswer={onAnswer} />
      </div>
      {expanded && selected && (
        <div className="cb-exp">
          <CardDetail
            entry={entry}
            prompt={null}
            promptValue=""
            onPromptChange={() => undefined}
            onPromptCommit={() => undefined}
          />
        </div>
      )}
    </div>
  );
}
