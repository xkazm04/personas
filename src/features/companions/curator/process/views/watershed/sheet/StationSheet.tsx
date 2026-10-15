import { useMemo } from 'react';
import { DataTable, ListRow, Rows, Section, StatStrip, type TableCol } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { outcomeName, stationName } from '../../../labels';
import { dur, pctText, share } from '../words';
import { sessionById, stationKinds } from './detail';
import type { SheetProps } from './SurveySheet';
import { WaitHistogram } from './WaitHistogram';

type KindCol = 'kind' | 'steps' | 'errors' | 'errSessions' | 'time';
const OUTCOME_TONE = { landed: 'primary', interrupted: 'error', errored: 'error', quiet: 'neutral' } as const;

/** The second depth: one settlement surveyed. */
export function StationSheet({ scene, reading, model, base, mode, repo, view, q, setNav }: SheetProps & { q: number }) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const w = p.watershed;
  const s = model.stations[q]!;
  const n = model.n;
  const bs = repo ? base.stations[q] : undefined;
  const detail = scene.fates.stations[q]!;
  const rank = scene.g.ranks[q];
  const ids = useMemo(() => view.map((x) => x.id), [view]);
  const kinds = useMemo(() => stationKinds(reading, ids, s.keys), [reading, ids, s.keys]);
  const maxSteps = kinds.reduce((a, k) => Math.max(a, k.steps), 1);
  const all = (k: number, of: number) => (bs ? ` · ${tx(w.fig_all, { value: pctText(k, of) })}` : '');

  const notes = [
    s.skipped ? tx(w.note_skipped, { count: s.skipped }) : '',
    tx(w.note_left, { fail: scene.g.cFail[q] ?? 0, clean: scene.g.cClean[q] ?? 0 }),
    q === model.stations.length - 1 ? w.note_last : '',
  ].filter(Boolean).join(' ');

  const cols: TableCol<KindCol>[] = [
    { key: 'kind', label: w.col_kind },
    { key: 'steps', label: w.col_steps, num: true },
    { key: 'errors', label: w.col_errors, num: true },
    { key: 'errSessions', label: w.col_err_sessions, num: true },
    { key: 'time', label: w.col_time, num: true },
  ];
  const rows = kinds.map((k) => {
    const bw = Math.max(2, (100 * k.steps) / maxSteps);
    return {
      id: k.kind,
      cells: {
        kind: (
          <span className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate">{k.kind}</span>
            <span className="ws-kbar flex-1">
              <i style={{ width: `${bw}%` }} />
              {k.errors > 0 && <i className="is-err" style={{ width: `${Math.max(1.5, bw * Math.min(1, k.errors / Math.max(1, k.steps)))}%` }} />}
            </span>
          </span>
        ),
        steps: k.steps,
        errors: <span className={k.errors ? 'ws-red' : undefined}>{k.errors}</span>,
        errSessions: tx(p.reached, { reached: k.errSessions, total: k.sessions }),
        time: dur(k.time),
      },
    };
  });

  const list = (title: string, list: string[], tone: string, testId: string) => (
    <Section level={2} title={<span className={tone}>{title}</span>} count={list.length}>
      <Rows count={list.length} cap={40} empty={{ title: w.list_empty }}>
        {list.map((id) => {
          const src = sessionById(reading, id);
          const inst = view.find((x) => x.id === id);
          const o = (inst?.outcome ?? 'quiet') as keyof typeof OUTCOME_TONE;
          return (
            <ListRow
              key={id}
              size="s"
              name={<span className="typo-code">{id}</span>}
              meta={[src?.project, src?.model, inst ? dur(inst.active) : null].filter(Boolean).join(' · ')}
              mark={{ tone: OUTCOME_TONE[o], label: outcomeName(p, o) }}
              figures={<span className="typo-caption">{outcomeName(p, o)}</span>}
              onPress={() => setNav({ station: q, session: id })}
              testId={`${testId}-${id}`}
            />
          );
        })}
      </Rows>
    </Section>
  );

  return (
    <>
      <div className="typo-eyebrow k-quiet">{tx(w.eyebrow_station, { index: q + 1, count: model.stations.length })}</div>
      <h2 className="ws-s-title typo-hero">{stationName(p, s.keys)}</h2>
      <p className="typo-caption">
        {[mode === 'interactive' ? p.mode_interactive : p.mode_headless, repo ?? p.repo_all, rank ? tx(p.rank, { rank }) : ''].filter(Boolean).join(' · ')}
      </p>
      <StatStrip
        tiles={[
          {
            label: w.fig_reached_short,
            value: s.reached ? share(s.reached, n) : null,
            note: tx(p.reached, { reached: s.reached, total: n }) + (bs ? ` · ${tx(p.cohort_share, { pct: pctText(bs.reached, base.n) })}` : ''),
          },
          { label: w.fig_exits_short, value: <span className="ws-red">{s.exits}</span>, note: `${w.fig_exits} · ${pctText(s.exits, s.reached)}${all(bs?.exits ?? 0, bs?.reached ?? 0)}` },
          { label: w.fig_friction_short, value: <span className="ws-amb">{s.friction}</span>, note: `${w.fig_friction} · ${pctText(s.friction, s.reached)}${all(bs?.friction ?? 0, bs?.reached ?? 0)}` },
          {
            label: w.fig_wait,
            value: Number.isFinite(s.medWait) ? dur(s.medWait) : null,
            note: [Number.isFinite(s.p75Wait) ? tx(p.wait_p75, { value: dur(s.p75Wait) }) : '', bs && Number.isFinite(bs.medWait) ? tx(w.fig_all, { value: dur(bs.medWait) }) : ''].filter(Boolean).join(' · ') || undefined,
          },
        ]}
      />
      <p className="typo-caption">{notes}</p>
      <Section level={2} title={w.kinds_title} count={tx(w.kinds_count, { count: kinds.length })}>
        <div className="overflow-x-auto">
          <DataTable cols={cols} rows={rows} label={w.kinds_title} empty={{ title: w.kinds_empty }} />
        </div>
      </Section>
      {detail.waits.length > 0 && (
        <Section level={2} title={w.hist_title} count={tx(w.hist_count, { count: detail.waits.length })}>
          <WaitHistogram waits={detail.waits} median={s.medWait} />
          <p className="typo-caption">{w.hist_note} {p.time_note}</p>
        </Section>
      )}
      {list(w.list_exits, detail.exitIds, 'ws-red', 'watershed-exit')}
      {list(w.list_friction, detail.frictionIds, 'ws-amb', 'watershed-friction')}
    </>
  );
}
