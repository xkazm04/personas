/**
 * The armed keys on a card, and the one line a refusal owes.
 *
 * An option that ENDS something - send back, park, decline, leave, revert -
 * cannot be answered without a reason, because a decision nobody can read back
 * is not a record. The prompt is part of the answer, not a dialog on top of it.
 */
import type { DocketEntry } from '../model/docket';
import { needsReason } from '../model/docket';
import { useWords } from '../words';

interface OptionsProps {
  entry: DocketEntry;
  onAnswer: (entry: DocketEntry, option: string) => void;
}

export function DocketOptions({ entry, onAnswer }: OptionsProps) {
  return (
    <div className="cb-opts">
      {entry.options.map((option, i) => (
        <button
          key={option}
          type="button"
          className="cb-opt typo-caption"
          data-role="cb-docket-option"
          onClick={(e) => {
            e.stopPropagation();
            onAnswer(entry, option);
          }}
        >
          <kbd>{i + 1}</kbd>
          {option}
          {needsReason(option) && <span className="cb-dim">{'✎'}</span>}
        </button>
      ))}
    </div>
  );
}

interface PromptProps {
  option: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: () => void;
}

export function ReasonPrompt({ option, value, onChange, onCommit }: PromptProps) {
  const { w, tx } = useWords();
  return (
    <div className="cb-reason">
      <span className="typo-caption cb-dim">{tx(w.docket_reason_why, { option })}</span>
      <input
        className="typo-caption"
        data-role="cb-docket-reason"
        placeholder={w.docket_reason_placeholder}
        autoComplete="off"
        value={value}
        onClick={(e) => {
          e.stopPropagation();
        }}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onCommit();
        }}
      />
      <kbd>{'↵'}</kbd>
    </div>
  );
}
