import type { ReactNode } from 'react';

interface ActionRowProps {
  /** Left-aligned content (filters, status chips, project picker, etc.). */
  left?: ReactNode;
  /** Right-aligned action buttons. */
  children: ReactNode;
  /** When true, the row uses a thinner vertical rhythm. */
  compact?: boolean;
}

/**
 * Thin horizontal action strip rendered above the main content of a page.
 * Replaces the legacy pattern of cramming buttons into ContentHeader.actions —
 * keeps the page header readable and the actions discoverable in a consistent
 * place across modules.
 */
export function ActionRow({ left, children, compact = false }: ActionRowProps) {
  return (
    <div
      className={[
        'flex items-center justify-between gap-3 flex-wrap',
        compact ? 'mb-3' : 'mb-4',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 flex-wrap min-w-0">{left}</div>
      <div className="flex items-center gap-2 flex-wrap shrink-0">{children}</div>
    </div>
  );
}
