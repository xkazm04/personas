import { useMemo, type RefObject } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { outcomeName, stationName } from '../../labels';
import type { ProcessViewProps } from '../types';
import DialSessions from './DialSessions';
import { DialScene } from './DialScene';
import { kindBreakdown, phaseTime, rankRepos, sessionsWithOutcome, stationSessions, type SessionBucket } from './dialDetail';
import type { DialData } from './useDialData';

export type Drill = { bucket: SessionBucket } | { outcome: string } | null;

interface DeepProps {
  view: ProcessViewProps;
  data: DialData;
  level: number;
  q: number | null;
  drill: Drill;
  /** replays the entrance when it changes */
  seq: number;
  rows: number;
  rulerRef: RefObject<HTMLDivElement | null>;
  onOpenSessions: (b: SessionBucket) => void;
  onPickRepo?: (name: string | null) => void;
}

/** Everything below the dial, split out of the entry chunk: a ring's own surface (level 1) and its sessions (level 2). */
export default function DialDeep({ view: v, data, level, q, drill, seq, rows, rulerRef, onOpenSessions, onPickRepo }: DeepProps) {
  const { t, tx } = useTranslation();
  const p = t.companions.process;
  const d = p.dial;
  const { reading, view, cohort, mode, repo } = v;

  const station = useMemo(() => {
    if (q == null) return null;
    const keys = data.keys[q] ?? [];
    return {
      kinds: kindBreakdown(view, data.raw, reading, keys),
      time: phaseTime(view, data.raw, reading, keys),
      repos: rankRepos(cohort, data.fates, q),
      lists: stationSessions(view, data.fates, data.raw, q),
    };
  }, [view, cohort, data, reading, q]);

  const list = useMemo(() => {
    if (!drill) return null;
    const where = [q != null && data.figs[q] ? stationName(p, data.figs[q].keys) : null, mode === 'headless' ? p.mode_headless : p.mode_interactive, repo, d.sx_newest].filter(Boolean).join(' · ');
    if ('outcome' in drill) {
      const rs = sessionsWithOutcome(view, data.raw, drill.outcome);
      return { rows: rs, title: `${tx(rs.length === 1 ? d.sx_count_one : d.sx_count_other, { count: rs.length })} · ${outcomeName(p, drill.outcome)}`, sub: where };
    }
    const rs = station?.lists[drill.bucket] ?? [];
    const what = drill.bucket === 'failing' ? d.sx_failing : drill.bucket === 'stumbled' ? d.sx_stumbled : d.sx_quiet;
    return { rows: rs, title: `${tx(rs.length === 1 ? d.sx_count_one : d.sx_count_other, { count: rs.length })} ${what}`, sub: where };
  }, [drill, station, view, data, q, mode, repo, p, d, tx]);

  const fig = q != null ? data.figs[q] : undefined;
  const ring = q != null ? data.rings[q] : undefined;
  return (
    <>
      <section className="dial-scene" aria-label={fig ? stationName(p, fig.keys) : undefined}>
        {fig && ring && station && (
          <DialScene
            key={`${q}:${seq}`}
            fig={fig}
            ring={ring}
            total={data.figs.length}
            last={q === data.figs.length - 1}
            repo={repo}
            kinds={station.kinds}
            time={station.time}
            repos={station.repos}
            counts={{ failing: station.lists.failing.length, stumbled: station.lists.stumbled.length, quiet: station.lists.quiet.length }}
            rows={rows}
            rulerRef={rulerRef}
            onOpenSessions={onOpenSessions}
            onPickRepo={onPickRepo}
          />
        )}
      </section>
      <section className="dial-sheet" aria-label={d.sx_aria} inert={level < 2}>
        {list && <DialSessions title={list.title} sub={list.sub} rows={list.rows} raw={data.raw} reading={reading} />}
      </section>
    </>
  );
}
