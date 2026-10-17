// The Agents workbench's detail pane (PORTED from bp src/components/rail/wide/agents.tsx JobDetail and Overview): a
// run read in full (status, phase, figures, progress, times, its activity as the log), a run this sheet started (its
// label, command line and items), or the overview (the store's latest lines, each flying to its feature).
// EDIT (port): bp's job log tail is the run's activity rows here (the store keeps no log); its Cancel, crew detail and
// steering are not brought (no door, no swarm).
import { useMemo } from 'react';
import type { RunPhase, RunStatus, ScanSnapshot } from '@/lib/lensScan/wire';
import { useSheet } from '../../../controller/SheetContext';
import { LensGlyphIcon } from '../../LensGlyphIcon';
import { Press } from '../../Press';
import type { StartState } from '../../../live/startedModel';
import { runFacts, scopeOf, startElapsed, startWord, type StartLine } from './agentsModel';
import { Fig, Sec, hhmm, mmss } from './shell';

/** The words a run speaks in: its status, its phase, its lenses and its scope. */
export function useRunWords() {
  const s = useSheet();
  const { B, tx } = s.text;
  return useMemo(() => ({
    status: (st: RunStatus) => ({ running: B.run_running, done: B.run_done, failed: B.run_failed, aborted: B.run_aborted })[st],
    phase: (p: RunPhase) => ({ measure: B.phase_measure, propose: B.phase_propose, execute: B.phase_execute, propagate: B.phase_propagate })[p],
    lenses: (ids: readonly string[]) => ids.map((id) => s.plan.LENS[id]?.name ?? id).join(', ') || B.agents_no_lens,
    scope: (sc: ReturnType<typeof scopeOf>) => !sc ? B.agents_scope_all : 'group' in sc ? sc.group
      : 'proposals' in sc ? tx(B.agents_scope_findings, { count: sc.proposals }) : tx(B.agents_scope_features, { count: sc.features }),
  }), [B, tx, s.plan]);
}

/** The store's activity lines as bp's feed: time, where, what; a line on a feature on the plan flies there. */
function Feed({ rows }: { rows: ScanSnapshot['activity'] }) {
  const s = useSheet();
  const { B } = s.text;
  return (
    <ul className="wb-feed" aria-label={B.agents_feed}>
      {rows.map((a) => {
        const f = a.feature ? s.plan.L.TILE[a.feature]?.f : undefined, where = [f?.name ?? a.feature, a.lens ? s.plan.LENS[a.lens]?.name ?? a.lens : ''].filter(Boolean).join(' · ');
        return (
          <li key={a.id}>
            <Press tone={'k-' + a.kind} onClick={() => { if (f) s.nav.flyToFeature(f.id); }} disabled={!f}>
              <time dateTime={a.at}>{hhmm(a.at)}</time><span>{where && <small>{where}</small>}{a.text}</span>
            </Press>
          </li>
        );
      })}
    </ul>
  );
}

