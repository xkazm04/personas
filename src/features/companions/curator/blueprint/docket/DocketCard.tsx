/**
 * FORM 1 - waiting for a person: a raised card with a spine and armed keys.
 *
 * Its distinctness from the receipt and from a settled ledger line is a hard
 * constraint of the original brief, not decoration: three states a decision
 * can be in must not be three colours of the same box.
 */
import type { DocketEntry } from '../model/docket';
import { needsReason } from '../model/docket';
import { utcStamp } from '../format';
import { useWords } from '../words';

import { Drawing } from './drawings/Drawing';
import { DocketOptions, ReasonPrompt } from './DocketOptions';

interface CardProps {
  entry: DocketEntry;
  selected: boolean;
  expanded: boolean;
  prompt: { id: string; option: string } | null;
  promptValue: string;
  onPromptChange: (value: string) => void;
  onPromptCommit: () => void;
  onSelect: (id: string) => void;
  onAnswer: (entry: DocketEntry, option: string) => void;
}

export function CardDetail({
  entry,
  prompt,
  promptValue,
  onPromptChange,
  onPromptCommit,
}: Pick<CardProps, 'entry' | 'prompt' | 'promptValue' | 'onPromptChange' | 'onPromptCommit'>) {
  return (
    <>
      {entry.why && <div className="typo-caption">{entry.why}</div>}
      <Drawing entry={entry} />
      <p className="typo-body" style={{ marginTop: '9px' }}>
        {entry.whatItAsks}
      </p>
      {prompt?.id === entry.id && needsReason(prompt.option) && (
        <ReasonPrompt
          option={prompt.option}
          value={promptValue}
          onChange={onPromptChange}
          onCommit={onPromptCommit}
        />
      )}
    </>
  );
}

export function DocketCard(props: CardProps) {
  const { entry, selected, expanded, onSelect, onAnswer } = props;
  const { w } = useWords();
  return (
    <div
      className={`cb-card${selected ? ' cb-sel' : ''}`}
      data-role="cb-docket-card"
      data-cb-card={entry.id}
      role="presentation"
      onClick={() => {
        onSelect(entry.id);
      }}
    >
      <div className="cb-k1 typo-caption">
        <span className="cb-lvl typo-code">{entry.level}</span>
        <span>{w.kind[entry.kind]}</span>
        <span className="cb-sp" />
        <span>{utcStamp(entry.raisedAt)}</span>
      </div>
      <div className="typo-title-lg cb-cardtitle">{entry.title}</div>
      <DocketOptions entry={entry} onAnswer={onAnswer} />
      {expanded && selected && (
        <div className="cb-exp">
          <CardDetail {...props} />
        </div>
      )}
    </div>
  );
}
