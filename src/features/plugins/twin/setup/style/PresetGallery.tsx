/**
 * The curated gallery: ten presets in an auto-fit grid, led by the Roll tile.
 *
 * The Roll tile is deliberately NOT shaped like a preset card (dashed, no
 * sample, no chips): the generated tail must never be mistaken for the
 * curated core.
 */

import { Dices } from 'lucide-react';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_PRESETS } from './stylePresets';
import { PresetCard } from './PresetCard';
import type { StyleStudioApi } from './styleContract';

export const STYLE_GRID = 'grid gap-3 grid-cols-[repeat(auto-fit,minmax(16rem,1fr))]';

export function PresetGallery({ studio }: { studio: StyleStudioApi }) {
  const { t } = useTranslation();
  const ts = t.twin.style.gallery;

  return (
    <div className={STYLE_GRID}>
      <div className="flex flex-col items-start justify-center gap-3 rounded-card border border-dashed border-primary/30 bg-primary/5 p-4">
        <Dices className="w-6 h-6 text-primary" aria-hidden="true" />
        <p className="typo-title">{ts.rollTitle}</p>
        <p className="typo-body text-foreground">{ts.rollHint}</p>
        <AsyncButton
          onClick={studio.roll}
          variant="secondary"
          size="sm"
          icon={<Dices className="w-3.5 h-3.5" />}
          data-testid="style-roll"
        >
          {ts.rollTitle}
        </AsyncButton>
      </div>
      {STYLE_PRESETS.map((preset) => (
        <PresetCard
          key={preset.id}
          preset={preset}
          pins={studio.pins}
          onTogglePin={studio.togglePin}
          onPick={studio.pickPreset}
        />
      ))}
    </div>
  );
}

export default PresetGallery;
