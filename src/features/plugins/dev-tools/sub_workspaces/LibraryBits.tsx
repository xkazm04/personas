// Shared presentational bits for the knowledge-library variants (Ledger /
// Tree / Inbox): the one-line item row, status filter chips, and the monthly
// influx bars. One place to refine — every variant renders items identically.
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import type { KnowledgeStatus } from '@/api/devTools/workspaces';
import type { DevProject } from '@/lib/bindings/DevProject';

import { KnowledgeStatusChip } from './centerShared';
import type { KnowledgeItemView } from './libraryModel';

/** Fixed row height for the virtualizers — dense, one line per item. */
export const ITEM_ROW_SIZE = 40;

export function ItemRow({
  item,
  projectById,
  actions,
}: {
  item: KnowledgeItemView;
  projectById: Map<string, DevProject>;
  actions?: React.ReactNode;
}) {
  const origin = item.originProjectId
    ? projectById.get(item.originProjectId)?.name ?? '(removed)'
    : null;
  return (
    <div className="h-full flex items-center gap-2.5 px-3 border-b border-primary/5 hover:bg-secondary/30 transition-colors min-w-0">
      <KnowledgeStatusChip status={item.status} />
      <span className="typo-label text-muted-foreground w-14 shrink-0">{item.kind}</span>
      <span className="typo-body text-foreground truncate min-w-0 flex-1">
        {item.title}
        {item.mock && (
          <span className="typo-label text-muted-foreground ml-1.5 opacity-60">demo</span>
        )}
      </span>
      {item.topic && (
        <span className="typo-caption text-muted-foreground truncate max-w-40 shrink-0 hidden xl:inline">
          {item.topic}
        </span>
      )}
      {origin && (
        <span className="typo-caption text-foreground truncate max-w-32 shrink-0">{origin}</span>
      )}
      <RelativeTime timestamp={item.updatedAt} className="typo-caption text-muted-foreground w-16 text-right shrink-0" />
      {actions}
    </div>
  );
}

const STATUS_ORDER: KnowledgeStatus[] = ['proposed', 'observed', 'adopted', 'rejected', 'deprecated'];

export function StatusFilterChips({
  counts,
  active,
  onToggle,
}: {
  counts: Partial<Record<KnowledgeStatus, number>>;
  active: Set<KnowledgeStatus>;
  onToggle: (s: KnowledgeStatus) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {STATUS_ORDER.map((s) => {
        const on = active.has(s);
        return (
          <button
            key={s}
            type="button"
            onClick={() => onToggle(s)}
            className={`typo-label rounded-interactive border px-2 py-1 transition-colors ${
              on
                ? 'border-primary/40 bg-primary/10 text-foreground'
                : 'border-primary/10 text-foreground/70 hover:bg-secondary/40'
            }`}
          >
            {s} · {counts[s] ?? 0}
          </button>
        );
      })}
    </div>
  );
}

/** Monthly harvest volume — a compact bar strip proving the growth curve. */
export function InfluxBars({
  influx,
}: {
  influx: { key: string; label: string; count: number }[];
}) {
  if (influx.length === 0) return null;
  const max = Math.max(...influx.map((m) => m.count), 1);
  return (
    <div className="flex items-end gap-2">
      {[...influx].reverse().map((m) => (
        <div key={m.key} className="flex flex-col items-center gap-1">
          <span className="typo-caption text-foreground">{m.count}</span>
          <div
            className="w-7 rounded-sm bg-primary/30"
            style={{ height: `${Math.max(6, (m.count / max) * 44)}px` }}
          />
          <span className="typo-label text-muted-foreground">{m.label.slice(0, 3)}</span>
        </div>
      ))}
    </div>
  );
}
