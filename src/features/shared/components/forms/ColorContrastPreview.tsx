import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { contrastRatio, meetsWcagAA, readThemeColor } from './colorContrast';

interface ColorContrastPreviewProps {
  /** The currently picked color, as a hex string. */
  color: string;
}

/**
 * @catalog ColorContrastPreview — two-line "Aa" readability check for a picked color against the theme's foreground and background, with a WCAG AA verdict. Rendered for you by `ColorPicker`.
 *
 * Advisory, never blocking: a persona color that fails contrast still commits.
 * The point is that the operator sees it before the card does.
 */
export function ColorContrastPreview({ color }: ColorContrastPreviewProps) {
  const { t } = useTranslation();
  const ratio = contrastRatio(color, readThemeColor('--background', '#0b0b0f'));
  if (ratio === null) return null;

  const foreground = readThemeColor('--foreground', '#e2e8f0');
  const background = readThemeColor('--background', '#0b0b0f');
  const passes = meetsWcagAA(color, background);
  const label = passes
    ? t.shared.forms_extra.contrast_pass
    : t.shared.forms_extra.contrast_fail;

  return (
    <div className="flex items-center gap-2" aria-label={t.shared.forms_extra.contrast_preview}>
      <span
        aria-hidden="true"
        className="inline-flex h-7 items-center rounded-lg border border-primary/15 px-2 typo-body"
        style={{ backgroundColor: background, color }}
      >
        Aa
      </span>
      <span
        aria-hidden="true"
        className="inline-flex h-7 items-center rounded-lg border border-primary/15 px-2 typo-body"
        style={{ backgroundColor: color, color: foreground }}
      >
        Aa
      </span>
      <span
        className={`typo-caption ${passes ? 'text-emerald-400' : 'text-amber-400'}`}
        data-contrast-verdict={passes ? 'pass' : 'fail'}
      >
        {label} <Numeric value={ratio} precision={1} />:1
      </span>
    </div>
  );
}
