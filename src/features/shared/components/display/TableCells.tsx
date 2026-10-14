/**
 * Cell furniture for `UnifiedTable`: the tag and the row-action cluster the
 * incidents ledger drew best, lifted so every table gets the same ones.
 *
 * @catalog TableTag / TableActions / TableAction: a bordered caption chip for a status or count in a table cell, and the right-aligned icon-button cluster for row actions (click never opens the row). Use them in `UnifiedTable` columns instead of hand-rolled chips and icon buttons.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * A tag. `className` carries the tone (`bg-* text-* border-*`), so a caller
 * with its own palette (severity, status) passes that; with none it reads as a
 * neutral secondary chip.
 */
export function TableTag({ icon, className, children }: { icon?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 truncate rounded-card border px-1.5 py-0.5 typo-caption tabular-nums ${
        className ?? 'border-primary/15 bg-secondary/30 text-foreground'
      }`}
    >
      {icon}
      {children}
    </span>
  );
}

/** The action cluster of a row. Clicks stop here, so an action never opens the row. */
export function TableActions({ children }: { children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
      {children}
    </span>
  );
}

/** One icon action. The label is both the tooltip and the accessible name. */
export function TableAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <Button variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={label}>
        <Icon className="h-3.5 w-3.5" />
      </Button>
    </Tooltip>
  );
}
