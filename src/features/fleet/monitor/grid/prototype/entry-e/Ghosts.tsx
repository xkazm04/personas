// Cold states. A panel that has not read its fleet yet shows the panel at rest:
// plates and dark lines in the geometry the data will land in, never a spinner
// and never a shimmer. An empty panel says so in one worded line, and when a
// filter emptied it, offers the one click that undoes the filter.

import type { LucideIcon } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';

const BAY_SHAPES = [4, 2, 3, 1, 2, 3, 1, 2];

export function BayGhosts() {
  return (
    <div className="min-h-0 flex-1 overflow-hidden p-3" aria-hidden data-testid="entry-e-ghost">
      <div className="ae-bays">
        {BAY_SHAPES.map((n, i) => (
          <div key={i} className="ae-plate flex flex-col gap-1 rounded-card p-2">
            <span className="ae-ghost h-6 rounded-input" />
            {Array.from({ length: n }, (_, j) => <span key={j} className="ae-ghost h-7 rounded-input" />)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SocketGhosts({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }} aria-hidden>
      {Array.from({ length: count }, (_, i) => <span key={i} className="ae-ghost h-[64px] rounded-card" />)}
    </div>
  );
}

export function PanelEmpty({
  icon: Icon, heading, sub, actionLabel, onAction,
}: { icon: LucideIcon; heading: string; sub?: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center" data-testid="entry-e-empty">
      <span className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-secondary/20">
        <Icon className="h-5 w-5 text-foreground" aria-hidden />
      </span>
      <p className="typo-body text-foreground">{heading}</p>
      {sub && <p className="max-w-sm typo-caption">{sub}</p>}
      {actionLabel && onAction && (
        <Button variant="secondary" size="sm" onClick={onAction} data-testid="entry-e-empty-action">{actionLabel}</Button>
      )}
    </div>
  );
}
