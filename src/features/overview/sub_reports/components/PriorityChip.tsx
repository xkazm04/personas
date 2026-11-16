import type { PriorityStyle } from '../libs/reportHelpers';

interface PriorityChipProps {
  priority: PriorityStyle;
  /** `md` for the flat list + thread header rows, `sm` for nested thread replies. */
  size?: 'sm' | 'md';
  /** Translated tier name; falls back to the config's English label. */
  label?: string;
}

/**
 * Priority badge for the Messages list. Renders one of three visually-distinct
 * tiers driven by `priorityConfig`: High (solid red alert), Normal (quiet solid
 * neutral), Low (recessive dashed ghost with a down-chevron). The chevron + dashed
 * border make Low scannable by shape so the priority column reads as a real
 * hierarchy rather than three near-identical neutral chips.
 */
export function PriorityChip({ priority, size = 'md', label }: PriorityChipProps) {
  const Icon = priority.icon;
  // Priority is a signal word, not a pill: mono eyebrow in the tier's signal ink, glyph for shape.
  const sizing = size === 'sm' ? 'gap-0.5' : 'gap-1';
  return (
    <span className={`inline-flex items-center typo-eyebrow ${sizing} ${priority.color}`}>
      {Icon && <Icon className="w-3 h-3" aria-hidden="true" />}
      {label ?? priority.label ?? ''}
    </span>
  );
}
