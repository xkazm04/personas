/**
 * The create dialog's optional style step: a compact gallery (name + summary
 * only), a "Surprise me" tile and Skip. It only RECORDS a choice; the dialog
 * hands it to Setup, where the studio runs it with the twin in hand.
 * `null` is Skip, the default.
 */

import { Dices, Palette, SkipForward } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_PRESETS } from './stylePresets';
import type { StyleStart } from './styleContract';

interface StyleStepPickerProps {
  value: StyleStart | null;
  onChange: (next: StyleStart | null) => void;
}

interface TileProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  icon: React.ReactNode;
  testId: string;
  dashed?: boolean;
}

function Tile({ selected, onSelect, title, body, icon, testId, dashed }: TileProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={`focus-ring text-left flex gap-2 rounded-interactive border px-3 py-2 transition-colors ${
        dashed ? 'border-dashed' : ''
      } ${selected ? 'border-violet-500/40 bg-violet-500/10' : 'border-primary/10 hover:bg-secondary/40'}`}
    >
      <span className="mt-0.5 flex-shrink-0 text-primary" aria-hidden="true">{icon}</span>
      <span className="min-w-0">
        <span className="block typo-title">{title}</span>
        <span className="block typo-caption">{body}</span>
      </span>
    </button>
  );
}

export function StyleStepPicker({ value, onChange }: StyleStepPickerProps) {
  const { t } = useTranslation();
  const ts = t.twin.style;
  const icon = 'w-3.5 h-3.5';

  return (
    <fieldset className="space-y-2" data-testid="create-twin-style-step">
      <legend className="typo-title">{ts.create.title}</legend>
      <p className="typo-caption">{ts.create.hint}</p>
      <div className="grid gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
        <Tile
          selected={value === null}
          onSelect={() => onChange(null)}
          title={ts.create.skip}
          body={ts.create.skipHint}
          icon={<SkipForward className={icon} />}
          testId="create-twin-style-skip"
        />
        <Tile
          selected={value?.kind === 'roll'}
          onSelect={() => onChange({ kind: 'roll' })}
          title={ts.create.surprise}
          body={ts.create.surpriseHint}
          icon={<Dices className={icon} />}
          testId="create-twin-style-roll"
          dashed
        />
        {STYLE_PRESETS.map((preset) => (
          <Tile
            key={preset.id}
            selected={value?.kind === 'preset' && value.presetId === preset.id}
            onSelect={() => onChange({ kind: 'preset', presetId: preset.id })}
            title={ts.presets[preset.id].name}
            body={ts.presets[preset.id].summary}
            icon={<Palette className={icon} />}
            testId={`create-twin-style-${preset.id}`}
          />
        ))}
      </div>
    </fieldset>
  );
}

export default StyleStepPicker;
