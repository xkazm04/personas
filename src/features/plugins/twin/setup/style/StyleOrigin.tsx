/**
 * Where a tone row's voice came from: "Based on <preset>" or "Rolled: <name>",
 * plus the dimensions THIS channel resolved to. Renders nothing for a
 * hand-written row. A preset's name is re-translated from its id, so the
 * label follows the UI language rather than the language it was applied in.
 */

import { Dices, Palette } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { DimensionChips } from './DimensionChips';
import { parseToneStyle } from './styleContract';
import { presetById } from './stylePresets';

export function StyleOrigin({ styleJson }: { styleJson: string | null | undefined }) {
  const { t, tx } = useTranslation();
  const ts = t.twin.style;
  const style = parseToneStyle(styleJson);
  if (!style) return null;

  const preset = style.source === 'preset' ? presetById(style.presetId) : null;
  const label = preset
    ? tx(ts.origin.preset, { name: ts.presets[preset.id]?.name ?? style.name })
    : tx(ts.origin.rolled, { name: style.name });
  const Icon = preset ? Palette : Dices;

  return (
    <div className="space-y-2 rounded-input bg-secondary/20 px-3 py-2" data-testid="style-origin">
      <p className="flex items-center gap-1.5 typo-caption text-foreground">
        <Icon className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
        {label}
      </p>
      <DimensionChips dims={style.dims} dense />
    </div>
  );
}

export default StyleOrigin;
