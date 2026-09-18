/**
 * How many dimensions are pinned, and the way to let go of all of them. Pins
 * themselves are set on the cards' dimension chips.
 */

import { Pin } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { STYLE_DIMENSIONS, type TwinStylePins } from './styleContract';

export function pinCount(pins: TwinStylePins): number {
  return STYLE_DIMENSIONS.filter((d) => pins[d] !== null).length;
}

export function PinsBar({ pins, onClear }: { pins: TwinStylePins; onClear: () => void }) {
  const { t, tx } = useTranslation();
  const ts = t.twin.style.pins;
  const count = pinCount(pins);

  return (
    <div className="flex flex-wrap items-center gap-2 typo-caption">
      <Pin className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
      <span aria-live="polite">{count > 0 ? tx(ts.pinned, { count }) : ts.hint}</span>
      {count > 0 && (
        <Button variant="ghost" size="xs" onClick={onClear} data-testid="style-pins-clear">
          {ts.clear}
        </Button>
      )}
    </div>
  );
}

export default PinsBar;
