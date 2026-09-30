// Factory L2 — the consolidated Overview, composed from the kit (Gate 5). The
// R15 content is unchanged: the Focus health of every context (KPI rollups,
// Sentry errors, LLM cost), its coverage (features, goals, proposed KPIs), the
// proposals review (accept / reject) and the four real scans. The form is the
// kit's: a Contexts Section with the scans as its actions (KitButtons with the
// product's spinner) and headline figures (StatStrip, contexts drawn one unit
// each in their state's tone), one level-2
// Section and DataTable per context group, and the selected context's detail
// in the Split pane (the Drawer on a narrow surface), where the proposals the
// hover tooltip used to hold are reviewed.
import { useCallback, useMemo, useRef, useState } from 'react';

import { updateKpi } from '@/api/devTools/kpis';
import type { DevKpi } from '@/lib/bindings/DevKpi';
import { useAppKeyboard, ROUTE_DECISION_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { toastCatch } from '@/lib/silentCatch';
import { Drawer, GhostRows, Section, Split, StatStrip, UnitStrip } from '@/features/shared/components/kit';

import { CrewFoundryPanel } from '../foundry/CrewFoundryPanel';
import { FOCUS_MARK, type FocusKind } from '../factoryTone';
import { useFactoryWords } from '../useFactoryWords';
import type { FactoryL2Data } from './factoryL2Data';
import { FactoryContextDetail } from './FactoryContextDetail';
import { FactoryContextGroup, KindLegend } from './FactoryContextTable';
import { FactoryScanActions } from './FactoryScanActions';
import { groupCells, kindCounts } from './overviewModel';

const ORDER: FocusKind[] = ['crit', 'warn', 'setup', 'ok'];

export function FactoryOverviewTab({ data }: { data: FactoryL2Data }) {
  const w = useFactoryWords();
  const [note, setNote] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);
  const paneRef = useRef<HTMLElement>(null);

  const groups = useMemo(() => groupCells(data, w.ungrouped), [data, w.ungrouped]);
  const all = useMemo(() => groups.flatMap((g) => g.cells), [groups]);
  // The first context is selected on arrival, so the pane is never blank (as Fleet Activity).
  const sel = picked ?? all[0]?.ctx.id ?? null;
  const selected = all.find((c) => c.ctx.id === sel) ?? null;
  const selectedGroup = groups.find((g) => g.cells.some((c) => c.ctx.id === sel))?.name ?? '';

  const select = useCallback((id: string) => {
    setPicked(id);
    // No room for the side pane: the detail opens in the drawer.
    if (paneRef.current && paneRef.current.offsetWidth === 0) setDrawer(true);
  }, []);
  useAppKeyboard((e) => {
    if (e.key !== 'Escape' || !drawer) return false;
    setDrawer(false);
    return true;
  }, { priority: ROUTE_DECISION_PRIORITY });

  const decide = useCallback((k: DevKpi, status: 'active' | 'archived') => {
    void updateKpi(k.id, { status })
      .then(() => {
        setNote(w.L.decided(k.name, status === 'active'));
        data.reloadKpis();
      })
      .catch(toastCatch('factory kpi decide'));
  }, [data, w.L]);

  const n = kindCounts(all);
  const proposedCtx = [...data.proposalsByContext.values()].reduce((s, l) => s + l.length, 0);
  const unassigned = data.unassignedProposals.length;
  const loading = data.loading && all.length === 0;

  const detail = (
    <FactoryContextDetail cell={selected} groupName={selectedGroup} data={data} onDecide={decide} onNote={setNote} w={w} />
  );
  const main = (
    <div data-testid="factory-overview-tab">
      <Section
        id="s-fac-contexts"
        eyebrow={w.overview}
        title={w.contexts}
        meta={<KindLegend cells={all} w={w} />}
        actions={<FactoryScanActions data={data} onNote={setNote} w={w} />}
        state={!data.loading && all.length === 0 ? 'empty' : undefined}
        empty={{ title: w.L.noContexts, hint: w.L.noContextsHint, tone: 'info' }}
      >
        {/* The live region is always mounted, so a new note is announced. */}
        <p className="k-in typo-caption" role="status" style={{ margin: note ? '0 0 10px' : 0 }}>{note}</p>
        <StatStrip
          state={loading ? 'loading' : undefined}
          tiles={[
            {
              label: w.contexts,
              value: all.length,
              draw: <UnitStrip size="m" label={w.contexts} segments={ORDER.map((k) => ({ n: n[k], ...FOCUS_MARK[k] }))} />,
            },
            { label: w.features, value: data.useCaseState.active.length },
            { label: w.goals, value: [...data.goalCountByContext.values()].reduce((s, v) => s + v, 0) },
            {
              label: w.L.proposed,
              value: proposedCtx + unassigned,
              draw: <UnitStrip size="m" label={w.L.proposed} segments={[{ n: proposedCtx, tone: 'agent', glyph: 'soft' }, { n: unassigned, tone: 'agent', glyph: 'hollow' }]} />,
              note: unassigned > 0 ? `${unassigned} ${w.L.unassigned}` : undefined,
            },
          ]}
        />
        <div className="k-in" style={{ margin: '12px 0 8px' }}><CrewFoundryPanel data={data} /></div>
        {loading ? <GhostRows count={4} /> : groups.map((g) => (
          <FactoryContextGroup key={g.id} group={g} data={data} selected={sel} onSelect={select} w={w} />
        ))}
      </Section>
    </div>
  );
  return (
    <>
      <Split paneRef={paneRef} paneLabel={w.context} pane={detail} main={main} />
      <Drawer open={drawer} onClose={() => setDrawer(false)} closeLabel={w.t.common.close} label={w.context}>
        {detail}
      </Drawer>
    </>
  );
}
