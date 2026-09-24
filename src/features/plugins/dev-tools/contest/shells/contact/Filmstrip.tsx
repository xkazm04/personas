// The filmstrip under the loupe: every frame of the roll, small, with its
// grease-pencil mark and pin count. No live iframes here — prints or latent
// cards only — so the strip stays light however many frames a roll has.
// Extractable: a horizontal variant picker.
import { useEffect, useRef } from 'react';

import type { ContestReview } from '@/lib/bindings/ContestReview';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import { variantReview } from '../../model/reviewModel';
import { CONTACT_COPY as C } from './copy';
import { FrameCell } from './FrameCell';

export interface FilmstripProps {
  variants: ContestVariant[];
  review: ContestReview | null;
  current: string | null;
  onPick: (key: string) => void;
}

export function Filmstrip({ variants, review, current, onPick }: FilmstripProps) {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    if (!current || !listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>('[data-film-key]');
    const el = Array.from(items).find((node) => node.dataset.filmKey === current);
    el?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [current]);

  return (
    <ol
      ref={listRef}
      aria-label={C.filmstripLabel}
      className="flex gap-2 overflow-x-auto rounded-card border-y-4 border-dotted border-primary/10 bg-secondary/10 px-2 py-2"
      data-testid="contact-filmstrip"
    >
      {variants.map((v) => {
        const vr = review ? variantReview(review, v.key) : null;
        return (
          <li key={v.key} data-film-key={v.key} className="shrink-0">
            <FrameCell
              variant={v}
              bucket={vr?.bucket ?? null}
              pinCount={vr?.pins.length ?? 0}
              selected={v.key === current}
              onOpen={() => onPick(v.key)}
              className="w-40"
            />
          </li>
        );
      })}
    </ol>
  );
}
