/**
 * Dossier (WP9): a count drawn against the slots its consumer actually reads
 * (five exemplars, eight constraints: what the prompt compiler renders), as
 * kit unit pips, filled to the count, with the figure beside it. A count past
 * the slots fills them all; the figure carries the rest.
 */
import { UnitStrip, type Tone, type UnitSize } from '@/features/shared/components/kit';

import { Figure } from './Figure';

interface PipMeterProps {
  value: number;
  /** The declared number of slots. */
  slots: number;
  label: string;
  tone?: Tone;
  size?: UnitSize;
  spring?: boolean;
  reduced: boolean;
  /** Hide the figure (a matrix cell that states it elsewhere). */
  bare?: boolean;
}

export function PipMeter({ value, slots, label, tone = 'primary', size = 's', spring, reduced, bare }: PipMeterProps) {
  const filled = Math.min(value, slots);
  return (
    <span className="dossier-pips">
      <UnitStrip
        size={size}
        label={label}
        segments={[
          { n: filled, tone },
          { n: slots - filled, glyph: 'empty' },
        ]}
      />
      {!bare && <Figure value={value} spring={spring} reduced={reduced} className="typo-data dossier-pips__figure" />}
    </span>
  );
}
