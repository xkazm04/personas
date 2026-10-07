/**
 * Fusion · decision v1 ("Review desk") · the answers as separate option
 * cards that fly in over the app from the rail's attention circle (Fusion's
 * own `useFlight`), staggered, and land under the review card. Up to three
 * sit side by side; four fall two-up, five or more three-up, a step tighter
 * (her why moves to the action zone), so nine answers still fit 1280x800. A typed answer (a session's
 * guidance question, an approval's note) is a wide field card of its own.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { useRef, useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { CardField, CardModel } from '../../../c/bodies/model';
import { isTyping } from '../../text';
import { useFlight } from '../../useFlight';
import { DESK_COPY as C } from './copy';
import { OptionCard } from './OptionCard';

/** One above `useAnswerKeys` (layer + 2), so the confirm sees the key before the answer runs. */
const PICK_OBSERVER_PRIORITY = FULLSCREEN_LAYER_PRIORITY + 3;

/**
 * Which card the operator just took - by click, by its number, or by Enter on
 * her pick - so that card can confirm while the product resolves it. Read
 * from the same keys `useAnswerKeys` acts on; it never acts itself.
 */
function usePicked(model: CardModel) {
  const [picked, setPicked] = useState<number | null>(null);
  const [seen, setSeen] = useState(model.question);
  if (seen !== model.question) {
    setSeen(model.question);
    setPicked(null);
  }
  // Observes ABOVE the answer keys and never consumes: `useAnswerKeys` still acts.
  useAppKeyboard(
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || model.busy || isTyping(document.activeElement)) return false;
      if (/^[1-9]$/.test(e.key) && model.choices[Number(e.key) - 1]) setPicked(Number(e.key) - 1);
      if (e.key === 'Enter' && !document.activeElement?.closest('button, a, summary')) {
        const at = model.choices.findIndex((c) => c.recommended);
        if (at >= 0) setPicked(at);
      }
      return false;
    },
    { priority: PICK_OBSERVER_PRIORITY },
  );
  // A failed run hands the card back: no stale confirmation over the error.
  return model.error ? null : picked;
}

function FieldCard({ field }: { field: CardField }) {
  const submit = field.submit;
  return (
    <label className="d1-field" data-testid="companion-fusion-d1-field">
      <span className="typo-label text-foreground">{field.label || C.yourAnswer}</span>
      <textarea
        className={`${INPUT_FIELD} typo-body`}
        rows={field.multiline ? 3 : 1}
        value={field.value}
        placeholder={field.placeholder}
        disabled={field.disabled}
        onChange={(e) => field.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && submit?.enabled) {
            e.preventDefault();
            void submit.run();
          }
        }}
      />
      {submit && (
        <span className="d1-field-foot">
          <span className="typo-caption">{C.newLine}</span>
          <Button variant="primary" size="sm" loading={submit.busy} disabled={!submit.enabled} onClick={() => void submit.run()}>
            {submit.label}
            <kbd className="d1-kbd is-on-primary typo-code">Enter</kbd>
          </Button>
        </span>
      )}
    </label>
  );
}

export function Answers({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const picked = usePicked(model);
  const [clicked, setClicked] = useState<number | null>(null);
  const field = model.field;
  const n = model.choices.length;
  const cards = n + (field ? 1 : 0);
  useFlight(listRef, cards);
  if (cards === 0) return null;
  const shown = model.error ? null : (clicked ?? picked);
  return (
    <ol
      ref={listRef}
      className={`d1-answers${n > 3 ? ' is-many' : ''}`}
      style={{ ['--n' as string]: n === 4 ? 2 : Math.max(1, Math.min(3, n)) }}
      aria-label={C.choose}
      data-testid="companion-fusion-d1-answers"
    >
      {model.choices.map((c, i) => (
        <li key={c.key} className="d1-slot">
          <OptionCard
            choice={c}
            index={i}
            rec={model.recommendation}
            herOwn={herOwn}
            disabled={model.busy}
            picked={shown === i}
            brief={n > 3}
            onPick={() => setClicked(i)}
          />
        </li>
      ))}
      {field && (
        <li className="d1-slot is-wide">
          <FieldCard field={field} />
        </li>
      )}
    </ol>
  );
}
