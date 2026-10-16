// A · Agents (PORTED from bp src/components/rail/wide/agents.tsx): the list holds an overview row, the store's
// lens-scan runs (newest first) and the runs this sheet started (the dock console's `start` lines, by their
// `personas:<uuid>` label). The detail reads the selection in full: a run's progress, clock and activity log; a start's
// command line and items; or the overview, the store's latest lines.
// EDIT (port): bp's crews, swarm states (waiting, blocked, paused), steering and job Cancel are not brought: the store
// keeps no swarm and Personas has no cancel door for a run. bp's queued state does not exist in the store either.
import { useEffect, useMemo, useState } from 'react';
import { useSheet } from '../../../controller/SheetContext';
import { LensGlyphIcon } from '../../LensGlyphIcon';
import { newestFirst, runFacts, scopeOf, startLines } from './agentsModel';
import { Overview, RunDetail, StartDetail, useRunWords } from './AgentsDetail';
import { Group, Row, Workbench, mmss, useListRef, useWalk } from './shell';

const key = (k: 'run' | 'start', id: string) => k + ':' + id;

export function AgentsPanel() {
  const s = useSheet();
  const { B, tx } = s.text;
  const W = useRunWords();
  const scan = s.data.scan;
  const runs = useMemo(() => newestFirst(scan.runs), [scan.runs]);
  const starts = useMemo(() => startLines(s.ui.lines), [s.ui.lines]);
  const [sel, setSel] = useState<string | null>(null);
  const listRef = useListRef();
  const running = runs.some((r) => r.status === 'running');
  // the elapsed clocks: one 1 s interval, only while something runs
  const [, setTick] = useState(0);
  useEffect(() => { if (!running) return; const t = setInterval(() => setTick((n) => n + 1), 1000); return () => clearInterval(t); }, [running]);
  const ids = useMemo(() => [null as string | null, ...runs.map((r) => key('run', r.id)), ...starts.map((l) => key('start', l.result.label))], [runs, starts]);
  const cur = sel && ids.includes(sel) ? sel : null;
  const onKey = useWalk(ids, cur, setSel, listRef);
  const now = Date.now();
  const tally = { running: 0, done: 0, failed: 0 };
  for (const r of runs) { if (r.status === 'running') tally.running++; else if (r.status === 'done') tally.done++; else tally.failed++; }

  const list = (
    <>
      <ul role="listbox" aria-label={B.fly_overview} className="wb-solo">
        <Row id={null} on={cur === null} onPick={() => setSel(null)} cls="ov">
          <span className="rt">{B.fly_overview}</span>
          <span className="rm"><span>{B.agents_ov_sub}</span><span>{tx(B.agents_n_running, { count: tally.running })}</span></span>
        </Row>
      </ul>
      <Group head={B.agents_runs} n={runs.length ? tx(B.agents_runs_n, { running: tally.running, runs: runs.length }) : B.agents_store} label={B.agents_runs_label}>
        {runs.length ? runs.map((r) => {
          const x = runFacts(r, scan, now), k = key('run', r.id), sc = scopeOf(r), d = s.plan.LENS[r.lenses[0] ?? ''];
          return (
            <Row key={r.id} id={k} on={cur === k} onPick={() => setSel(k)} cls={'job st-' + r.status}>
              <span className="rk">{d ? <LensGlyphIcon glyph={d.glyph} /> : null}<span className={'st ' + r.status}>{W.status(r.status)}</span><span>{mmss(x.ms)}</span></span>
              <span className="rt one">{W.phase(r.phase)} {'·'} {W.lenses(r.lenses)}</span>
              <span className="rm"><span>{W.scope(sc)}</span><span>{x.m !== null ? x.n + '/' + x.m : x.n}</span></span>
              {x.m ? <span className="bar" aria-hidden="true"><i style={{ width: (100 * x.n) / x.m + '%' }} /></span> : null}
            </Row>
          );
        }) : <li className="wb-none">{B.agents_no_runs}</li>}
      </Group>
      <Group head={B.agents_started} n={starts.length} label={B.agents_started}>
        {starts.length ? starts.map((l) => {
          const k = key('start', l.result.label), d = s.plan.LENS[l.lens];
          return (
            <Row key={l.key} id={k} on={cur === k} onPick={() => setSel(k)} cls="job">
              <span className="rk">{d ? <LensGlyphIcon glyph={d.glyph} /> : null}<span className="st running">{B.agents_started_word}</span><span>{tx(B.agents_pid, { pid: l.result.pid })}</span></span>
              <span className="rt one">{l.result.label}</span>
              <span className="rm"><span>{d?.name ?? l.lens}</span><span>{tx(B.agents_items, { count: l.ids.length })}</span></span>
            </Row>
          );
        }) : <li className="wb-none">{B.agents_no_started}</li>}
      </Group>
    </>
  );

  const run = cur?.startsWith('run:') ? runs.find((r) => key('run', r.id) === cur) : undefined;
  const start = cur?.startsWith('start:') ? starts.find((l) => key('start', l.result.label) === cur) : undefined;
  const detail = run ? <RunDetail r={run} now={now} /> : start ? <StartDetail l={start} /> : <Overview />;
  return (
    <Workbench cls="wb-agents" list={list} listLabel={B.agents_list} listRef={listRef} onKey={onKey} detailKey={cur ?? 'overview'} detailLabel={B.agents_detail}
      strip={(
        <>
          <div className="wb-count t-mint"><b>{tally.running}</b><span>{B.agents_s_running}</span></div>
          <div className="wb-count"><b>{tally.done}</b><span>{B.agents_s_done}</span></div>
          <div className={'wb-count' + (tally.failed ? ' t-red' : '')}><b>{tally.failed}</b><span>{B.agents_s_failed}</span></div>
          <div className="wb-count"><b>{starts.length}</b><span>{B.agents_s_started}</span></div>
          <span className="wb-src">{B.agents_store}</span>
        </>
      )}
      detail={<div className="wb-scroll">{detail}</div>} />
  );
}