export function RunDetail({ r, now }: { r: ScanSnapshot['runs'][number]; now: number }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const W = useRunWords();
  const x = runFacts(r, s.data.scan, now), d = s.plan.LENS[r.lenses[0] ?? ''];
  const pct = x.m ? Math.round((100 * x.n) / x.m) : null;
  const nLabel = r.phase === 'execute' ? B.agents_f_built : r.phase === 'propose' ? B.agents_f_filed : B.agents_f_measured;
  return (
    <>
      <div className="wb-kick"><span className={'st ' + r.status}>{W.status(r.status)}</span><span>{W.phase(r.phase)}</span><span>{r.id}</span></div>
      <h3 className="wb-title wb-glyph">{d ? <LensGlyphIcon glyph={d.glyph} /> : null}{W.phase(r.phase)} {'·'} {W.lenses(r.lenses)}</h3>
      <p className="wb-lede">{r.note || W.scope(scopeOf(r))}</p>
      <div className="wb-figs">
        <Fig n={x.m !== null ? x.n + '/' + x.m : x.n} label={nLabel} tone={r.status === 'done' ? 'mint' : r.status === 'failed' ? 'red' : undefined} />
        {pct !== null && <Fig n={s.words.pct(pct)} label={B.agents_f_progress} />}
        <Fig n={mmss(x.ms)} label={x.open ? B.agents_f_elapsed : B.agents_f_took} />
        <Fig n={x.readings} label={B.agents_f_readings} />
      </div>
      {pct !== null && <div className="wb-prog" role="progressbar" aria-valuemin={0} aria-valuemax={x.m ?? 0} aria-valuenow={x.n} aria-label={B.agents_f_progress}><i style={{ width: pct + '%' }} /></div>}
      <div className="wb-inline">
        <span className="wb-meta">{tx(B.agents_times, { started: r.started_at.slice(0, 10) + ' ' + hhmm(r.started_at), ended: r.ended_at ? hhmm(r.ended_at) : '-' })}{r.model ? ' · ' + tx(B.agents_model, { model: r.model }) : ''}</span>
      </div>
      {r.status === 'failed' ? <div className="wb-err">{tx(B.agents_ended_badly, { status: W.status(r.status) })}</div> : null}
      {r.status === 'aborted' ? <div className="wb-note">{B.agents_aborted_note}</div> : null}
      <Sec head={B.agents_log} aside={tx(B.agents_lines, { count: x.lines.length })}>
        {x.lines.length ? <Feed rows={x.lines} /> : <p className="none">{B.agents_no_lines}</p>}
      </Sec>
    </>
  );
}

const START_NOTE = { waiting: 'agents_start_note_waiting', failed: 'agents_start_note_failed', silent: 'agents_start_note_silent' } as const;

export function StartDetail({ l, now }: { l: StartLine; now: number }) {
  const s = useSheet();
  const { B, tx } = s.text;
  const d = s.plan.LENS[l.lens];
  const st: StartState | undefined = s.live.started.get(l.result.label);
  const note = st && st.phase in START_NOTE ? B[START_NOTE[st.phase as keyof typeof START_NOTE]] : null;
  return (
    <>
      <div className="wb-kick"><span className={'st ' + (st?.phase ?? 'running')}>{st ? startWord(B, st.phase) : B.agents_started_word}</span><span>{d?.name ?? l.lens}</span><span>{tx(B.agents_pid, { pid: l.result.pid })}</span></div>
      <h3 className="wb-title wb-glyph">{d ? <LensGlyphIcon glyph={d.glyph} /> : null}{l.result.label}</h3>
      <p className="wb-lede">{B.agents_start_lede}</p>
      <div className="wb-figs">
        <Fig n={l.ids.length} label={B.agents_f_items} />
        {st && <Fig n={st.sessions} label={B.agents_f_sessions} />}
        {st && <Fig n={mmss(startElapsed(st, now))} label={st.settled ? B.agents_f_took : B.agents_f_elapsed} />}
        <Fig n={l.result.pid} label={B.agents_f_pid} />
      </div>
      {note ? <div className={st?.phase === 'failed' ? 'wb-err' : 'wb-note'}>{note}</div> : null}
      <Sec head={B.agents_command}><pre className="wb-log" tabIndex={0} aria-label={B.agents_command}>{l.result.command}</pre></Sec>
      <Sec head={B.agents_items_head} aside={l.ids.length}><p>{l.ids.join(', ')}</p></Sec>
    </>
  );
}

export function Overview() {
  const s = useSheet();
  const { B, tx } = s.text;
  const rows = useMemo(() => s.data.scan.activity.slice().sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 40), [s.data.scan.activity]);
  return (
    <>
      <Sec head={B.agents_ov_how} aside={B.agents_store}><p>{B.agents_ov_text}</p></Sec>
      <Sec head={B.agents_latest} aside={tx(B.agents_lines, { count: s.data.scan.activity.length })}>
        {rows.length ? <Feed rows={rows} /> : <p className="none">{B.agents_no_latest}</p>}
      </Sec>
    </>
  );
}
