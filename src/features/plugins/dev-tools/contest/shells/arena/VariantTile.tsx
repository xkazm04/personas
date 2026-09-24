// A variant that crossed the line: its blind key, title, concept and size,
// and the visual-pass screenshot when there is one. Clicking it opens the
// photo finish on that variant. Extractable as a generic variant chip.
import { FileText, ImageOff } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import { bucketLabel, bucketTone } from '../../model/labels';
import { ARENA } from './copy';

export interface VariantTileProps {
  variant: ContestVariant;
  bucket?: ContestReviewBucket | null;
  active?: boolean;
  onOpen?: (key: string) => void;
  /** Compact = filmstrip size (lightbox); default = lane size. */
  compact?: boolean;
}

export function VariantTile({ variant, bucket = null, active = false, onOpen, compact = false }: VariantTileProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const shot = variant.screenshots[0] ?? null;
  return (
    <Tooltip content={variant.concept || variant.title || variant.key}>
      <button
        type="button"
        onClick={() => onOpen?.(variant.key)}
        aria-label={ARENA.openTile(variant.key)}
        aria-current={active ? 'true' : undefined}
        className={`group flex flex-col overflow-hidden rounded-card border text-left transition-colors focus-ring ${
          compact ? 'w-36' : 'w-44'
        } ${active ? 'border-primary/50 bg-primary/10' : 'border-primary/12 bg-background hover:border-primary/30'} ${
          variant.present ? '' : 'opacity-60'
        }`}
        data-testid={`arena-tile-${variant.key}`}
      >
        <div className={`flex items-center justify-center bg-secondary/30 ${compact ? 'h-14' : 'h-20'}`}>
          {shot ? (
            <img src={shot} alt="" className="h-full w-full object-cover object-top" loading="lazy" />
          ) : (
            <ImageOff className="w-4 h-4 text-foreground" aria-hidden />
          )}
        </div>
        <div className="space-y-0.5 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <span className="typo-label text-primary">{variant.key}</span>
            {variant.hasNotes && <FileText className="w-3 h-3 text-foreground" aria-label={s.variant_has_notes} />}
            <span className="ml-auto typo-caption text-foreground">
              <Numeric value={variant.bytes} unit="compact" />
            </span>
          </div>
          <p className="typo-caption text-foreground truncate">{variant.title || '—'}</p>
          {!compact && variant.concept && <p className="typo-caption text-foreground truncate">{variant.concept}</p>}
          {bucket && (
            <StatusBadge variant={bucketTone(bucket)} size="sm" pill>
              {bucketLabel(s, bucket)}
            </StatusBadge>
          )}
        </div>
      </button>
    </Tooltip>
  );
}
