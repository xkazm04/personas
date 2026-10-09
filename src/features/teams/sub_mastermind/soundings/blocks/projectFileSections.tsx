// Soundings L2 — the four columns of the project file. Each one is a label, a
// list or key-value grid, and the doors that belong to it; none of them knows
// where it sits.
import { useTranslation } from '@/i18n/useTranslation';

import { MemorySection } from '../../lib/MemorySection';
import type { IslandEdge } from '../../lib/types';
import { daysLate, type Station } from '../soundingsModel';
import { Tide } from '../soundingsParts';
import { anchorOf, type CardHandlers } from '../cardShell';

/** Live work: fleet sessions, running personas, runner tasks, and the two
 *  dispatch doors. */
export function FleetColumn({ station, h }: { station: Station; h: CardHandlers }) {
  const { t, tx } = useTranslation();
  const m = t.mastermind;
  const { island } = station;
  const fleetWord = (s: string) => ({ running: m.fleet_running, awaiting_input: m.fleet_awaiting, idle: m.fleet_idle, stale: m.fleet_stale } as Record<string, string>)[s] ?? s;

  return (
    <div>
      <span className="sd-c-lab typo-label">{m.world_fleet}</span>
      <ul className="sd-d-list">
        {island.fleet.map((s) => (
          <li key={s.id}>
            <button type="button" className="sd-sess" data-state={s.state} aria-label={tx(m.soundings_open_session, { name: s.label })} onClick={() => h.onSession(s.id)}>
              <i />{s.label}
            </button>
            <span className={s.state === 'awaiting_input' ? 'sd-late-t' : 'sd-muted'} style={s.state === 'awaiting_input' ? { color: 'var(--sd-lilac)' } : undefined}>{fleetWord(s.state)}</span>
          </li>
        ))}
        {island.personasRunning.length > 0 && (
          <li>
            <button type="button" className="sd-sess" data-state="persona" aria-label={m.soundings_open_personas} onClick={(e) => h.onPersonas(anchorOf(e))}>
              <i />{island.personasRunning.join(', ')}
            </button>
            <span className="sd-muted">{m.world_persona_running}</span>
          </li>
        )}
        {island.runners.length > 0 && (
          <li>
            <button type="button" className="sd-sess" data-state="runner" aria-label={m.soundings_open_runners} onClick={(e) => h.onRunners(anchorOf(e))}>
              <i />{tx(island.runners.length === 1 ? m.soundings_runners_one : m.soundings_runners_other, { count: island.runners.length })}
            </button>
            <span className="sd-muted">{m.lane_runners}</span>
          </li>
        )}
        {island.fleet.length === 0 && island.personasRunning.length === 0 && island.runners.length === 0 && <li className="sd-muted">{m.far_idle}</li>}
      </ul>
      <div className="sd-acts">
        <button type="button" className="sd-act" onClick={h.onDispatch}>{m.dispatch_fleet}</button>
        {h.canTerminal && <button type="button" className="sd-act" onClick={h.onTerminal}>{m.open_terminal}</button>}
      </div>
    </div>
  );
}

/** The release plan: the next milestone, the tide gauge, and whether it is late. */
export function ShipColumn({ station, h }: { station: Station; h: CardHandlers }) {
  const { t, tx } = useTranslation();
  const m = t.mastermind;
  const ship = station.island.ship ?? null;
  const late = ship?.late ? daysLate(ship.targetDate, Date.now()) : 0;

  return (
    <div>
      <span className="sd-c-lab typo-label">{m.world_next_ship}</span>
      {ship?.next ? (
        <>
          <button type="button" className="sd-d-ship sd-d-ship-btn" onClick={h.onShip}>{ship.next}</button>
          <div className="sd-d-tiderow"><Tide ship={ship} className="sd-d-tide" /></div>
          <dl className="sd-d-kv">
            <dt>{m.soundings_shipped}</dt>
            <dd className="typo-data">{tx(m.soundings_of, { a: ship.shipped, b: ship.total })}</dd>
            <dt>{ship.late ? m.world_late : m.soundings_target}</dt>
            <dd className={ship.late ? 'sd-late-t' : undefined}>
              {ship.targetDate
                ? ship.late ? tx(m.soundings_late_due, { days: late, date: ship.targetDate }) : ship.targetDate
                : m.soundings_no_date}
            </dd>
          </dl>
        </>
      ) : (
        <div className="sd-muted">{m.soundings_none_planned}</div>
      )}
    </div>
  );
}

/** The numbers, the door into Factory, and the project's own memory. */
export function ReadinessColumn({ station, h }: { station: Station; h: CardHandlers }) {
  const { t } = useTranslation();
  const m = t.mastermind;
  const { island } = station;
  const stat = (key: string) => island.stats.find((s) => s.key === key)?.value ?? '-';

  return (
    <div>
      <span className="sd-c-lab typo-label">{m.soundings_readiness}</span>
      <dl className="sd-d-kv">
        <dt>{m.world_auto_score}</dt><dd className="typo-data">{island.autoScore}</dd>
        <dt>{m.world_prod_score}</dt><dd className="typo-data">{island.prodScore}</dd>
        <dt>{m.soundings_blockers}</dt><dd className="typo-data">{island.blockers}</dd>
        <dt>{m.world_llm_spend}</dt><dd className="typo-data">{stat('llm')}</dd>
        <dt>{m.soundings_errors}</dt>
        <dd className={island.monitorErrors === null ? 'sd-muted' : 'typo-data'}>{island.monitorErrors === null ? m.soundings_not_bound : island.monitorErrors}</dd>
      </dl>
      <div className="sd-acts">
        <button type="button" className="sd-act" onClick={h.onFactory}>{m.open_in_factory}</button>
      </div>
      {!island.slug.startsWith('demo-') && <MemorySection projectId={island.slug} />}
    </div>
  );
}

/** The currents this project sits on: follow one and the chart travels. */
export function RelationsColumn({ station, stations, edges, h }: {
  station: Station;
  stations: readonly Station[];
  edges: readonly IslandEdge[];
  h: CardHandlers;
}) {
  const { t, tx } = useTranslation();
  const m = t.mastermind;
  const { island } = station;
  const myEdges = edges.filter((e) => e.from === island.slug || e.to === island.slug);
  const slugIndex = new Map(stations.map((s) => [s.island.slug, s.index]));

  return (
    <div>
      <span className="sd-c-lab typo-label">{m.family_relations}</span>
      {myEdges.length === 0 && <div className="sd-muted">{m.soundings_no_currents}</div>}
      {myEdges.map((e) => {
        const other = e.from === island.slug ? e.to : e.from;
        const o = slugIndex.get(other);
        if (o === undefined) return null;
        const name = stations[o]!.island.name;
        return (
          <button
            key={`${e.from}-${e.to}-${e.kind}`}
            type="button"
            className="sd-d-rel"
            aria-label={tx(m.soundings_follow_current, { name, label: e.label ?? '' })}
            onClick={(ev) => { ev.stopPropagation(); h.onFollow(o, e); }}
          >
            <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden>
              <path d="M1.5 9 C1.5 1.5 22.5 1.5 22.5 9" fill="none" stroke="var(--sd-ink3)" strokeWidth="1.4" strokeDasharray={e.kind === 'similarity' ? '3 3' : undefined} />
            </svg>
            <span>{name}</span>
            {e.label && <span className="sd-muted">{e.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
