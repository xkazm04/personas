import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Orbit } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, EMPTY_CHANNEL } from '@/stores/slices/pipeline/channelSlice';
import {
  useChannelSubscription, derivePresence, deriveLastSeen, type PresenceStatus,
} from '@/features/teams/sub_collab/useTeamChannel';
import { listTeamMembers, listTeamConnections } from '@/api/pipeline/teams';
import { silentCatch } from '@/lib/silentCatch';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { memberColor } from '@/lib/channel/eventModel';
import type { PersonaTeamMember } from '@/lib/bindings/PersonaTeamMember';
import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import { cleanName } from '../../grid/fleetGridModel';
import type { StreamTeam } from '../types';
import {
  buildConstellation, trafficEdges, hashUnit,
  type MapMemberInput, type MapNode,
} from './mapModel';
import { hexPath, hasRoleGlyph, CoreReactor, RoleGlyph } from './mapGlyphs';

/* ----------------------------------------------------------------------------
 * CONSTELLATION MAP — the Channels' third surface. The Stream answers "what
 * happened", Conversations answers "what are we deciding"; the Map answers
 * "who is doing what, to whom, RIGHT NOW" — one glance, no reading.
 *
 * One team at a time (a constellation is a team's shape; blending teams
 * blends nothing meaningful). The orchestrator sits at the core, satellites
 * ring it in role sectors. Presence drives the node: working pulses in the
 * persona's colour, waiting holds an amber ring, idle dims. Structural
 * connections are the faint permanent geometry; live event fan-outs (author →
 * subscribed consumers) draw over it as animated dashes that fade with age.
 *
 * Clicking a node drills into the Timeline pre-scoped to that speaker — the
 * map is a viewfinder, not another dashboard.
 * -------------------------------------------------------------------------- */

const VIEW_W = 900;
const VIEW_H = 560;
const NODE_R = 17;
const CORE_R = 26;

/** Trim an edge so it runs rim-to-rim, never under either node. */
function trimmed(a: MapNode, b: MapNode, rA: number, rB: number) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return { x1: a.x + ux * (rA + 4), y1: a.y + uy * (rA + 4), x2: b.x - ux * (rB + 8), y2: b.y - uy * (rB + 8) };
}

