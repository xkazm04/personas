/**
 * The optional starting style, as a deck: no style, "deal me three", and the
 * ten curated presets. It only RECORDS a choice — the table runs it once the
 * twin exists (see `useCreateTwin`). `null` is "no starting style", the
 * default, because the evidence says the voice is better learned from what
 * the person writes than chosen from a list.
 */

import { Dices, Palette, PenLine } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_PRESETS } from '../../../setup/style/stylePresets';
import type { StyleStart } from '../../../setup/style/styleContract';
import { StyleFlipCard } from './StyleFlipCard';

interface StyleDeckProps {
  value: StyleStart | null;
  onChange: (next: StyleStart | null) => void;
}

export function StyleDeck({ value, onChange }: StyleDeckProps) {
  const { t } = useTranslation();
  const tc = t.twin.experience_opus.create;
  const presets = t.twin.style.presets;
  const icon = 'w-4 h-4';

  return (
    <section className="space-y-3" data-testid="xo-create-style" aria-labelledby="xo-create-style-title">
      <div>
        <h3 id="xo-create-style-title" className="typo-section-title">
          {tc.styleTitle}
        </h3>
        <p className="typo-body text-foreground">{tc.styleHint}</p>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(13.5rem, 1fr))' }}>
        <StyleFlipCard
          picked={value === null}
          onPick={() => onChange(null)}
          testId="xo-create-style-none"
          icon={<PenLine className={icon} />}
          title={tc.styleNone}
          summary={tc.styleNoneHint}
          dashed
        />
        <StyleFlipCard
          picked={value?.kind === 'roll'}
          onPick={() => onChange({ kind: 'roll' })}
          testId="xo-create-style-roll"
          icon={<Dices className={icon} />}
          title={tc.styleRoll}
          summary={tc.styleRollHint}
          dashed
        />
        {STYLE_PRESETS.map((preset) => (
          <StyleFlipCard
            key={preset.id}
            picked={value?.kind === 'preset' && value.presetId === preset.id}
            onPick={() => onChange({ kind: 'preset', presetId: preset.id })}
            testId={`xo-create-style-${preset.id}`}
            icon={<Palette className={icon} />}
            title={presets[preset.id].name}
            summary={presets[preset.id].summary}
            flipHint={tc.styleFlipHint}
            back={{
              sample: presets[preset.id].sample,
              avoid: presets[preset.id].avoid,
              avoidLabel: tc.styleNever,
            }}
          />
        ))}
      </div>
    </section>
  );
}

export default StyleDeck;
