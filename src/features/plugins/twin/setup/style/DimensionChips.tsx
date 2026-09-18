/**
 * The 8 style dimensions as small labeled level markers.
 *
 * The level is a SHAPE (five pips, filled up to the value), never colour
 * alone, and the level word is in the tooltip and the accessible name. With
 * `onTogglePin` each chip is a pin toggle: pinning holds that dimension at
 * this card's value through every reroll. `data-testid="style-pin-<dim>"` is
 * scoped by the card that renders it (`style-preset-<id>` / `style-candidate-<n>`).
 */

import { Pin } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_DIMENSIONS, STYLE_MAX, type StyleDimension, type TwinStyleDims, type TwinStylePins } from './styleContract';

interface DimensionChipsProps {
  dims: TwinStyleDims;
  pins?: TwinStylePins;
  onTogglePin?: (dim: StyleDimension, value: number) => void;
  /** One column, for narrow hosts such as the tone card header. */
  dense?: boolean;
}

type LevelKey = 'l1' | 'l2' | 'l3' | 'l4' | 'l5';

function Pips({ value }: { value: number }) {
  return (
    <span className="flex items-center gap-0.5" aria-hidden="true">
      {Array.from({ length: STYLE_MAX }, (_, i) => (
        <span
          key={i}
          className={`h-2 w-1.5 rounded-[1px] ${i < value ? 'bg-primary/80' : 'border border-primary/25'}`}
        />
      ))}
    </span>
  );
}

export function DimensionChips({ dims, pins, onTogglePin, dense }: DimensionChipsProps) {
  const { t, tx } = useTranslation();
  const ts = t.twin.style;

  return (
    <ul className={`grid gap-x-3 gap-y-1 ${dense ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2'}`} aria-label={ts.dimsLabel}>
      {STYLE_DIMENSIONS.map((dim) => {
        const value = dims[dim];
        const copy = ts.dims[dim];
        const level = copy[`l${value}` as LevelKey] ?? '';
        const pinned = pins?.[dim] === value;
        const body = (
          <>
            <span className="typo-caption truncate">{copy.label}</span>
            <span className="ml-auto flex items-center gap-1">
              {pinned && <Pin className="w-3 h-3 text-primary" aria-hidden="true" />}
              <Pips value={value} />
            </span>
          </>
        );
        if (!onTogglePin) {
          return (
            <li key={dim}>
              <Tooltip content={tx(ts.dimLevel, { dim: copy.label, level })}>
                <span className="flex items-center gap-2 min-w-0" aria-label={tx(ts.dimLevel, { dim: copy.label, level })}>
                  {body}
                </span>
              </Tooltip>
            </li>
          );
        }
        const hint = pinned ? tx(ts.pins.unpin, { dim: copy.label }) : tx(ts.pins.pin, { dim: copy.label, level });
        return (
          <li key={dim}>
            <Tooltip content={hint}>
              <button
                type="button"
                onClick={() => onTogglePin(dim, value)}
                aria-pressed={pinned}
                aria-label={hint}
                data-testid={`style-pin-${dim}`}
                className={`focus-ring w-full flex items-center gap-2 min-w-0 px-1.5 py-0.5 rounded-interactive border transition-colors ${
                  pinned ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-secondary/40'
                }`}
              >
                {body}
              </button>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}

export default DimensionChips;
