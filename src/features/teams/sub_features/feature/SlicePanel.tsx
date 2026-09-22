// The slice: which contexts this feature claims, under the groups they live in.
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

import { roleLabel, type ContextCell, type TFeatures } from '../featuresModel';

export interface SlicePanelProps {
  cells: ContextCell[];
  primaryContextId: string | null;
  groupNameById: Map<string, string>;
  onOpenContext: (contextId: string) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

export function SlicePanel({
  cells,
  primaryContextId,
  groupNameById,
  onOpenContext,
  t,
  tx,
}: SlicePanelProps) {
  const byGroup = new Map<string, ContextCell[]>();
  for (const cell of cells) {
    const key = cell.context.groupId ?? '';
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(cell);
    else byGroup.set(key, [cell]);
  }

  return (
    <section className="rounded-card border border-border p-4" data-testid="features-slice">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="typo-body-lg text-foreground">{t.slice_title}</h3>
          <p className="mt-0.5 typo-caption">
            {tx(t.slice_subtitle, { contexts: cells.length, groups: byGroup.size })}
          </p>
        </div>
        {cells[0] ? (
          <Button variant="secondary" size="sm" onClick={() => onOpenContext(cells[0]!.context.id)}>
            {t.open_in_context_map}
          </Button>
        ) : null}
      </div>
      <ul className="mt-3 flex flex-col gap-2">
        {[...byGroup.entries()].map(([groupId, group]) => (
          <li key={groupId}>
            <p className="typo-caption text-foreground">{groupNameById.get(groupId) ?? groupId}</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {group.map((cell) => {
                const primary = cell.context.id === primaryContextId;
                return (
                  <Tooltip key={cell.context.id} content={roleLabel(cell.role, t)}>
                    <button
                      type="button"
                      onClick={() => onOpenContext(cell.context.id)}
                      className={`rounded-pill border px-2 py-0.5 typo-caption focus-ring ${
                        primary
                          ? 'border-primary/60 bg-primary/10 text-primary'
                          : 'border-border text-foreground hover:border-primary/50'
                      }`}
                    >
                      {cell.context.name}
                      {primary ? <span className="ml-1 opacity-70">{t.slice_primary}</span> : null}
                    </button>
                  </Tooltip>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
