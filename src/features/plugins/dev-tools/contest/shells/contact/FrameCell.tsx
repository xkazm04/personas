// One frame on a contact sheet: the variant's print (screenshot), a live
// scaled thumbnail (only on the developed strip), or a latent card that still
// carries the variant's facts. Grease-pencil mark, pin count and key sit on
// top; a transparent button over the whole cell opens it on the loupe (an
// iframe cannot live inside a <button>).
// Extractable: a gallery tile for any variant.
import { useState } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import { VariantFrame } from '../../components/VariantFrame';
import { CONTACT_COPY as C, fill } from './copy';
import { MARK_GLYPH, frameMode } from './contactModel';

export const MARK_TEXT: Readonly<Record<ContestReviewBucket, string>> = {
  failure: 'text-status-error',
  impractical: 'text-status-warning',
  shortlist: 'text-status-info',
  winner: 'text-status-success',
};

export interface FrameCellProps {
  variant: ContestVariant;
  bucket: ContestReviewBucket | null;
  pinCount?: number;
  /** Render a live iframe thumbnail when there is no screenshot. */
  live?: boolean;
  selected?: boolean;
  onOpen?: () => void;
  className?: string;
}

export function FrameCell({ variant, bucket, pinCount = 0, live = false, selected = false, onOpen, className = '' }: FrameCellProps) {
  const [broken, setBroken] = useState(false);
  const mode = frameMode(variant, live);
  const shown = mode === 'screenshot' && broken ? (live && variant.previewUrl ? 'live' : 'latent') : mode;

  return (
    <div
      className={`group relative aspect-[16/10] overflow-hidden rounded-card border bg-secondary/20 ${
        selected ? 'border-primary shadow-elevation-2' : 'border-primary/12'
      } ${className}`}
      data-testid={`contact-frame-${variant.key}`}
      data-mode={shown}
    >
      {shown === 'screenshot' && (
        <img
          src={variant.screenshots[0]}
          alt={variant.title || variant.key}
          loading="lazy"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover object-top"
        />
      )}
      {shown === 'live' && <VariantFrame variant={variant} thumbnail />}
      {(shown === 'latent' || shown === 'missing') && (
        <div className={`flex h-full flex-col justify-end gap-0.5 p-2 ${shown === 'missing' ? 'border-dashed' : ''}`}>
          <p className="typo-caption text-foreground">{shown === 'missing' ? C.frameMissing : C.frameLatent}</p>
          {variant.title && <p className="typo-title line-clamp-1">{variant.title}</p>}
          {variant.concept && <p className="typo-caption text-foreground line-clamp-2">{variant.concept}</p>}
          <Numeric value={variant.bytes} unit="compact" className="typo-caption text-foreground" />
        </div>
      )}

      <span className="absolute left-1.5 top-1.5 rounded-interactive bg-background/85 px-1.5 typo-label text-foreground shadow-elevation-1">
        {variant.key}
      </span>
      {bucket && (
        <span
          className={`absolute right-1.5 top-1 typo-heading-lg ${MARK_TEXT[bucket]}`}
          aria-hidden
          data-testid={`contact-mark-${variant.key}`}
        >
          {MARK_GLYPH[bucket]}
        </span>
      )}
      {pinCount > 0 && (
        <span className="absolute bottom-1.5 right-1.5 rounded-pill bg-primary px-1.5 typo-label text-background">
          {fill(C.framePins, { count: pinCount })}
        </span>
      )}
      {onOpen && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={fill(C.frameOpen, { key: variant.key })}
          aria-current={selected || undefined}
          className="absolute inset-0 bg-transparent transition-colors hover:bg-primary/5 focus-ring"
          data-testid={`contact-frame-open-${variant.key}`}
        />
      )}
    </div>
  );
}
