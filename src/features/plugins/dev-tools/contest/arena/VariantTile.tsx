// A variant that crossed the line: its concept (once), its blind key and
// size, and the visual-pass screenshot only when one exists — never a
// broken-image placeholder. Clicking it opens the photo finish on it. The
// filmstrip uses the same tile, with the active one highlighted. Its name is
// its visible content (concept, key, tray) plus an sr-only "open in the photo
// finish", so a voice user can say what they see (WCAG 2.5.3).
import { useState } from 'react';
import { FileText } from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestReviewBucket } from '@/lib/bindings/ContestReviewBucket';
import type { ContestVariant } from '@/lib/bindings/ContestVariant';

import { bucketLabel, bucketTone } from '../model/labels';
import { variantName } from './arenaModel';
import { ToneDot } from './ToneDot';

export interface VariantTileProps {
  variant: ContestVariant;
  bucket?: ContestReviewBucket | null;
  active?: boolean;
  onOpen?: (key: string) => void;
}

export function VariantTile({ variant, bucket = null, active = false, onOpen }: VariantTileProps) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const a = s.arena;
  const [shotFailed, setShotFailed] = useState(false);
  const shot = shotFailed ? null : (variant.screenshots[0] ?? null);
  return (
    <button
      type="button"
      onClick={() => onOpen?.(variant.key)}
      aria-current={active ? 'true' : undefined}
      className={`flex h-full w-40 flex-col overflow-hidden rounded-interactive border text-left transition-colors focus-ring ${
        active ? 'border-primary/60 bg-primary/10' : 'border-primary/10 bg-secondary/20 hover:border-primary/30'
      } ${variant.present ? '' : 'opacity-60'}`}
      data-testid={`arena-tile-${variant.key}`}
    >
      {shot && (
        <span className="block h-16 bg-secondary/30">
          <img src={shot} alt="" className="h-full w-full object-cover object-top" loading="lazy" onError={() => setShotFailed(true)} />
        </span>
      )}
      <span className="block space-y-0.5 px-2 py-1.5">
        <span className="block typo-caption text-foreground truncate">{variantName(variant)}</span>
        <span className="flex items-center gap-1.5 typo-caption">
          <span className="text-primary">{variant.key}</span>
          <span aria-hidden>·</span>
          <Numeric value={variant.bytes} unit="compact" />
          {variant.hasNotes && (
            <>
              <FileText className="w-3 h-3 shrink-0" aria-hidden />
              <span className="sr-only">{s.variant_has_notes}</span>
            </>
          )}
        </span>
        {bucket && <ToneDot tone={bucketTone(bucket)}>{bucketLabel(s, bucket)}</ToneDot>}
      </span>
      <span className="sr-only">{a.open_tile_hint}</span>
    </button>
  );
}
