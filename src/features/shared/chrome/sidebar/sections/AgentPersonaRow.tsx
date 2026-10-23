import type { ReactNode } from 'react';
import { Star } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';

/**
 * One persona row of the Agents nav: a select button and, for favourable rows,
 * a SIBLING star button. They used to be one button holding a `role="button"`
 * span, which is nested interactive content (axe `nested-interactive`): a
 * screen reader flattened the star into the row label and Tab order was
 * browser-dependent. The wrapper carries the row chrome; the buttons stay flat.
 */
export function AgentPersonaRow({
  name, nameClassName = '', rowClassName, selectProps, onSelect, isActive, title, trailing, star, statusDot,
}: {
  name: string;
  /** Extra classes for the name only (the running tint). */
  nameClassName?: string;
  /** `childRowClass(...)` plus any run tint: the look of the whole row. */
  rowClassName: string;
  /** Extra props for the select button (intent prefetch handlers). */
  selectProps?: Record<string, unknown>;
  onSelect: () => void;
  isActive: boolean;
  title?: string;
  trailing?: ReactNode;
  /** Omit for rows that cannot be favourited. */
  star?: { isFavorite: boolean; label: string; onToggle: () => void };
  statusDot: ReactNode;
}) {
  return (
    <div className={`${rowClassName} group`}>
      <button
        type="button"
        {...selectProps}
        onClick={onSelect}
        aria-current={isActive ? 'page' : undefined}
        title={title}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span className={`truncate min-w-0 flex-1 ${nameClassName}`}>{name}</span>
        {trailing}
      </button>
      {star && (
        <Button
          variant="ghost"
          size="xs"
          onClick={star.onToggle}
          className="flex-shrink-0 !px-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-amber-500/10"
          title={star.label}
          aria-label={star.label}
        >
          <Star className={`w-3 h-3 ${star.isFavorite ? 'text-status-warning fill-status-warning' : 'text-foreground/90'}`} aria-hidden="true" />
        </Button>
      )}
      {statusDot}
    </div>
  );
}
