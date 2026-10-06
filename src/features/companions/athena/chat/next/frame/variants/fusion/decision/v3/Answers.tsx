/**
 * Fusion · decision v3 ("Command palette") - the answers as the palette's
 * result rows, each lifted onto a card of its own and flown in from the rail
 * into one vertical stack under the question. Dense on purpose: one line per
 * answer when it fits, the consequence in the right-hand column, a tighter
 * rhythm past four answers; a typed answer is the last card, an input row.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - keep the owner's pick, delete the rest.
 */

import { useRef } from 'react';
import type { CardModel } from '../../../c/bodies/model';
import { FUSION_COPY as F } from '../../copy';
import { AnswerRow } from './AnswerRow';
import { FieldRow } from './FieldRow';
import { useHighlightPick, useRowFlight, useTakenEcho } from './useRows';
import './palette.css';

export function Answers({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rec = model.recommendation;
  const field = model.field;
  const count = model.choices.length + (field ? 1 : 0);
  const pickAt = rec?.revealed ? model.choices.findIndex((c) => c.recommended) : -1;
  const [taken, setTaken] = useTakenEcho(model);
  useRowFlight(listRef, count);
  useHighlightPick(rowRefs, pickAt);
  if (count === 0) return null;

  return (
    <ol
      ref={listRef}
      className={`fd3-answers${model.choices.length > 4 ? ' is-many' : ''}`}
      aria-label={F.keys.choose}
      data-testid="companion-fusion-d3-answers"
    >
      {model.choices.map((c, i) => (
        <li key={c.key} className="fd3-slot">
          <AnswerRow
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            choice={c}
            index={i}
            pick={i === pickAt}
            herOwn={herOwn}
            rec={rec}
            disabled={model.busy}
            taken={taken === i}
            dimmed={taken !== null && taken !== i}
            onTake={() => setTaken(i)}
          />
        </li>
      ))}
      {field && (
        <li className="fd3-slot">
          <FieldRow field={field} />
        </li>
      )}
    </ol>
  );
}
