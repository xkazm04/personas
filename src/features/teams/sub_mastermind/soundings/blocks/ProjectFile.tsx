// Soundings L2 — THE PROJECT'S OWN FILE: live work, the release plan,
// readiness, relations, and where the project sits in the portfolio. The four
// columns are in projectFileSections; this is the head and the arrangement.
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import type { IslandEdge } from '../../lib/types';
import type { Box, ChartGeo } from '../soundingsGeometry';
import type { Station } from '../soundingsModel';
import { STATUS_COLOR, StatusMark } from '../soundingsParts';
import { CompareStrip, useBandWords, type CardHandlers } from '../cardShell';
import { FleetColumn, ReadinessColumn, RelationsColumn, ShipColumn } from './projectFileSections';

export function ProjectFile({ station, stations, rankOf, edges, related, g, card, h }: {
  station: Station;
  stations: readonly Station[];
  rankOf: (i: number) => number;
  edges: readonly IslandEdge[];
  related: ReadonlySet<number>;
  g: ChartGeo;
  card: Box;
  h: CardHandlers;
}) {
  const { t, tx } = useTranslation();
  const m = t.mastermind;
  const band = useBandWords();
  const { island, metrics } = station;
  const rank = rankOf(station.index);
  const stateWord = { healthy: m.kb_state_healthy, building: m.kb_state_building, warning: m.kb_state_warning, critical: m.kb_state_critical }[island.state];

  return (
    <div className="sd-card-body" key={`${island.slug}:file`} style={{ '--c': STATUS_COLOR[metrics.mark] } as CSSProperties}>
      <div className="sd-c-head">
        <span className="sd-c-over typo-label">{`${island.lifecycle} · ${stateWord}`}</span>
        <h2 className="sd-c-title typo-heading-lg" id="sd-card-title">{island.name}</h2>
        <span className="sd-c-status">
          <StatusMark status={metrics.mark} />
          <span>{`${band.name[metrics.band]}, ${rank === 0 ? m.soundings_rank_first : tx(m.soundings_rank_nth, { rank: rank + 1 })}`}</span>
        </span>
      </div>
      <div className="sd-d-body">
        <FleetColumn station={station} h={h} />
        <ShipColumn station={station} h={h} />
        <ReadinessColumn station={station} h={h} />
        <RelationsColumn station={station} stations={stations} edges={edges} h={h} />
      </div>
      <CompareStrip
        stations={stations}
        g={g}
        card={card}
        me={station.index}
        label={m.soundings_where_it_sits}
        related={related}
        markFor={(s) => (s.ghost ? null : { status: s.metrics.mark, band: s.metrics.band })}
        onPick={h.onCompare}
      />
    </div>
  );
}
