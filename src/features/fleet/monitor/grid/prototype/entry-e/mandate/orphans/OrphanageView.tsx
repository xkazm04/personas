// The Orphanage (mandate-lanes WP6), a view of the mandate drawer opened from
// the Orphans lane button (O): one row per project whose pending work no
// mandate holds, with why it asks for a mandate (measured against the
// fleet's flow, never a clock). ↑/↓ pick a project; its detail offers draft
// (D), adopt into an existing mandate (A) and archive (X, armed twice).

import { useMemo, useState } from 'react';
import { ListRow, Rows, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { OVERLAY_DISMISS_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Engraved, Lamp } from '../../parts';
import { Figure, LampWord, ProjectName } from '../rowParts';
import { useDrawerListKeys } from '../useDrawerKeys';
import { OrphanDetail } from './OrphanDetail';
import { kindsLine, whyLine } from './orphanModel';
import { useOrphanage } from './useOrphanage';

export function OrphanageView({ mandates }: { mandates: readonly MandateSummary[] | null }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const o = useOrphanage();
  const [selected, setSelected] = useState(0);
  const clusters = useMemo(() => o.data?.clusters ?? [], [o.data]);
  const c = clusters[Math.min(selected, clusters.length - 1)] ?? null;
  const needsPick = !!c && !c.steward;

  useDrawerListKeys({
    count: clusters.length,
    selected,
    onSelect: (i) => { o.cancel(); setSelected(i); },
    onEnter: c && o.mode ? () => {
      if (o.mode === 'adopt') void o.adopt(c.projectId);
      else if (o.mode === 'draft') void o.draft(c.projectId, null, needsPick);
      else void o.archive(c.projectId);
    } : undefined,
    letters: {
      d: () => { if (c) void o.draft(c.projectId, c.steward?.personaId ?? null, needsPick); },
      a: () => { if (c) void o.adopt(c.projectId); },
      x: () => { if (c) void o.archive(c.projectId); },
    },
  });
  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || !o.mode) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    o.cancel();
    return true;
  }, { priority: OVERLAY_DISMISS_PRIORITY + 2, enabled: !!o.mode });

  const columns: RowColumn[] = useMemo(() => [
    { head: m.ml_orphans_fact_items, width: '13rem', collapse: true },
    { width: '3.5rem', align: 'end' },
    { head: m.ml_fact_status, width: '10rem' },
  ], [m]);
  const asking = clusters.some((x) => x.why);
  const total = clusters.reduce((n, x) => n + x.items, 0);
  const head = o.data
    ? tx(m.ml_orphans_head, { count: total, projects: clusters.length })
    : null;
  return (
    <div className="flex min-h-0 flex-1 gap-4" data-testid="orphanage">
      <section className="ae-plate flex min-h-0 min-w-0 flex-1 flex-col gap-2 self-start rounded-card px-1 pb-2 pt-3" aria-label={m.ml_orphanage}>
        <header className="flex flex-col gap-1 px-3">
          <span className="flex items-center gap-2">
            <Lamp lamp={{ tone: 'warn', lit: asking }} />
            <Engraved>{m.ml_orphanage}</Engraved>
            <span className="typo-data tabular-nums text-foreground">{o.data ? total : null}</span>
          </span>
          <p className="typo-body text-foreground">{head ?? m.ml_loading}</p>
          <p className="typo-caption">{o.data && o.data.unassigned > 0 ? tx(m.ml_orphans_unassigned, { count: o.data.unassigned }) : m.ml_orphans_lead}</p>
          <p className="typo-caption text-status-error empty:hidden" role="status">
            {o.failed ? m.ml_orphans_failed : o.data && o.data.failedSources.length > 0 ? tx(m.ml_orphans_partial, { sources: o.data.failedSources.join(', ') }) : null}
          </p>
        </header>
        <div className="min-h-0 overflow-y-auto">
          <Rows
            loading={o.data === null && !o.failed}
            count={clusters.length}
            label={m.ml_orphanage}
            columns={columns}
            nameHead={m.ml_col_project}
            empty={{ title: m.ml_orphans_empty, testId: 'orphanage-empty' }}
          >
            {clusters.map((x, i) => (
              <ListRow
                key={x.projectId}
                testId="orphan-row"
                size="l"
                nameClass="typo-heading text-foreground"
                name={<ProjectName projectId={x.projectId}>{x.projectName ?? m.ml_project_unknown}</ProjectName>}
                meta={<span className="truncate pl-3.5">{whyLine(x, o.data?.perCard ?? 1, m, tx)}</span>}
                cells={[
                  <span key="k" className="typo-caption">{kindsLine(x, m, tx)}</span>,
                  <Figure key="n" n={x.items} warn={!!x.why} none={m.ml_unknown} />,
                  <LampWord key="w" lamp={{ tone: 'warn', lit: !!x.why }} word={x.why ? m.ml_orphans_asks : m.ml_orphans_quiet} />,
                ]}
                state={i === selected ? 'selected' : undefined}
                onPress={() => { o.cancel(); setSelected(i); }}
              />
            ))}
          </Rows>
        </div>
      </section>
      {c && <OrphanDetail cluster={c} perCard={o.data?.perCard ?? 1} state={o} mandates={mandates} />}
    </div>
  );
}
