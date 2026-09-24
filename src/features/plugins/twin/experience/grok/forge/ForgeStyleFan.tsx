/**
 * Starting-voice picker as a fan of preset cards, plus skip and surprise.
 */

import { Dices, Palette, SkipForward } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_PRESETS } from '../../../setup/style/stylePresets';
import type { StyleStart } from '../../../setup/style/styleContract';

interface ForgeStyleFanProps {
  value: StyleStart | null;
  onChange: (next: StyleStart | null) => void;
}

function StyleTile({
  selected,
  onSelect,
  title,
  body,
  icon,
  testId,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
  icon: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={testId}
      className={`focus-ring text-left flex gap-2 rounded-card border px-3 py-2.5 transition-colors min-h-[4.5rem] ${
        selected
          ? 'border-primary bg-primary/10 shadow-elevation-2'
          : 'border-primary/15 bg-card-bg hover:border-primary/40 hover:shadow-elevation-1'
      }`}
    >
      <span className="mt-0.5 flex-shrink-0 text-primary" aria-hidden>{icon}</span>
      <span className="min-w-0">
        <span className="block typo-title">{title}</span>
        <span className="block typo-caption text-primary">{body}</span>
      </span>
    </button>
  );
}

export function ForgeStyleFan({ value, onChange }: ForgeStyleFanProps) {
  const { t } = useTranslation();
  const xg = t.twin.experience_grok;
  const ts = t.twin.style;
  const icon = 'w-3.5 h-3.5';

  return (
    <fieldset className="space-y-2" data-testid="create-twin-style-step">
      <legend className="typo-title">{xg.forge.style}</legend>
      <p className="typo-caption text-primary">{xg.forge.styleHint}</p>
      <div className="grid gap-2 sm:grid-cols-2 max-h-72 overflow-y-auto pr-1">
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
        {STYLE_PRESETS.map((preset) => (
          <StyleTile
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

export default ForgeStyleFan;
