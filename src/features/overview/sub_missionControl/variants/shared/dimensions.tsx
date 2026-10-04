// The eight operator questions under the old section list, each answered from
// one or more Readings. `judge` folds a reading to a Verdict; `headline` states
// the one number the verdict stands on, plus the line that explains it. Every
// state except `ready` is spoken as a state, never as a number.

import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatNumeric } from '@/lib/utils/formatters';
import { formatRelativeShort } from '@/features/overview/libs/formatRelativeShort';
import type { MissionReadings } from './useMissionReadings';
import { verdictOf, type Reading, type Verdict } from './readings';

export type DimId = 'outcomes' | 'agents' | 'queue' | 'recovery' | 'spend' | 'autonomy' | 'vault' | 'instruments';

export const DIM_ORDER: readonly DimId[] = ['outcomes', 'agents', 'queue', 'recovery', 'spend', 'autonomy', 'vault', 'instruments'];

export interface DimState {
  id: DimId;
  label: string;
  question: string;
  verdict: Verdict;
  stateLabel: string;
  /** The one figure; null when the verdict is not `ready`-derived. */
  value: ReactNode | null;
  /** One sentence of evidence. */
  note: ReactNode;
}

type Tr = ReturnType<typeof useTranslation>;

/** The success ring's own bands (VitalsConsole SuccessRing): green from 90%,
 *  amber from 75%. Named here so the wall and the ring band one rate alike. */
const SUCCESS_STEADY_PCT = 90;
const SUCCESS_WATCH_PCT = 75;
function successBand(pct: number): Verdict {
  if (pct >= SUCCESS_STEADY_PCT) return 'ok';
  if (pct >= SUCCESS_WATCH_PCT) return 'watch';
  return 'act';
}

function readingOf(r: MissionReadings, id: DimId): Reading<unknown> {
  return r[id] as Reading<unknown>;
}

function judge(r: MissionReadings, id: DimId): Verdict {
  switch (id) {
    case 'outcomes': return verdictOf(r.outcomes, (v) => v.successRate === null ? 'unmeasured' : successBand(v.successRate));
    case 'agents': return verdictOf(r.agents, (v) => v.total === 0 ? 'unmeasured' : v.critical > 0 ? 'act' : v.degraded > 0 ? 'watch' : 'ok');
    case 'queue': return verdictOf(r.queue, (v) => v.total > 0 ? 'yours' : 'ok');
    case 'recovery': return verdictOf(r.recovery, (v) => v.paused > 0 ? 'act' : v.open > 0 ? 'watch' : 'ok');
    case 'spend': return verdictOf(r.spend, (v) => v.anomalies > 0 ? 'watch' : 'ok');
    case 'autonomy': return verdictOf(r.autonomy, (v) => v.loopOn === null ? 'watch' : 'ok');
    case 'vault': return verdictOf(r.vault, (v) => v.failedRotations > 0 ? 'act' : 'ok');
    case 'instruments': return verdictOf(r.instruments, (v) => v.errors > 0 ? 'watch' : 'ok');
  }
}

