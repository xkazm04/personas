import type { PriorityStyle } from '../libs/messageHelpers';

interface PriorityChipProps {
  priority: PriorityStyle;
  /** `md` for the flat list + thread header rows, `sm` for nested thread replies. */
  size?: 'sm' | 'md';
}

/**
 * Priority badge for the Messages list. Renders one of three visually-distinct
 * tiers driven by `priorityConfig`: High (solid red alert), Normal (quiet solid
 * neutral), Low (recessive dashed ghost with a down-chevron). The chevron + dashed
 * border make Low scannable by shape so the priority column reads as a real
 * hierarchy rather than three near-identical neutral chips.
 */
export function PriorityChip({ priority, size = 'md' }: PriorityChipProps) {
  const Icon = priority.icon;
  const sizing = size === 'sm'
    ? 'px-1.5 py-0.5 rounded typo-caption'
    : 'px-2 py-0.5 rounded-card typo-heading';
  return (
    <span
      className={`inline-flex items-center gap-0.5 border ${sizing} ${priority.bgColor} ${priority.color} ${priority.borderColor} ${priority.chipClass ?? ''}`}
    >
      {Icon && <Icon className="w-3 h-3 -ml-0.5" aria-hidden="true" />}
      {priority.label}
    </span>
  );
}
