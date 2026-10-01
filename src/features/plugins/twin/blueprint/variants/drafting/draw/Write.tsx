import { memo, useContext, type CSSProperties } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric, type NumericUnit } from '@/lib/utils/formatters';
import { DrawContext } from './DrawSheet';

// CSSProperties declares no custom properties; `--ch` is the engine's own, read only by draw.css.
const charAt = (i: number) => ({ '--ch': i }) as CSSProperties;

/**
 * Text lettered in one character at a time (`data-draw="write"`), each
 * character at its own moment after the part's (draw.css). Assistive tech
 * reads the whole text once; the letters are for the eye. Outside a live
 * drawing (reduced motion, a sheet already shown, a loop) it is plain text.
 * Memoised: a sheet re-rendered with the same words (a model refresh) never
 * re-creates its letters.
 */
const Write = memo(function Write({ text, className, style }: { text: string; className?: string; style?: CSSProperties }) {
  const { live } = useContext(DrawContext);
  if (!live) return className || style ? <span className={className} style={style}>{text}</span> : <>{text}</>;
  const chars = Array.from(text);
  return (
    <span data-draw="write" data-split="" data-draw-letters={chars.length} className={className} style={style}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {chars.map((ch, i) => (
          <span key={i} data-ch="" style={charAt(i)}>
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
});
export default Write;

/** A figure written in like a word: formatted as `<Numeric>` would, then lettered. */
export function WriteNumber({
  value,
  unit = 'plain',
  precision,
  className,
}: {
  value: number;
  unit?: NumericUnit;
  precision?: number;
  className?: string;
}) {
  const { language } = useTranslation();
  return (
    <Numeric className={className}>
      <Write text={formatNumeric(value, unit, { precision, language })} />
    </Numeric>
  );
}
