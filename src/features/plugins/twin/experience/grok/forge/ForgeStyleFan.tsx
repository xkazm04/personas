/**
 * Starting-voice picker: THREE tiles in the main sight — decide later, surprise
 * me, choose a voice. The ten curated presets live behind the third tile, in
 * `StylePresetDialog`, so this phase stays one calm sight with one decision in
 * it and no nested scroller.
 */

import { useState } from 'react';
import { Dices, Palette, SkipForward } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { presetById } from '../../../setup/style/stylePresets';
import type { StyleStart } from '../../../setup/style/styleContract';
import { StyleTile } from './StyleTile';
import { StylePresetDialog } from './StylePresetDialog';

interface ForgeStyleFanProps {
  value: StyleStart | null;
  onChange: (next: StyleStart | null) => void;
}

export function ForgeStyleFan({ value, onChange }: ForgeStyleFanProps) {
  const { t } = useTranslation();
  const xg = t.twin.experience_grok;
  const ts = t.twin.style;
  const [picking, setPicking] = useState(false);
  const icon = 'w-3.5 h-3.5';

  const chosenId = value?.kind === 'preset' ? value.presetId : null;
  const chosen = presetById(chosenId);

  return (
    <fieldset className="space-y-2" data-testid="create-twin-style-step">
      <legend className="typo-title text-foreground">{xg.forge.style}</legend>
      <p className="typo-caption">{xg.forge.styleHint}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        <StyleTile
          selected={value === null}
          onSelect={() => onChange(null)}
          title={xg.forge.styleSkip}
          body={xg.forge.styleSkipHint}
          icon={<SkipForward className={icon} />}
          testId="create-twin-style-skip"
        />
        <StyleTile
          selected={value?.kind === 'roll'}
          onSelect={() => onChange({ kind: 'roll' })}
          title={xg.forge.styleSurprise}
          body={xg.forge.styleSurpriseHint}
          icon={<Dices className={icon} />}
          testId="create-twin-style-roll"
        />
        <StyleTile
          selected={chosen !== null}
          onSelect={() => setPicking(true)}
          title={chosen ? ts.presets[chosen.id].name : xg.forge.styleChoose}
          body={chosen ? ts.presets[chosen.id].summary : xg.forge.styleChooseHint}
          icon={<Palette className={icon} />}
          testId="create-twin-style-choose"
        />
      </div>
      {picking && (
        <StylePresetDialog
          selected={chosenId}
          onPick={(presetId) => {
            onChange({ kind: 'preset', presetId });
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </fieldset>
  );
}

export default ForgeStyleFan;
