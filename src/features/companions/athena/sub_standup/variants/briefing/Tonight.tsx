import type { CSSProperties } from 'react';

import { Figure, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import type { Zoom } from '../../model/keymap';
import { clockLabel, pos } from '../../model/timeAxis';
import type { StandupView } from '../../model/types';
import { BRIEFING } from './copy';
import { MachinePlot, plotHeight } from './MachinePlot';

const T = BRIEFING.tonight;

const LEGEND: ReadonlyArray<[string, string]> = [
  ['cpu', T.legend_cpu], ['busy', T.legend_busy], ['decided', T.legend_decided],
  ['running', T.legend_running], ['done', T.legend_done], ['fill', T.legend_fill], ['dead', T.legend_dead],
];

/** The one plain sentence under the figure. */
function useCaption(view: StandupView, zoom: Zoom): string {
  const { t, tx } = useTranslation();
  const m = view.machine;
  if (m.laneBlocks.length === 0) return t.athena.standup.machine.night_empty;
  const dead = Math.round(m.deadShare * 100);
  const head = tx(view.status === 'armed' ? T.caption_armed : T.caption_draft, { dead });
  return `${head} ${tx(T.caption_peak, { units: m.peakUnits, lanes: m.lanes })} ${zoom === 'today' ? T.zoom : T.zoom_back}`;
}

/**
 * "Tonight": one full-column figure. Today's measured CPU runs up to the NOW
 * line, tonight's lanes (decided blocks, fill, and the dead spots between them)
 * continue on the same axis, and one sentence says what it means.
 */
export function Tonight({ view, zoom, utilizationLong, loading, error }: {
  view: StandupView;
  zoom: Zoom;
  utilizationLong: readonly HostUtilizationPoint[];
  loading: boolean;
  error?: string;
}) {
  const { tx } = useTranslation();
  const caption = useCaption(view, zoom);
  const split = pos(view.past.to, { from: view.past.from, to: view.night.to });
  const nowLabel = tx(T.now, { time: clockLabel(view.nowMs) });
  const empty = loading && view.machine.bars.length === 0;
  return (
    <Section title={BRIEFING.sections.tonight} meta={view.status === 'armed' ? tx(T.armed_at, { time: clockLabel(view.past.to) }) : undefined}>
      <div className="sb-fig__heads typo-caption" style={{ '--sb-split': String(split) } as CSSProperties}>
        <span>{zoom === 'today' ? T.today : T.days}</span>
        <span className="sb-fig__night">{T.tonight}</span>
      </div>
      <Figure label={T.label} desc={caption} height={plotHeight(view.machine.lanes)} state={empty ? 'loading' : 'default'} testId="briefing-tonight">
        <MachinePlot view={view} zoom={zoom} utilizationLong={utilizationLong} nowLabel={nowLabel} />
      </Figure>
      <div className="sb-fig__foot">
        <p className={`typo-caption ${error ? 'text-status-error' : ''}`}>{error ?? caption}</p>
        <ul className="sb-legend" aria-hidden="true">
          {LEGEND.map(([k, label]) => <li key={k} className="typo-caption"><i className={`sb-sw sb-sw--${k}`} />{label}</li>)}
        </ul>
      </div>
    </Section>
  );
}
