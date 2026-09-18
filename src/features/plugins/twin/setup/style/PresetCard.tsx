/**
 * One curated preset: name, one-line summary, the anti-tone line, a sample
 * reply and its dimensions. The body is the pick action; the chips below it
 * are pin toggles, so the two never nest.
 */

import { Badge } from '@/features/shared/components/display/Badge';
import { useTranslation } from '@/i18n/useTranslation';
import { DimensionChips } from './DimensionChips';
import { StyleSample } from './StyleSample';
import type { StyleDimension, StylePreset, StylePresetId, TwinStylePins } from './styleContract';

interface PresetCardProps {
  preset: StylePreset;
  pins: TwinStylePins;
  onTogglePin: (dim: StyleDimension, value: number) => void;
  onPick: (id: StylePresetId) => void;
}

export function PresetCard({ preset, pins, onTogglePin, onPick }: PresetCardProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.style;
  const copy = ts.presets[preset.id];

  return (
    <article
      className="flex flex-col gap-3 rounded-card border border-primary/12 bg-background/40 p-3 shadow-elevation-1"
      data-testid={`style-preset-${preset.id}`}
    >
      <button
        type="button"
        onClick={() => onPick(preset.id)}
        aria-label={tx(ts.gallery.use, { name: copy.name })}
        className="focus-ring text-left space-y-2 rounded-interactive -m-1 p-1 hover:bg-secondary/30 transition-colors"
      >
        <span className="flex items-start gap-2">
          <span className="typo-title flex-1 min-w-0">{copy.name}</span>
          <Badge variant="neutral" size="sm">{ts.gallery.presetBadge}</Badge>
        </span>
        <span className="block typo-body text-foreground">{copy.summary}</span>
        <span className="block typo-caption italic">{copy.avoid}</span>
        <StyleSample reply={copy.sample} />
      </button>
      <DimensionChips dims={preset.dims} pins={pins} onTogglePin={onTogglePin} />
    </article>
  );
}

export default PresetCard;
