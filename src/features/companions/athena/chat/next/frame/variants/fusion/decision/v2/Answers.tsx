/**
 * Fusion · decision v2 - the answers as a small board of Overview tiles that
 * FLY IN from the rail's attention circle (Fusion's own `useFlight`: measured
 * before paint, staggered, on the product's ease; reduced motion just shows
 * them). One to three answers share the row; four or more become two columns
 * of row-shaped tiles; a typed answer is a wide tile under them. Once her pick
 * is revealed its tile takes two tracks - a board's lead tile - so her
 * one-line why reads in full beside the others.
 *
 * The picked tile confirms: a press, a number key or Enter on her pick lights
 * its edge and fills its key cap in the choice's ink while the stage moves on.
 * The keys themselves are `useAnswerKeys` (wired by `ItemSurface`); this only
 * watches them to mark which tile was taken.
 *
 * TODO(prototype, 2026-10-07): athena decision surface round 6 - consolidate after the owner picks.
 */

import { useRef, useState } from 'react';
import { KitHost } from '@/features/shared/components/kit';
import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { CardModel } from '../../../c/bodies/model';
import { useFlight } from '../../AnswerCards';
import { FUSION_COPY as F } from '../../copy';
import { isTyping } from '../../text';
import { AnswerTile } from './AnswerTile';
import { FieldTile } from './FieldTile';

/** Above `useAnswerKeys` (layer + 2): it sees the key first and always passes it on. */
const WATCH_PRIORITY = FULLSCREEN_LAYER_PRIORITY + 3;

/** Mark the tile a key took (the keys are useAnswerKeys'; this only watches and never consumes). */
function useKeyedChoice(model: CardModel, mark: (key: string) => void) {
  useAppKeyboard(
    (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || model.busy || isTyping(document.activeElement)) return false;
      if (/^[1-9]$/.test(e.key)) {
        const c = model.choices[Number(e.key) - 1];
        if (c) mark(c.key);
        return false;
      }
      if (e.key !== 'Enter') return false;
      const el = document.activeElement;
      if (el && el !== document.body && ['BUTTON', 'A', 'SUMMARY'].includes(el.tagName)) return false;
      const pick = model.choices.find((c) => c.recommended);
      if (pick) mark(pick.key);
      return false;
    },
    { priority: WATCH_PRIORITY },
  );
}

export function Answers({ model, herOwn }: { model: CardModel; herOwn: boolean }) {
  const listRef = useRef<HTMLOListElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const rec = model.recommendation;
  const field = model.field;
  const count = model.choices.length;
  const cards = count + (field ? 1 : 0);
  // Her pick (or the safe pick) takes two tracks of the board once revealed, so her why reads in full.
  const lit = count > 1 && !!rec?.revealed && model.choices.some((c) => c.recommended);
  useFlight(listRef, cards);
  useKeyedChoice(model, setChosen);
  if (cards === 0) return null;

  return (
    <KitHost>
      <ol
        ref={listRef}
        className={`d2-answers${count > 3 ? ' is-many' : ''}`}
        style={{ ['--n' as string]: Math.max(1, Math.min(3, count)) + (lit ? 1 : 0) }}
        aria-label={F.keys.choose}
        data-testid="companion-fusion-d2-answers"
      >
        {model.choices.map((c, i) => (
          <li key={c.key} className={`d2-slot${lit && c.recommended ? ' is-lit' : ''}`}>
            <AnswerTile
              choice={c}
              index={i}
              rec={rec}
              herOwn={herOwn}
              disabled={model.busy}
              chosen={chosen === c.key}
              compact={count > 3}
              onChoose={() => {
                setChosen(c.key);
                void c.run();
              }}
            />
          </li>
        ))}
        {field && (
          <li className="d2-slot is-wide">
            <FieldTile field={field} />
          </li>
        )}
      </ol>
    </KitHost>
  );
}
