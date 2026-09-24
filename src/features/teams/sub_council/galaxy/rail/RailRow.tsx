// One row of the docked list: rank, name, count, council pip.
//
// The rank is the same number the canvas prints, which is what makes the list
// and the field one surface instead of two.
import { memo } from 'react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';

import type { CouncilMark } from '../engine/types';
import type { RailRow as RailRowModel } from '../useGalaxyRows';

const PIP: Record<CouncilMark, string> = {
  approved: 'bg-status-success',
  rejected: 'bg-status-error',
  pending: 'bg-status-pending',
  none: 'border border-muted-dark',
};

interface Props {
  row: RailRowModel;
  selected: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
}

function RailRowImpl({ row, selected, onSelect, onHover }: Props) {
  const { t } = useTranslation();
  const g = t.council.galaxy;
  const countLabel =
    row.countKind === 'techniques' ? g.count_techniques : row.countKind === 'laws' ? g.count_laws : g.count_children;

  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={`grid w-full grid-cols-[26px_1fr_auto] items-center gap-2 rounded-interactive px-2 py-1.5 text-left typo-body ${
        selected
          ? 'bg-secondary text-foreground shadow-[inset_2px_0_0_var(--accent)]'
          : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
      }`}
      data-testid={`council-rail-row-${row.key}`}
    >
      <span className="text-right typo-caption text-muted-dark">{row.rank}</span>
      <span className="truncate">{row.name}</span>
      <span className="flex items-center gap-2">
        <span className="typo-caption text-muted-dark">
          <Numeric value={row.count} title={countLabel} />
        </span>
        {row.marks.map((mark, i) => (
          <span key={`${mark}-${i}`} className={`inline-block h-[7px] w-[7px] rounded-full ${PIP[mark]}`} />
        ))}
      </span>
    </button>
  );
}

export const RailRow = memo(RailRowImpl);
