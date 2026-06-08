/**
 * GoalStatusBadge — the one place a goal status renders as a pill. Pulls colour
 * + label from the canonical `goalStatus` model so every surface (Board, Drawer,
 * Timeline) stays consistent and a status change is a one-file edit.
 */
import { useTranslation } from '@/i18n/useTranslation';
import { goalStatusMeta, goalStatusLabel } from './goalStatus';

interface Props {
  status: string;
  /** `xs` for dense rows/cards, `sm` for headers. */
  size?: 'xs' | 'sm';
  className?: string;
}

export function GoalStatusBadge({ status, size = 'xs', className = '' }: Props) {
  const { t } = useTranslation();
  const meta = goalStatusMeta(status);
  const text = size === 'xs' ? 'text-[10px]' : 'typo-caption';
  return (
    <span
      className={`${text} font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap ${meta.chipClass} ${className}`}
    >
      {goalStatusLabel(t.plugins.dev_lifecycle, status)}
    </span>
  );
}
