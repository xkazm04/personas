// What the map is FOR: the four lists a person can act on.
//
// The plots above show where features are; these say where they are not. The
// last one is deliberately a labelled absence rather than a list: the board
// carries no shared-service findings yet, and inventing one would be the exact
// conflation the rest of this page is built to prevent.
import { Button } from '@/features/shared/components/buttons';

import type { ContextCell, TFeatures } from '../featuresModel';
import type { BoardGroup } from '@/lib/bindings/BoardGroup';

export interface ActionListsProps {
  unclaimed: ContextCell[];
  untouched: BoardGroup[];
  loadBearing: ContextCell[];
  groupNameById: Map<string, string>;
  onOpenContext: (contextId: string) => void;
  t: TFeatures;
  tx: (template: string, vars: Record<string, string | number>) => string;
}

function Panel({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-secondary/30 p-3">
      <h3 className="typo-body-lg text-foreground">{title}</h3>
      <p className="mt-0.5 typo-caption">{subtitle}</p>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function ActionLists({
  unclaimed,
  untouched,
  loadBearing,
  groupNameById,
  onOpenContext,
  t,
  tx,
}: ActionListsProps) {
  // Unclaimed reads by GROUP: forty loose names is a wall, forty names under
  // eight headings is a to-do list.
  const byGroup = new Map<string, ContextCell[]>();
  for (const cell of unclaimed) {
    const key = cell.context.groupId ?? '';
    const bucket = byGroup.get(key);
    if (bucket) bucket.push(cell);
    else byGroup.set(key, [cell]);
  }

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
      <Panel title={t.list_unclaimed_title} subtitle={t.list_unclaimed_subtitle}>
        {unclaimed.length === 0 ? (
          <p className="typo-caption">{t.envelope_none}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...byGroup.entries()].map(([groupId, cells]) => (
              <li key={groupId}>
                <p className="typo-caption text-foreground">{groupNameById.get(groupId) ?? groupId}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {cells.map((cell) => (
                    <button
                      key={cell.context.id}
                      type="button"
                      data-testid="features-unclaimed-context"
                      onClick={() => onOpenContext(cell.context.id)}
                      className="rounded-pill border border-border px-2 py-0.5 typo-caption text-foreground hover:border-primary/60 hover:text-primary focus-ring"
                    >
                      {cell.context.name}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t.list_untouched_title} subtitle={t.list_untouched_subtitle}>
        {untouched.length === 0 ? (
          <p className="typo-caption">{t.envelope_none}</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {untouched.map((g) => (
              <li
                key={g.id}
                className="rounded-pill border border-dashed border-status-warning/60 px-2 py-0.5 typo-caption text-status-warning"
              >
                {g.name}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t.list_loadbearing_title} subtitle={t.list_loadbearing_subtitle}>
        {loadBearing.length === 0 ? (
          <p className="typo-caption">{t.envelope_none}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {loadBearing.map((cell) => (
              <li key={cell.context.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate typo-body text-foreground">{cell.context.name}</span>
                <span className="flex-none typo-data text-violet-400">
                  {tx(t.list_feature_count, { count: cell.claimants.length })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t.list_shared_title} subtitle={t.list_shared_none}>
        <Button variant="secondary" size="sm" disabled>
          {t.open_in_context_map}
        </Button>
      </Panel>
    </div>
  );
}
