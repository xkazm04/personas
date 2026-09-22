/**
 * The languages the person writes in, primary first.
 *
 * Every generator behind the twin reads them — the style studio writes its
 * samples in the first, and the guide offers answers in it — and the create
 * dialog never asked. The list is the app's own locale manifest, shown by
 * native name (a language's name for itself needs no translation), and the
 * pick order is the stored order: the first one chosen is the main one.
 */

import { Check } from 'lucide-react';
import { LOCALES } from '@/i18n/locales.manifest';
import { useTranslation } from '@/i18n/useTranslation';

interface LanguageChipsProps {
  value: string[];
  onChange: (next: string[]) => void;
}

export function LanguageChips({ value, onChange }: LanguageChipsProps) {
  const { t } = useTranslation();
  const tc = t.twin.experience_opus.create;

  const toggle = (code: string) =>
    onChange(value.includes(code) ? value.filter((c) => c !== code) : [...value, code]);

  return (
    <fieldset className="space-y-2" data-testid="xo-create-languages">
      <legend className="typo-title">{tc.languages}</legend>
      <p className="typo-caption">{tc.languagesHint}</p>
      <div className="flex flex-wrap gap-1.5">
        {LOCALES.map((locale) => {
          const at = value.indexOf(locale.code);
          const on = at >= 0;
          return (
            <button
              key={locale.code}
              type="button"
              onClick={() => toggle(locale.code)}
              aria-pressed={on}
              data-testid={`xo-create-language-${locale.code}`}
              className={`focus-ring inline-flex items-center gap-1.5 px-2.5 py-1 rounded-pill border typo-caption transition-colors ${
                on
                  ? 'border-primary/40 bg-primary/12 text-foreground'
                  : 'border-primary/10 hover:bg-secondary/50 hover:text-foreground'
              }`}
            >
              {on && <Check className="w-3 h-3 text-primary" aria-hidden />}
              <span lang={locale.code}>{locale.nativeName}</span>
              {at === 0 && value.length > 1 && (
                <span className="typo-label text-primary">{tc.languagesMain}</span>
              )}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default LanguageChips;
