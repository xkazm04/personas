// Soundings L2 — what rises out of a station: one reading as a card, or the
// project's own file. Both end in a comparison strip laid out at the SAME
// horizontal positions as the chart's stations, so "where does this project
// sit" is answered in the geometry the owner already knows.
import type { CSSProperties } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { DIM_REGISTRY, type DimKey } from '../lib/dimRegistry';
import type { DimNode, IslandEdge } from '../lib/types';
import type { ChartGeo, Box } from './soundingsGeometry';
import { compareY, stationCentre } from './soundingsGeometry';
import { BAND_OF, categoryOf, daysLate, type Band, type Station } from './soundingsModel';
import { STATUS_COLOR, StatusMark, Tide, toolText } from './soundingsParts';

export type Anchor = { clientX: number; clientY: number };

export interface CardHandlers {
  onImprove: (node: DimNode, anchor: Anchor) => void;
  onCompare: (station: number) => void;
  onFollow: (station: number, edge: IslandEdge) => void;
  onSession: (sessionId: string) => void;
  onPersonas: (anchor: Anchor) => void;
  onShip: () => void;
  onFactory: () => void;
  onDispatch: () => void;
  onTerminal: () => void;
  canTerminal: boolean;
}

const anchorOf = (e: React.MouseEvent<HTMLElement>): Anchor => {
  const r = e.currentTarget.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.bottom };
};

function useBandWords() {
  const { t } = useTranslation();
  const m = t.mastermind;
  return {
    name: [m.soundings_band_surface, m.soundings_band_shallows, m.soundings_band_midwater, m.soundings_band_deep] as const,
    mean: [m.soundings_band_surface_mean, m.soundings_band_shallows_mean, m.soundings_band_midwater_mean, m.soundings_band_deep_mean] as const,
  };
}

export function useStatusWord() {
  const { t } = useTranslation();
  const m = t.mastermind;
  return (s: DimNode['status']): string =>
    ({ solid: m.legend_solid, partial: m.legend_partial, risk: m.legend_risk, alert: m.legend_alert, absent: m.legend_absent, unknown: m.legend_unknown })[s];
}

function useActionWord() {
  const { t } = useTranslation();
  const m = t.mastermind;
  return (a: NonNullable<DimNode['action']>): string =>
    ({
      deploy: m.soundings_action_deploy,
      standards: m.soundings_action_standards,
      ideas: m.soundings_action_ideas,
      goals: m.soundings_action_goals,
      kpi: m.soundings_action_kpi,
      'stack-list': m.soundings_action_stack_list,
      'skills-run': m.soundings_action_skills_run,
    })[a];
}

