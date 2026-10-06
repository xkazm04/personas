/**
 * StripChip — one chip of the Decision Center strip.
 *
 * Speaks the Activity band's own glass-window grammar (`ae-win` + a lamp), so
 * it sits beside the fleet tally as one vocabulary. Compact by default: glyph +
 * count, the full name arriving only when the strip's own box is 72rem wide
 * (a container query, so it follows the band's free width, not the window)
 * and always in the tooltip and the accessible name.
 *
 * A chip is never absent: at zero it is dark glass, still pressable. A chip
 * whose source did not answer shows a warning glyph INSTEAD of a number — a 0
 * there would be a confident lie about nothing waiting.
 */
import { forwardRef } from 'react';
import { AlertTriangle } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { Lamp } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { triageTone } from '@/features/fleet/monitor/grid/prototype/entry-e/tone';

import type { ChipCount, HubChip } from '../model/decisionModel';
import { CHIP_ICON, chipLabel } from './chipMeta';

interface StripChipProps {
  chip: HubChip;
  count: ChipCount;
  active: boolean;
  onPress: (chip: HubChip, anchor: HTMLElement) => void;
}

export const StripChip = forwardRef<HTMLButtonElement, StripChipProps>(function StripChip(
  { chip, count, active, onPress },
  ref,
) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const label = chipLabel(m, chip);
  const Icon = CHIP_ICON[chip];
  const lit = !count.failed && count.n > 0;
  // Dark glass at zero: the tally's own `off` tone, so "nothing" reads the
  // same on both halves of the band.
  const tone = count.failed ? 'warn' : lit ? triageTone(count.lamp) : 'off';
  const tip = count.failed
    ? tx(m.dc_hub_chip_failed, { label })
    : tx(m.dc_hub_chip_tip, { label, count: count.n });

  return (
    <Tooltip content={tip}>
      <Button
        ref={ref}
        variant="ghost"
        size="sm"
        onClick={(e) => onPress(chip, e.currentTarget)}
        aria-expanded={active}
        aria-haspopup="dialog"
        aria-label={tip}
        data-testid={`decision-chip-${chip}`}
        data-count={count.failed ? 'failed' : count.n}
        data-zero={!count.failed && count.n === 0 ? '' : undefined}
        className={`ae-win ae-focus rounded-input px-1.5 py-1 [&>span]:inline-flex [&>span]:items-center [&>span]:gap-1 ae-t-${tone} ${
          lit ? 'is-lit' : ''} ${active ? 'is-selected' : ''}`}
      >
        <Lamp lamp={{ tone, lit }} />
        <Icon className="h-3.5 w-3.5 flex-shrink-0 text-foreground" aria-hidden />
        <span className="hidden typo-caption text-foreground @[72rem]:inline">{label}</span>
        {count.failed ? (
          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 text-status-warning" aria-hidden data-testid={`decision-chip-${chip}-failed`} />
        ) : (
          <span className="typo-data tabular-nums text-foreground">{count.n}</span>
        )}
      </Button>
    </Tooltip>
  );
});
