/**
 * SetupTextField — one typed slot on the Fields page.
 *
 * It commits through `session.edit` on BLUR and wears its own outcome, so a
 * failed write is visible at the field rather than only in a toast that has
 * already gone. It knows nothing about the generator: this is the surface that
 * has to keep working while `generatorError` is set, which is why it takes a
 * plain `edit` function and no session.
 *
 * The value is a controlled draft that adopts an incoming change (the guide
 * accepted a proposal while the page was open) only when that incoming value
 * actually differs — never on every render, so it cannot fight a keystroke.
 */

import { useEffect, useRef, useState } from 'react';
import { FormField } from '@/features/shared/components/forms/FormField';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import { wordCount } from './toneParts';

type CommitState = 'idle' | 'saving' | 'saved' | 'error';

interface SetupTextFieldProps {
  label: string;
  /** Completes `setup-field-<slotKey>`. These ids are driven by the E2E suite. */
  slotKey: string;
  initial: string;
  /** Rows for a textarea; omit for a single-line input. */
  rows?: number;
  mono?: boolean;
  helpText?: string;
  /** Running word count under the field, for the long prose slots. */
  showWords?: boolean;
  edit: (value: string) => Promise<void>;
}

export function SetupTextField({
  label,
  slotKey,
  initial,
  rows,
  mono,
  helpText,
  showWords,
  edit,
}: SetupTextFieldProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.setup.fields;
  const [draft, setDraft] = useState(initial);
  const [state, setState] = useState<CommitState>('idle');
  const lastInitial = useRef(initial);

  useEffect(() => {
    if (lastInitial.current === initial) return;
    lastInitial.current = initial;
    setDraft(initial);
    setState('idle');
  }, [initial]);

  const commit = async () => {
    if (draft === initial) {
      setState('idle');
      return;
    }
    setState('saving');
    try {
      await edit(draft);
      setState('saved');
    } catch (err) {
      setState('error');
      toastCatch('features/plugins/twin/setup/fields/SetupTextField:commit')(err);
    }
  };

  const outcome =
    state === 'saving' ? ts.saving : state === 'saved' ? ts.saved : state === 'error' ? ts.saveFailed : null;
  const note = outcome ?? helpText;

  return (
    <div className="min-w-0">
      <FormField
        label={label}
        helpText={note}
        error={state === 'error' ? ts.saveFailed : undefined}
        validateOn="change"
      >
        {(inputProps) =>
          rows ? (
            <textarea
              {...inputProps}
              rows={rows}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setState('idle');
              }}
              onBlur={() => void commit()}
              data-testid={`setup-field-${slotKey}`}
              className={`${INPUT_FIELD} resize-y leading-relaxed`}
            />
          ) : (
            <input
              {...inputProps}
              type="text"
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setState('idle');
              }}
              onBlur={() => void commit()}
              data-testid={`setup-field-${slotKey}`}
              className={mono ? `${INPUT_FIELD} font-mono` : INPUT_FIELD}
            />
          )
        }
      </FormField>
      {showWords && (
        <p className="mt-1 typo-caption tabular-nums text-right">
          {tx(ts.words, { count: wordCount(draft) })}
        </p>
      )}
    </div>
  );
}

export default SetupTextField;
