/**
 * The two things a create form usually asks next, one layer down: the
 * languages they write in, and a voice to start from.
 *
 * Both are optional and both are here rather than in the lane because neither
 * is the question act one is asking. The languages matter enough to ask at all
 * — every generator behind the twin reads them and the old dialog never did —
 * but not enough to share the screen with the name.
 *
 * The voice is only RECORDED here. Drafting it needs the twin to exist, so the
 * stage's voice layer takes the record exactly once (`useStyleDock`).
 */

import { Check, Dices, Palette, PenLine, Sparkles } from 'lucide-react';
import { LOCALES } from '@/i18n/locales.manifest';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_PRESETS } from '../../../setup/style/stylePresets';
import type { StyleStart } from '../../../setup/style/styleContract';
import { LayerFrame } from '../layers/LayerFrame';

interface OptionsLayerProps {
  open: boolean;
  onClose: () => void;
  languages: string[];
  onLanguages: (next: string[]) => void;
  style: StyleStart | null;
  onStyle: (next: StyleStart | null) => void;
}

function Choice({
  picked,
  onPick,
  icon,
  title,
  body,
  testId,
}: {
  picked: boolean;
  onPick: () => void;
  icon: React.ReactNode;
  title: string;
  body: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={picked}
      data-picked={picked}
      data-testid={testId}
      className="mr-slat focus-ring w-full flex gap-3 rounded-card px-3.5 py-3 text-left"
    >
      <span aria-hidden className="mt-0.5 flex-shrink-0 text-primary">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block typo-title text-foreground">{title}</span>
        <span className="block typo-caption">{body}</span>
      </span>
      {picked && <Check className="w-4 h-4 flex-shrink-0 text-primary" aria-hidden />}
    </button>
  );
}

export function OptionsLayer({
  open,
  onClose,
  languages,
  onLanguages,
  style,
  onStyle,
}: OptionsLayerProps) {
  const { t } = useTranslation();
  const mc = t.twin.experience_mirror.create;
  const presets = t.twin.style.presets;

  const toggle = (code: string) =>
    onLanguages(languages.includes(code) ? languages.filter((c) => c !== code) : [...languages, code]);

  return (
    <LayerFrame
      open={open}
      onClose={onClose}
      icon={<Sparkles className="w-4 h-4" />}
      title={mc.optionsTitle}
      hint={mc.optionsHint}
      testId="mr-create-options-layer"
    >
      <div className="px-5 py-4 space-y-6">
        <fieldset className="space-y-2" data-testid="mr-create-languages">
          <legend className="typo-title text-foreground">{mc.languages}</legend>
          <p className="typo-caption">{mc.languagesHint}</p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {LOCALES.map((locale) => {
              const at = languages.indexOf(locale.code);
              const on = at >= 0;
              return (
                <button
                  key={locale.code}
                  type="button"
                  onClick={() => toggle(locale.code)}
                  aria-pressed={on}
                  data-testid={`mr-create-language-${locale.code}`}
                  className={`focus-ring inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill border typo-caption transition-colors ${
                    on ? 'border-primary/40 bg-primary/10 text-foreground' : 'border-primary/12 hover:bg-secondary/50'
                  }`}
                >
                  {on && <Check className="w-3 h-3 text-primary" aria-hidden />}
                  <span lang={locale.code}>{locale.nativeName}</span>
                  {at === 0 && languages.length > 1 && (
                    <span className="typo-label text-primary">{mc.languagesMain}</span>
                  )}
                </button>
              );
            })}
          </div>
        </fieldset>

        <section className="space-y-2" aria-labelledby="mr-create-style-title">
          <h4 id="mr-create-style-title" className="typo-title text-foreground">
            {mc.style}
          </h4>
          <p className="typo-caption">{mc.styleHint}</p>
          <div className="space-y-1.5 pt-1" data-testid="mr-create-style">
            <Choice
              picked={style === null}
              onPick={() => onStyle(null)}
              icon={<PenLine className="w-4 h-4" />}
              title={mc.styleNone}
              body={mc.styleNoneHint}
              testId="mr-create-style-none"
            />
            <Choice
              picked={style?.kind === 'roll'}
              onPick={() => onStyle({ kind: 'roll' })}
              icon={<Dices className="w-4 h-4" />}
              title={mc.styleRoll}
              body={mc.styleRollHint}
              testId="mr-create-style-roll"
            />
            {STYLE_PRESETS.map((preset) => (
              <Choice
                key={preset.id}
                picked={style?.kind === 'preset' && style.presetId === preset.id}
                onPick={() => onStyle({ kind: 'preset', presetId: preset.id })}
                icon={<Palette className="w-4 h-4" />}
                title={presets[preset.id].name}
                body={presets[preset.id].sample}
                testId={`mr-create-style-${preset.id}`}
              />
            ))}
          </div>
        </section>
      </div>
    </LayerFrame>
  );
}

export default OptionsLayer;
