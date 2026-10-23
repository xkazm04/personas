// A · Plan (PORTED from bp src/components/rail/wide/plan.tsx): the list is the features in trouble (or every feature)
// grouped by wing and room; the detail reads the selected feature (stage, each lens's health and why, the work waiting
// on it) or, with the overview row selected, the legend, trouble by lens, the title block and the keys.
// EDIT (port): bp's room schedule (the list narrowing to the room the camera is in) and its lens-key marking are not
// brought: a lens here is a sheet, so "trouble by lens" opens that lens's sheet. bp's agents on a feature have no data.
import { useMemo, useState } from 'react';
import { useSheet } from '../../../controller/SheetContext';
import { stageWord } from '../../../controller/useBlueprintText';
import { figures, waitingOf } from '../../../model/counts';
import { placeLine } from '../../format';
import type { Feature } from '../../../standard/load';
import { StageSwatch } from '../../legend/Specimens';
import { sheetNumber } from '../../header/ProjLine';
import { Press } from '../../Press';
import { PlanFeature } from './PlanFeature';
import { PlanOverview } from './PlanOverview';
import { Group, Row, Workbench, useListRef, useWalk } from './shell';

const rank = (f: Feature) => (f.trouble[0]?.h === 'bad' ? 0 : 1);

export function PlanPanel() {
  const s = useSheet();
  const { B, tx } = s.text;
  const [mode, setMode] = useState<'trouble' | 'all'>('trouble');
  const [sel, setSel] = useState<string | null>(null);
  const listRef = useListRef();
  const lens = s.ui.lens === 'general' ? null : s.ui.lens;
  const L = lens ? s.plan.LENS[lens] ?? null : null;
  const groups = useMemo(() => {
    const out: { id: string; head: string; fs: Feature[] }[] = [];
    for (const w of s.plan.L.wings) for (const r of w.rooms) {
      const fs = mode === 'all' ? r.feats : r.feats.filter((f) => (lens ? f.trouble.some((t) => t.lens === lens) : f.trouble.length));
      if (fs.length) out.push({ id: r.id, head: placeLine(w.def.name, r.d.name), fs: mode === 'all' ? fs : fs.slice().sort((a, b) => rank(a) - rank(b)) });
    }
    return out;
  }, [s.plan, mode, lens]);
  const ids = useMemo(() => [null as string | null, ...groups.flatMap((g) => g.fs.map((f) => f.id))], [groups]);
  const cur = sel && ids.includes(sel) ? sel : null;
  const onKey = useWalk(ids, cur, setSel, listRef);
  const n = ids.length - 1, sheet = sheetNumber(L ? L.short : null);
  // the header's own figures (counts.ts): bad is "in trouble", watch is its own figure, never folded in
  const fg = useMemo(() => figures(s.plan.S.features, lens), [s.plan, lens]);

  const list = (
    <>
      <ul role="listbox" aria-label={B.fly_overview} className="wb-solo">
        <Row id={null} on={cur === null} onPick={() => setSel(null)} cls="ov">
          <span className="rt">{B.plan_ov}</span>
          <span className="rm"><span>{tx(B.plan_ov_sub, { sheet })}</span></span>
        </Row>
      </ul>
      {groups.length ? groups.map((g) => (
        <Group key={g.id} head={g.head} n={g.fs.length} label={g.head}>
          {g.fs.map((f) => {
            const waiting = waitingOf(s.work.byFeature.get(f.id) ?? []);
            return (
              <Row key={f.id} id={f.id} on={cur === f.id} onPick={() => setSel(f.id)} cls={'ft h-' + f.health}>
                <span className="sy"><StageSwatch st={f.stage} w={22} h={14} /></span>
                <span className="rt one">{f.name}</span>
                <span className="rm"><span>{f.stage ? stageWord(B, f.stage) : B.not_drawn}{waiting ? ' · ' + tx(B.count_waiting, { count: waiting }) : ''}</span>
                  {f.trouble.length ? <span className="tr">{f.trouble.slice(0, 3).map((t) => <b key={t.lens} className={t.h}>{s.plan.LENS[t.lens]?.short ?? t.lens}</b>)}</span> : null}</span>
              </Row>
            );
          })}
        </Group>
      )) : <div className="wb-empty"><b>{B.plan_none}</b>{L ? tx(B.plan_none_lens, { lens: L.name }) : B.plan_none_any}</div>}
    </>
  );
  const strip = (
    <>
      <div className="wb-count"><b>{sheet}</b><span>{L ? L.name : B.general_arrangement}</span></div>
      {mode === 'all'
        ? <div className="wb-count"><b>{n}</b><span>{B.plan_s_features}</span></div>
        : (
          <>
            <div className="wb-count"><b>{fg.bad}</b><span>{L ? tx(B.plan_s_trouble_lens, { lens: L.name }) : B.plan_s_trouble}</span></div>
            <div className="wb-count"><b>{fg.watch}</b><span>{B.plan_s_watch}</span></div>
          </>
        )}
      <div className="wb-filter" role="group" aria-label={B.plan_list}>
        <Press on={mode === 'trouble'} onClick={() => setMode('trouble')}>{B.plan_bad_watch}</Press>
        <Press on={mode === 'all'} onClick={() => setMode('all')}>{B.plan_all}</Press>
      </div>
    </>
  );
  const f = cur ? s.plan.L.TILE[cur]?.f : undefined;
  return (
    <Workbench cls="wb-plan" strip={strip} list={list} listLabel={B.plan_list} listRef={listRef} onKey={onKey}
      detailKey={cur ?? 'legend'} detailLabel={cur ? B.plan_detail_feature : B.plan_ov}
      detail={<div className="wb-scroll">{f ? <PlanFeature f={f} /> : <PlanOverview />}</div>} />
  );
}