function Compare({ stations, g, card, me, label, markFor, related, onPick }: {
  stations: readonly Station[];
  g: ChartGeo;
  card: Box;
  me: number;
  label: string;
  markFor: (s: Station) => { status: Parameters<typeof StatusMark>[0]['status']; band: Band } | null;
  related?: ReadonlySet<number>;
  onPick: (i: number) => void;
}) {
  return (
    <div className="sd-c-cmp">
      <div className="sd-cmp-sea" aria-hidden />
      <span className="sd-cmp-lab typo-label">{label}</span>
      <div className="sd-cmp-wl" style={{ top: compareY(0) + 13 }} aria-hidden />
      {stations.map((s) => {
        const m = markFor(s);
        if (!m) return null;
        const cls = ['sd-cmp-m', s.index === me ? 'sd-me' : '', related?.has(s.index) ? 'sd-rel' : ''].filter(Boolean).join(' ');
        return (
          <button
            key={s.island.slug}
            type="button"
            className={cls}
            style={{ left: Math.round(stationCentre(g, s.index) - card.x) }}
            aria-label={s.island.name}
            onClick={(e) => { e.stopPropagation(); onPick(s.index); }}
          >
            <StatusMark status={m.status} style={{ top: compareY(m.band) - 2 }} />
            <span className="sd-ct">{s.island.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One reading, lifted: tooling and the real Improve action, the ladder, its
 *  depth, and the same reading across the whole portfolio. */
export function ReadingCard({ station, dimKey, stations, g, card, h }: {
  station: Station;
  dimKey: DimKey;
  stations: readonly Station[];
  g: ChartGeo;
  card: Box;
  h: CardHandlers;
}) {
  const { t, tx } = useTranslation();
  const m = t.mastermind;
  const band = useBandWords();
  const statusWord = useStatusWord();
  const actionWord = useActionWord();
  const node = station.island.nodes.find((n) => n.key === dimKey);
  if (!node) return null;
  const def = DIM_REGISTRY[dimKey];
  const b = BAND_OF[node.status];
  const catLabel = { runtime: m.dim_cat_runtime, delivery: m.dim_cat_delivery, agentic: m.dim_cat_agentic, product: m.dim_cat_product }[categoryOf(dimKey)];
  const errors = station.island.monitorErrors;

  let reach: string;
  if (node.steps) reach = tx(m.soundings_reached, { reached: node.reached, steps: node.steps });
  else if (node.status === 'solid') reach = m.soundings_check_yes;
  else if (node.status === 'partial') reach = m.soundings_check_partly;
  else reach = m.soundings_check;

  return (
    <div className="sd-card-body" key={`${station.island.slug}:${dimKey}`} style={{ '--c': STATUS_COLOR[node.status] } as CSSProperties}>
      <div className="sd-c-head">
        <span className="sd-c-over typo-label">{`${station.island.name} · ${catLabel}`}</span>
        <h2 className="sd-c-title typo-heading-lg" id="sd-card-title">{node.label}</h2>
        <span className="sd-c-status"><StatusMark status={node.status} /><span>{statusWord(node.status)}</span></span>
      </div>
      <div className="sd-c-body">
        <div>
          <span className="sd-c-lab typo-label">{m.world_tooling}</span>
          <div className="sd-c-tool">
            {node.detail ? toolText(node.detail) : <span className="sd-muted">{node.status === 'unknown' ? m.soundings_could_not_read : m.cell_empty}</span>}
          </div>
          {def.viewOnly ? (
            <div className="sd-c-note">{m.soundings_view_only}</div>
          ) : node.action ? (
            <div className="sd-acts">
              <button type="button" className="sd-act" data-testid="sd-improve" onClick={(e) => h.onImprove(node, anchorOf(e))}>
                {tx(m.soundings_improve_action, { action: actionWord(node.action) })}
              </button>
            </div>
          ) : null}
        </div>
        <div>
          <span className="sd-c-lab typo-label">{m.world_progress}</span>
          <ol className="sd-ladder">
            {node.steps
              ? Array.from({ length: node.steps }, (_, k) => (
                <li key={k} className={`typo-code${k < node.reached ? ' sd-on' : ''}`}><i />{tx(m.soundings_step, { n: k + 1 })}</li>
              ))
              : (
                <>
                  <li className={`typo-code${node.status === 'solid' ? ' sd-on' : ''}`}><i />{m.soundings_yes}</li>
                  <li className="typo-code"><i />{m.soundings_no}</li>
                </>
              )}
          </ol>
          <div className="sd-c-reach">{reach}</div>
        </div>
        <div>
          <span className="sd-c-lab typo-label">{m.soundings_depth}</span>
          <div className="sd-c-tool">{`${band.name[b]}, ${band.mean[b]}`}</div>
          {dimKey === 'monitoring' && errors !== null && (
            <div className="sd-c-note">{tx(errors === 1 ? m.soundings_live_errors_one : m.soundings_live_errors_other, { count: errors })}</div>
          )}
        </div>
      </div>
      <Compare
        stations={stations}
        g={g}
        card={card}
        me={station.index}
        label={tx(m.soundings_across, { dim: node.label })}
        markFor={(s) => {
          const q = s.island.nodes.find((n) => n.key === dimKey);
          return q ? { status: q.status, band: BAND_OF[q.status] } : null;
        }}
        onPick={h.onCompare}
      />
    </div>
  );
}

/** The project's own file: live work, the release plan, readiness, relations,
 *  and the doors the Baseline offers (Factory, dispatch, terminal). */
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
  const ship = island.ship ?? null;
  const late = ship?.late ? daysLate(ship.targetDate, Date.now()) : 0;
  const stat = (key: string) => island.stats.find((s) => s.key === key)?.value ?? '-';
  const fleetWord = (s: string) => ({ running: m.fleet_running, awaiting_input: m.fleet_awaiting, idle: m.fleet_idle, stale: m.fleet_stale } as Record<string, string>)[s] ?? s;
  const stateWord = { healthy: m.kb_state_healthy, building: m.kb_state_building, warning: m.kb_state_warning, critical: m.kb_state_critical }[island.state];
  const myEdges = edges.filter((e) => e.from === island.slug || e.to === island.slug);
  const slugIndex = new Map(stations.map((s) => [s.island.slug, s.index]));

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
            {island.fleet.length === 0 && island.personasRunning.length === 0 && <li className="sd-muted">{m.far_idle}</li>}
          </ul>
          <div className="sd-acts">
            <button type="button" className="sd-act" onClick={h.onDispatch}>{m.dispatch_fleet}</button>
            {h.canTerminal && <button type="button" className="sd-act" onClick={h.onTerminal}>{m.open_terminal}</button>}
          </div>
        </div>
        <div>
          <span className="sd-c-lab typo-label">{m.world_next_ship}</span>
          {ship?.next ? (
            <>
              <button type="button" className="sd-d-ship sd-d-ship-btn" onClick={h.onShip}>{ship.next}</button>
              <div style={{ margin: '2px 0 8px' }}><Tide ship={ship} className="sd-d-tide" /></div>
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
        </div>
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
      </div>
      <Compare
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