export function ChannelMap({
  teams, onDrillIn, layoutControl,
}: {
  teams: StreamTeam[];
  /** Node click — open the Timeline scoped to this speaker. */
  onDrillIn: (teamId: string, personaId: string) => void;
  /** The layout switcher, rendered in THIS view's own header rather than above
   *  all of them — one header strip instead of two. Owned and built by
   *  `MonitorChannelGrid`; each view only places it. */
  layoutControl?: ReactNode;
}) {
  const { t } = useTranslation();
  const reducedMotion = useReducedMotion() ?? false;
  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeId && teams[0]) setActiveId(teams[0].teamId);
  }, [teams, activeId]);
  const team = useMemo(() => teams.find((tm) => tm.teamId === activeId) ?? null, [teams, activeId]);

  // Roster topology — roles + directed connections, fetched per team.
  const [members, setMembers] = useState<PersonaTeamMember[]>([]);
  const [connections, setConnections] = useState<PersonaTeamConnection[]>([]);
  useEffect(() => {
    if (!activeId) return;
    let stale = false;
    setMembers([]);
    setConnections([]);
    Promise.all([listTeamMembers(activeId), listTeamConnections(activeId)])
      .then(([m, c]) => {
        if (stale) return;
        setMembers(m);
        setConnections(c);
      })
      .catch(silentCatch('channelMap:topology'));
    return () => {
      stale = true;
    };
  }, [activeId]);

  // Live layer — the shared channel feed for this one team.
  const subIds = useMemo(() => (activeId ? [activeId] : []), [activeId]);
  useChannelSubscription(subIds);
  const st = usePipelineStore((s) => (activeId ? s.channels[channelKey(activeId)] : undefined)) ?? EMPTY_CHANNEL;

  // Recency drives presence windows and traffic fade; a 30s tick keeps both
  // honest when no new rows arrive to trigger a render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const presence = useMemo(() => derivePresence(st.items, now), [st.items, now]);
  const lastSeen = useMemo(() => deriveLastSeen(st.items), [st.items]);

  const mapMembers = useMemo<MapMemberInput[]>(() => {
    const byId = new Map(team?.members.map((m) => [m.personaId, m]) ?? []);
    return members.map((m) => {
      const cm = byId.get(m.persona_id);
      return {
        memberId: m.id,
        personaId: m.persona_id,
        role: m.role,
        name: cm?.name ?? m.persona_id,
        color: cm?.color ?? memberColor(undefined, m.persona_id),
      };
    });
  }, [members, team]);

  const { nodes, structure } = useMemo(
    () => buildConstellation(mapMembers, connections, VIEW_W, VIEW_H),
    [mapMembers, connections],
  );
  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.personaId, n])), [nodes]);

  const traffic = useMemo(() => {
    const ids = new Set(nodes.map((n) => n.personaId));
    return trafficEdges(st.items, ids, now);
  }, [st.items, nodes, now]);

  const legend: Array<{ key: PresenceStatus | 'idle'; label: string; cls: string }> = [
    { key: 'working', label: t.monitor.presence_working, cls: 'bg-status-warning animate-pulse' },
    { key: 'waiting', label: t.monitor.presence_waiting, cls: 'bg-status-warning/40' },
    { key: 'idle', label: t.monitor.presence_idle, cls: 'bg-foreground/25' },
  ];

  const workingCount = [...presence.values()].filter((p) => p === 'working').length;
  const isLive = workingCount > 0 || traffic.length > 0;

  return (
    <div className="h-full flex flex-col min-h-0 rounded-card border border-border bg-foreground/[0.01] overflow-hidden hud-corners hud-bloom">
      <div className="flex-shrink-0 h-11 px-3 flex items-center gap-2.5 border-b border-border bg-foreground/[0.015]">
        <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
          <Orbit className="w-3.5 h-3.5 text-foreground" />
        </div>
        <span className="typo-body font-semibold text-foreground">{t.monitor.channels_layout_map}</span>
        {layoutControl && <span className="ml-auto flex items-center order-last">{layoutControl}</span>}

        {/* Team switcher — one constellation at a time. */}
        <div className="ml-2 flex items-center gap-1 overflow-x-auto">
          {teams.map((tm) => {
            const on = tm.teamId === activeId;
            return (
              <button
                key={tm.teamId}
                type="button"
                onClick={() => setActiveId(tm.teamId)}
                aria-pressed={on}
                className={`flex-shrink-0 px-2 py-0.5 rounded-full border typo-caption transition-colors ${
                  on ? 'border-transparent text-foreground font-medium' : 'border-border text-foreground opacity-55 hover:opacity-90'
                }`}
                style={on ? { backgroundColor: `${tm.teamColor}26`, boxShadow: `inset 0 0 0 1px ${tm.teamColor}66` } : undefined}
              >
                {cleanName(tm.teamName)}
              </button>
            );
          })}
        </div>

      </div>

      <div className="relative flex-1 min-h-0">
        {nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="hud-empty typo-label text-foreground opacity-60">{t.monitor.map_empty}</span>
          </div>
        ) : (
          <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 w-full h-full">
            <defs>
              <marker id="map-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0.8 L7.2,4 L0,7.2 Z" className="fill-foreground/25" />
              </marker>
              <marker id="map-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0.8 L7.2,4 L0,7.2 Z" className="fill-status-warning/70" />
              </marker>
              {/* Soft glow for the reactor heart — blur + merge, no libs. */}
              <filter id="map-glow" x="-80%" y="-80%" width="260%" height="260%">
                <feGaussianBlur stdDeviation="4.5" result="b" />
                <feMerge>
                  <feMergeNode in="b" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Structural geometry — the team's declared shape, always faint. */}
            {structure.map((e, i) => {
              const a = nodeById.get(e.from);
              const b = nodeById.get(e.to);
              if (!a || !b) return null;
              const seg = trimmed(a, b, a.core ? CORE_R : NODE_R, b.core ? CORE_R : NODE_R);
              return (
                <line
                  key={`s:${i}`}
                  {...seg}
                  markerEnd="url(#map-arrow)"
                  strokeDasharray={e.type === 'feedback' ? '2 4' : undefined}
                  className="stroke-foreground/15"
                  strokeWidth={1}
                />
              );
            })}

            {/* Live routes — event author → subscribed consumers, fading with
                age. Width carries volume; the dash march says "in flight". */}
            {traffic.map((e) => {
              const a = nodeById.get(e.from);
              const b = nodeById.get(e.to);
              if (!a || !b) return null;
              const seg = trimmed(a, b, a.core ? CORE_R : NODE_R, b.core ? CORE_R : NODE_R);
              const age = Math.min(1, (now - e.at) / (10 * 60 * 1000));
              return (
                <line
                  key={`t:${e.from}→${e.to}`}
                  {...seg}
                  markerEnd="url(#map-arrow-hot)"
                  strokeDasharray="7 5"
                  strokeWidth={Math.min(2.5, 1 + e.count * 0.3)}
                  className="stroke-status-warning animate-map-dash"
                  style={{ opacity: 0.85 - age * 0.65 }}
                />
              );
            })}

            {nodes.map((n) => {
              const p = presence.get(n.personaId);
              const seen = lastSeen.get(n.personaId);
              const r = n.core ? CORE_R : NODE_R;
              const dim = !p && !n.core;
              return (
                <g
                  key={n.personaId}
                  transform={`translate(${n.x}, ${n.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={n.name}
                  className="cursor-pointer focus:outline-none group"
                  onClick={() => team && onDrillIn(team.teamId, n.personaId)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    if (team) onDrillIn(team.teamId, n.personaId);
                  }}
                >
                  {/* Presence ring. */}
                  {p === 'working' && (
                    <circle r={r + 5} className="fill-none stroke-status-warning animate-pulse" strokeWidth={1.5} />
                  )}
                  {p === 'waiting' && (
                    <circle r={r + 5} className="fill-none stroke-status-warning/45" strokeWidth={1.5} strokeDasharray="4 3" />
                  )}
                  {n.core ? (
                    <CoreReactor r={r} color={n.color} working={p === 'working'} spin={!reducedMotion} />
                  ) : (
                    <>
                      <path
                        d={hexPath(r)}
                        fill={n.color}
                        fillOpacity={dim ? 0.1 : 0.22}
                        stroke={p === 'working' ? 'var(--status-warning)' : n.color}
                        strokeOpacity={dim ? 0.45 : 0.9}
                        strokeWidth={1.5}
                      />
                      <g style={{ color: n.color }} opacity={dim ? 0.5 : 0.95}>
                        <RoleGlyph role={n.role} />
                      </g>
                      {!hasRoleGlyph(n.role) && (
                        <text
                          y={4}
                          textAnchor="middle"
                          className="fill-foreground pointer-events-none select-none"
                          style={{ fontSize: 11, fontWeight: 600, opacity: dim ? 0.55 : 0.95 }}
                        >
                          {n.name.slice(0, 2).toUpperCase()}
                        </text>
                      )}
                    </>
                  )}
                  <text
                    y={r + (n.core ? 24 : 16)}
                    textAnchor="middle"
                    className="fill-foreground pointer-events-none select-none font-mono"
                    style={{ fontSize: 10.5, letterSpacing: '0.08em', opacity: dim ? 0.55 : 0.9 }}
                  >
                    {(n.name.length > 20 ? `${n.name.slice(0, 19)}…` : n.name).toUpperCase()}
                  </text>
                  {/* Heartbeat — dispatch-anchored last activity. */}
                  {seen != null && (
                    <text
                      y={r + (n.core ? 36 : 28)}
                      textAnchor="middle"
                      className="pointer-events-none select-none fill-foreground"
                      style={{ fontSize: 9, opacity: 0.45 }}
                    >
                      {formatRelativeTime(new Date(seen).toISOString())}
                    </text>
                  )}
                  {/* Deterministic drift phase per node — never re-rolls.
                      SMIL, so CSS reduced-motion can't reach it; gate here. */}
                  {!reducedMotion && (
                    <animateTransform
                      attributeName="transform"
                      type="translate"
                      additive="sum"
                      dur={`${12 + hashUnit(n.personaId, 7) * 8}s`}
                      repeatCount="indefinite"
                      values="0 0; 0 -2.5; 0 0; 0 2.5; 0 0"
                      begin={`${-hashUnit(n.personaId, 13) * 12}s`}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        )}

        {/* Corner telemetry — the four HUD readouts. Labels and values are
            written together so the corners can never disagree. */}
        {nodes.length > 0 && team && (
          <>
            <div className="absolute top-2 left-3 z-10 font-mono pointer-events-none">
              <p className="typo-label text-foreground opacity-45">{t.monitor.stream_group_channel}</p>
              <p className="typo-caption font-mono uppercase tracking-wider text-foreground opacity-85">{cleanName(team.teamName)}</p>
            </div>
            <div className="absolute top-2 right-3 z-10 font-mono text-right pointer-events-none">
              <p className="typo-label text-foreground opacity-45">{t.monitor.map_members}</p>
              <p className="typo-data tabular-nums text-foreground opacity-85">{nodes.length}</p>
            </div>
            <div className="absolute bottom-2 right-3 z-10 font-mono text-right pointer-events-none flex items-center gap-2">
              <span className="typo-label text-foreground opacity-45">{t.monitor.presence_working}</span>
              <span className={`typo-data tabular-nums ${workingCount > 0 ? 'text-status-warning' : 'text-foreground opacity-85'}`}>
                {workingCount}
              </span>
              <span
                className={`px-1.5 rounded-pill border typo-label ${
                  isLive
                    ? 'border-status-success/40 text-status-success animate-pulse'
                    : 'border-border text-foreground opacity-50'
                }`}
              >
                {isLive ? t.monitor.map_live : t.monitor.presence_idle}
              </span>
            </div>
          </>
        )}

        {/* Legend — presence states + the live-route mark. */}
        {nodes.length > 0 && (
          <div className="absolute bottom-2 left-3 z-10 flex items-center gap-3 px-2.5 py-1 rounded-full border border-border bg-background/70 backdrop-blur-sm">
            {legend.map((l) => (
              <span key={l.key} className="inline-flex items-center gap-1.5 typo-caption text-foreground opacity-75">
                <span className={`w-2 h-2 rounded-full ${l.cls}`} />
                {l.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 typo-caption text-foreground opacity-75">
              <span className="inline-block w-5 border-t border-dashed border-status-warning" />
              {t.monitor.map_legend_traffic}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export default ChannelMap;
