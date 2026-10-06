/**
 * DecisionTiles - the choices as big keyed tiles (1-9): the key large, the
 * verb as the tile's one emphasis, its consequence small at the foot. Her
 * pick is lit in place (a ring of her colour and a small "Her pick" seal with
 * her face), and `Verdict` carries her one-line why under the grid - or, while
 * she has not been asked, the "Ask Athena · 0" door.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import type { ReactNode } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import type { CardChoice, CardModel } from '../c/bodies/model';
import { ISLAND_COPY as I } from './copy';

/** `**bold**` and `` `code` `` as real marks, never as literal characters. */
export function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
    .filter(Boolean)
    .map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <b key={i}>{part.slice(2, -2)}</b>
      ) : part.startsWith('`') && part.endsWith('`') ? (
        <code key={i} className="typo-code">
          {part.slice(1, -1)}
        </code>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
}

function toneOf(choice: CardChoice): string {
  if (choice.tone === 'danger') return 'var(--status-error)';
  if (choice.tone === 'neutral') return 'var(--foreground)';
  return 'var(--primary)';
}

function Face({ size }: { size: number }) {
  return (
    <span className="r5a-mark shrink-0" style={{ width: size, height: size }} aria-hidden>
      <span className="r5a-face" />
    </span>
  );
}

export function DecisionTiles({ model }: { model: CardModel }) {
  return (
    <ol className="r5a-tiles" aria-label={I.keysChoose}>
      {model.choices.map((c, i) => (
        <li key={c.key}>
          <Button
            variant="ghost"
            className={`r5a-tile${c.recommended ? ' is-pick' : ''}`}
            style={{ ['--t' as string]: toneOf(c) }}
            data-card-choice=""
            data-testid={`companion-r5a-choice-${i + 1}`}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            disabled={model.busy}
            loading={c.busy}
            onClick={() => void c.run()}
          >
            <span className="r5a-tile-key typo-data-lg">{i + 1}</span>
            <span className="typo-title-lg text-foreground">{inline(c.label)}</span>
            {c.hint && <span className="r5a-tile-hint typo-caption">{c.hint}</span>}
            {c.recommended && (
              <span className="r5a-seal typo-label">
                <Face size={18} />
                {I.herPick}
              </span>
            )}
          </Button>
        </li>
      ))}
    </ol>
  );
}

export function Verdict({ model }: { model: CardModel }) {
  const rec = model.recommendation;
  if (!rec) return null;
  if (rec.revealed && rec.text) {
    const pick = model.choices.find((c) => c.recommended);
    return (
      <div className="r5a-verdict" data-testid="companion-r5a-verdict">
        <Face size={28} />
        <p className="typo-body-lg text-foreground min-w-0">
          <span className="typo-label text-primary block">{pick ? `${I.herPick} · ${model.choices.indexOf(pick) + 1}` : rec.label}</span>
          {rec.text}
        </p>
      </div>
    );
  }
  if (rec.composing) {
    return (
      <div className="r5a-verdict" aria-busy>
        <Face size={28} />
        <p className="typo-body text-foreground">{I.composing}</p>
      </div>
    );
  }
  return (
    <>
      {rec.reveal && (
        <Button variant="ghost" className="r5a-ask typo-body" onClick={rec.reveal} aria-keyshortcuts="0" data-testid="companion-r5a-ask">
          <Face size={28} />
          {I.askHer}
          <span className="r5a-kbd typo-caption">{I.keyAsk}</span>
        </Button>
      )}
      {rec.failed && <p className="r5a-problem is-warn typo-body">{rec.failed}</p>}
    </>
  );
}