function figure(r: MissionReadings, id: DimId, { t, tx, language }: Tr): { value: ReactNode; note: ReactNode } | null {
  const ml = t.overview.mission_layers;
  switch (id) {
    case 'outcomes': {
      if (r.outcomes.status !== 'ready') return null;
      const v = r.outcomes.value;
      return {
        value: v.successRate === null ? null : <Numeric value={v.successRate} unit="percent" precision={0} />,
        note: v.runs === 0 ? ml.no_runs : `${tx(ml.runs_count, { count: v.runs })} · ${tx(ml.failed_count, { count: v.failed })}`,
      };
    }
    case 'agents': {
      if (r.agents.status !== 'ready') return null;
      const v = r.agents.value;
      return {
        value: v.score === null ? null : <>{v.score}<span className="mc-unit">/100</span></>,
        note: `${v.critical} ${t.overview.health_extra.outage} · ${v.degraded} ${t.overview.health_extra.degraded} · ${v.healthy} ${t.overview.health_extra.operational}`,
      };
    }
    case 'queue': {
      if (r.queue.status !== 'ready') return null;
      const v = r.queue.value;
      return {
        value: v.total,
        note: v.total === 0 ? ml.nothing_waiting
          : `${v.alerts} ${t.overview.dashboard.tile_alerts} · ${v.reviews} ${t.overview.dashboard.tile_reviews} · ${v.memory} ${t.overview.dashboard.pane_memory}`,
      };
    }
    case 'recovery': {
      if (r.recovery.status !== 'ready') return null;
      const v = r.recovery.value;
      return {
        value: v.open,
        note: <>{tx(ml.open_count, { count: v.open })} · {tx(ml.paused_count, { count: v.paused })} · {v.holdRate === null ? t.overview.healing_effectiveness.no_data : <><Numeric value={v.holdRate} unit="ratio" precision={0} /> {ml.held_rate}</>}</>,
      };
    }
    case 'spend': {
      if (r.spend.status !== 'ready') return null;
      const v = r.spend.value;
      return {
        value: <Numeric value={v.total} unit="usd" />,
        note: v.anomalies > 0 ? tx(ml.anomaly_count, { count: v.anomalies })
          : v.burnRate !== null ? tx(ml.per_day, { value: formatNumeric(v.burnRate, 'usd', { language }) }) : t.overview.health_extra.stable,
      };
    }
    case 'autonomy': {
      if (r.autonomy.status !== 'ready') return null;
      const v = r.autonomy.value;
      const next = formatRelativeShort(v.nextAt, { signed: true, hourCutoff: 48 });
      return {
        value: v.scheduled,
        note: <>{tx(ml.scheduled_count, { count: v.scheduled })}{' · '}{next ? tx(ml.next_in, { time: next.label }) : ml.no_schedule}{v.loopOn === true ? null : <>{' · '}{v.loopOn === null ? t.overview.attention_loop.unavailable : ml.loop_off}</>}</>,
      };
    }
    case 'vault': {
      if (r.vault.status !== 'ready') return null;
      const v = r.vault.value;
      return {
        value: v.failedRotations,
        note: `${tx(ml.rotation_failed_count, { count: v.failedRotations })} · ${v.events === 0 ? t.overview.vault_activity.empty : tx(ml.events_count, { count: v.events })}`,
      };
    }
    case 'instruments': {
      if (r.instruments.status !== 'ready') return null;
      const v = r.instruments.value;
      return {
        value: <>{v.sources - v.errors}<span className="mc-unit">/{v.sources}</span></>,
        note: v.lastSynced ? `${t.overview.dashboard.status_synced} ${new Date(v.lastSynced).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' })}` : t.overview.dashboard.status_synced,
      };
    }
  }
}

export function useDimStates(r: MissionReadings): Record<DimId, DimState> {
  const tr = useTranslation();
  const ml = tr.t.overview.mission_layers;
  const stateLabel: Record<Verdict, string> = {
    pending: ml.state_pending, failed: ml.state_failed, unmeasured: ml.state_unmeasured,
    ok: ml.state_ok, watch: ml.state_watch, yours: ml.dim_queue, act: ml.state_act,
  };
  const out = {} as Record<DimId, DimState>;
  for (const id of DIM_ORDER) {
    const verdict = judge(r, id);
    const fig = figure(r, id, tr);
    const reading = readingOf(r, id);
    out[id] = {
      id,
      label: ml[`dim_${id}`],
      question: ml[`q_${id}`],
      verdict,
      stateLabel: stateLabel[verdict],
      value: fig?.value ?? null,
      note: fig?.note ?? (reading.status === 'failed' ? ml.state_failed : ml.state_pending),
    };
  }
  return out;
}
