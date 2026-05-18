// Fleet Constellation view
// ---------------------------------------------------------------
// Personas plotted by *time since last run*: recently active near
// the centre, dormant on the outer rim. Eight non-linear time bands
// (clock-style) work as the implicit sort axis:
//
//   live    < 1h        today  1h–1d
//   3d      1–3d        week   3–7d
//   2w      7–14d       month  14–30d
//   stale   30d+        dormant never run
//
// Other encodings:
//   * Node size  = trust tier (L0 small → L4 large)
//   * Ring glow  = health (emerald / amber / red / zinc)
//   * Full persona name renders beneath each node
//
// Active bands print a soft 12-o'clock label with a count; empty
// bands stay dim. Selecting a node opens the right-rail dossier.
// The canvas grows to fit the longest persona name in the dataset
// and is allowed to overflow the page — the page wrapper scrolls.

import { memo, useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Activity, ArrowRight, Clock, ExternalLink, Zap } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { ConnectorIcon, getConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { getTrustTier } from '@/lib/personas/personaThresholds';
import { useTranslation } from '@/i18n/useTranslation';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

interface PersonaOverviewVariantConstellationProps {
  data: Persona[];
  triggerCounts: Record<string, number>;
  lastRunMap: Record<string, string | null>;
  healthMap: Record<string, PersonaHealth | undefined>;
  connectorNamesMap: Map<string, string[]>;
  isBuilding: (id: string) => boolean;
  isDraft: (p: Persona) => boolean;
  onRowClick: (p: Persona) => void;
}

/* -- Layout constants ------------------------------------------------- */

// The canvas is intentionally larger than typical viewports — dozens of
// personas need real estate to read full names without overlap. Final
// width / height are computed per-render from the longest name in the
// dataset (see `computeCanvas`) so very long names never get clipped.
const INNER_R = 76;
const OUTER_R = 640;
const BASE_MARGIN = 140;            // minimum buffer between outer ring and canvas edge
const NAME_CHAR_PX = 11;            // rough monospace advance at 18px (un-emphasised label)

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Non-linear time bands, innermost first. Each band's `maxMs` is the
 * inclusive upper edge of "time since last run" that lands there. The
 * final two bands ("stale", "dormant") are special-cased. */
interface Band {
  id: string;
  label: string;
  maxMs: number | null;        // null = catches everything not yet bucketed
  isDormant?: boolean;
}
const BANDS: Band[] = [
  { id: 'live',    label: 'live',     maxMs: 1 * HOUR },
  { id: 'today',   label: 'today',    maxMs: 1 * DAY },
  { id: '3d',      label: '3 days',   maxMs: 3 * DAY },
  { id: 'week',    label: '1 week',   maxMs: 7 * DAY },
  { id: '2w',      label: '2 weeks',  maxMs: 14 * DAY },
  { id: 'month',   label: '1 month',  maxMs: 30 * DAY },
  { id: 'stale',   label: '1 month+', maxMs: null },
  { id: 'dormant', label: 'never',    maxMs: null, isDormant: true },
];
const BAND_COUNT = BANDS.length;
const RADIAL_STEP = (OUTER_R - INNER_R) / BAND_COUNT;

/** Compute square canvas dimensions large enough for the outermost orbit
 * plus the longest persona name (which renders as a centred text label
 * below its node and must not be clipped). Returns size + centre. */
function computeCanvas(data: Persona[]): { size: number; center: number } {
  let longest = 0;
  for (const p of data) longest = Math.max(longest, p.name.length);
  const nameHalfWidth = (longest * NAME_CHAR_PX) / 2;
  const margin = Math.max(BASE_MARGIN, nameHalfWidth + 32);
  const size = 2 * (OUTER_R + margin);
  return { size, center: size / 2 };
}

const TIER_NODE_R: Record<string, number> = {
  L4: 20,
  L3: 18,
  L2: 16,
  L1: 14,
  L0: 12,
};

const HEALTH_RING: Record<string, string> = {
  healthy: '#34d399',   // emerald-400
  degraded: '#fbbf24',  // amber-400
  failing: '#f87171',   // red-400
};

function nodeRadius(score: number, draft: boolean, building: boolean): number {
  if (draft || building) return 14;
  return TIER_NODE_R[getTrustTier(score).label] ?? 14;
}

function ringColor(health: PersonaHealth | undefined, enabled: boolean, draft: boolean, building: boolean): string {
  if (building) return '#a78bfa';   // violet-400
  if (draft || !enabled) return '#71717a'; // zinc-500
  return HEALTH_RING[health?.status ?? 'healthy'] ?? HEALTH_RING.healthy!;
}

/** Hash a string to a stable phase offset in radians [0, 2π). */
function phaseFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

function bandFor(lastRunIso: string | null | undefined, draft: boolean, building: boolean): number {
  // Drafts / builds drift to the outer dormant band so the inner orbits
  // stay reserved for personas with actual run history.
  if (draft || building) return BAND_COUNT - 1;
  if (!lastRunIso) return BAND_COUNT - 1;
  const ts = Date.parse(lastRunIso);
  if (Number.isNaN(ts)) return BAND_COUNT - 1;
  const dt = Date.now() - ts;
  for (let i = 0; i < BANDS.length - 2; i++) {
    if (dt <= BANDS[i]!.maxMs!) return i;
  }
  return BAND_COUNT - 2; // "stale"
}

interface LaidOut {
  persona: Persona;
  bandIndex: number;
  x: number;
  y: number;
  r: number;
  ring: string;
  enabled: boolean;
  draft: boolean;
  building: boolean;
}

/* -- Component -------------------------------------------------------- */

export function PersonaOverviewVariantConstellation({
  data,
  triggerCounts,
  lastRunMap,
  healthMap,
  connectorNamesMap,
  isBuilding,
  isDraft,
  onRowClick,
}: PersonaOverviewVariantConstellationProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const { size: CANVAS, center: C } = useMemo(() => computeCanvas(data), [data]);

  // Group personas by band index, then within each band assign deterministic
  // angles using even angular spacing plus an id-derived phase offset so
  // ordering stays stable across re-renders.
  const laidOut = useMemo<LaidOut[]>(() => {
    const byBand: Persona[][] = Array.from({ length: BAND_COUNT }, () => []);
    for (const p of data) {
      const bi = bandFor(lastRunMap[p.id], isDraft(p), isBuilding(p.id));
      byBand[bi]!.push(p);
    }
    for (const arr of byBand) {
      arr.sort((a, b) => a.id.localeCompare(b.id));
    }

    const out: LaidOut[] = [];
    for (let bi = 0; bi < BAND_COUNT; bi++) {
      const arr = byBand[bi]!;
      const count = arr.length;
      const baseR = INNER_R + (bi + 0.5) * RADIAL_STEP;
      const angularStep = count > 0 ? (2 * Math.PI) / count : 0;
      for (let i = 0; i < count; i++) {
        const persona = arr[i]!;
        const draft = isDraft(persona);
        const building = isBuilding(persona.id);
        // Even distribution within the band; first persona offset by its
        // own id-derived phase so different bands aren't all aligned.
        const phase = phaseFromId(persona.id);
        const theta = phase + i * angularStep;
        // Slight radial jitter (-6 to +6 px) so multiple personas in the
        // same band don't sit exactly on the centre line of the orbit.
        const jitter = ((phaseFromId(persona.id + ':r') / (2 * Math.PI)) * 12) - 6;
        const radial = baseR + jitter;
        out.push({
          persona,
          bandIndex: bi,
          x: C + radial * Math.cos(theta),
          y: C + radial * Math.sin(theta),
          r: nodeRadius(persona.trust_score ?? 0, draft, building),
          ring: ringColor(healthMap[persona.id], persona.enabled, draft, building),
          enabled: persona.enabled,
          draft,
          building,
        });
      }
    }
    return out;
  }, [data, lastRunMap, healthMap, isDraft, isBuilding, C]);

  // Which bands actually contain personas — drives label opacity.
  const bandActivity = useMemo(() => {
    const counts = new Array<number>(BAND_COUNT).fill(0);
    for (const lp of laidOut) counts[lp.bandIndex]!++;
    return counts;
  }, [laidOut]);

  const selected = selectedId ? laidOut.find((l) => l.persona.id === selectedId) : null;
  const fleetStats = useMemo(() => {
    let healthy = 0, degraded = 0, failing = 0, drafts = 0, totalTriggers = 0;
    for (const lp of laidOut) {
      if (lp.draft || lp.building) { drafts++; continue; }
      if (!lp.enabled) continue;
      const status = healthMap[lp.persona.id]?.status ?? 'healthy';
      if (status === 'healthy') healthy++;
      else if (status === 'degraded') degraded++;
      else if (status === 'failing') failing++;
      totalTriggers += triggerCounts[lp.persona.id] ?? 0;
    }
    return { healthy, degraded, failing, drafts, totalTriggers, total: laidOut.length };
  }, [laidOut, healthMap, triggerCounts]);

  const handleNodeClick = useCallback((id: string) => {
    setSelectedId((cur) => (cur === id ? null : id));
  }, []);

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      {/* Constellation canvas — scrollable wrapper; SVG renders at fixed
          oversized dimensions so dozens of personas have room to breathe.
          The legend overlay below is positioned on the OUTER container so
          it stays pinned regardless of scroll position. */}
      <div className="flex-1 relative min-w-0">
        <div className="absolute inset-0 overflow-auto p-4">
          <svg
            width={CANVAS}
            height={CANVAS}
            viewBox={`0 0 ${CANVAS} ${CANVAS}`}
            className="block mx-auto"
            role="img"
            aria-label={t.agents.persona_list.all_personas}
          >
          <defs>
            <radialGradient id="vaultGlow" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(167,139,250,0.42)" />
              <stop offset="60%" stopColor="rgba(167,139,250,0.10)" />
              <stop offset="100%" stopColor="rgba(167,139,250,0)" />
            </radialGradient>
          </defs>

          {/* Orbit guide rings + 12-o'clock band labels */}
          {BANDS.map((band, i) => {
            const r = INNER_R + (i + 1) * RADIAL_STEP;
            const active = (bandActivity[i] ?? 0) > 0;
            const ringOpacity = band.isDormant ? 0.10 : active ? 0.22 : 0.13;
            const labelOpacity = band.isDormant ? 0.32 : active ? 0.60 : 0.32;
            return (
              <g key={band.id}>
                <circle
                  cx={C}
                  cy={C}
                  r={r}
                  fill="none"
                  stroke="rgb(148 163 184)"
                  strokeOpacity={ringOpacity}
                  strokeWidth={2}
                  strokeDasharray={band.isDormant ? '4 8' : '6 10'}
                />
                {/* Band label tucked just inside the ring at 12 o'clock */}
                <text
                  x={C + 8}
                  y={C - r + 8}
                  textAnchor="start"
                  className="fill-foreground"
                  style={{
                    fontSize: '18px',
                    fontWeight: 600,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    opacity: labelOpacity,
                    pointerEvents: 'none',
                  }}
                >
                  {band.label}{active ? ` · ${bandActivity[i]}` : ''}
                </text>
              </g>
            );
          })}

          {/* Central vault */}
          <circle cx={C} cy={C} r={84} fill="url(#vaultGlow)" />
          <motion.circle
            cx={C}
            cy={C}
            r={22}
            fill="rgba(167,139,250,0.20)"
            stroke="rgba(167,139,250,0.6)"
            strokeWidth={2.4}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          />
          <text
            x={C}
            y={C + 6}
            textAnchor="middle"
            className="fill-violet-200/80"
            style={{ fontSize: '16px', fontWeight: 600, letterSpacing: '0.18em' }}
          >
            NOW
          </text>

          {/* Persona nodes */}
          {laidOut.map((lp, index) => {
            const id = lp.persona.id;
            const isSelected = id === selectedId;
            const isHovered = id === hoveredId;
            const emphasised = isSelected || isHovered;
            const fill = lp.persona.color ?? '#a78bfa';
            const labelOpacity = lp.draft || !lp.enabled ? 0.55 : 0.92;
            return (
              <motion.g
                key={id}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: Math.min(index * 0.008, 0.5), duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => setHoveredId(id)}
                onMouseLeave={() => setHoveredId((cur) => (cur === id ? null : cur))}
                onClick={() => handleNodeClick(id)}
              >
                {/* Outer glow on hover/select */}
                {emphasised && (
                  <circle cx={lp.x} cy={lp.y} r={lp.r + 16} fill={lp.ring} opacity={0.20} />
                )}
                {/* Health ring */}
                <circle
                  cx={lp.x}
                  cy={lp.y}
                  r={lp.r + 5}
                  fill="none"
                  stroke={lp.ring}
                  strokeWidth={emphasised ? 3.6 : 2.4}
                  opacity={lp.enabled ? 0.92 : 0.45}
                />
                {/* Core disc */}
                <circle
                  cx={lp.x}
                  cy={lp.y}
                  r={lp.r}
                  fill={fill}
                  fillOpacity={lp.enabled ? 0.88 : 0.32}
                  stroke="rgba(0,0,0,0.25)"
                  strokeWidth={1}
                />
                {/* Persona name — full text, never truncated. Stroke on
                    paintOrder keeps the label legible across crowded
                    inner orbits without needing a background plate. */}
                <text
                  x={lp.x}
                  y={lp.y + lp.r + 22}
                  textAnchor="middle"
                  className="fill-foreground"
                  style={{
                    fontSize: emphasised ? '22px' : '18px',
                    fontWeight: emphasised ? 600 : 500,
                    opacity: labelOpacity,
                    pointerEvents: 'none',
                    paintOrder: 'stroke',
                    stroke: 'rgba(15,17,21,0.7)',
                    strokeWidth: 4,
                    strokeLinejoin: 'round',
                  }}
                >
                  {lp.persona.name}
                </text>
              </motion.g>
            );
          })}
          </svg>
        </div>

        {/* Legend overlay — pinned on the canvas container so it stays in
            place while the SVG scrolls underneath. */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1.5 pointer-events-none bg-background/70 backdrop-blur-sm rounded-card border border-primary/10 px-3 py-2">
          <div className="text-md uppercase tracking-wider text-foreground/50 font-semibold">
            Last run
          </div>
          <div className="text-md text-foreground/70 leading-snug">
            inner = recently active · outer = dormant
          </div>
          <div className="flex items-center gap-3 text-md text-foreground/70 pt-1">
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" />ok</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />degraded</span>
            <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />failing</span>
          </div>
        </div>
      </div>

      {/* Dossier rail */}
      <aside className="w-[320px] flex-shrink-0 border-l border-primary/10 bg-secondary/15 overflow-y-auto">
        {selected ? (
          <PersonaDossier
            laid={selected}
            connectors={connectorNamesMap.get(selected.persona.id) ?? []}
            triggerCount={triggerCounts[selected.persona.id] ?? 0}
            lastRun={lastRunMap[selected.persona.id]}
            health={healthMap[selected.persona.id]}
            onOpen={() => onRowClick(selected.persona)}
            onClear={() => setSelectedId(null)}
          />
        ) : (
          <FleetOverview stats={fleetStats} />
        )}
      </aside>
    </div>
  );
}

/* -- Dossier panel ---------------------------------------------------- */

const PersonaDossier = memo(function PersonaDossier({
  laid,
  connectors,
  triggerCount,
  lastRun,
  health,
  onOpen,
  onClear,
}: {
  laid: LaidOut;
  connectors: string[];
  triggerCount: number;
  lastRun: string | null | undefined;
  health: PersonaHealth | undefined;
  onOpen: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const p = laid.persona;
  const tier = laid.enabled && !laid.draft ? getTrustTier(p.trust_score ?? 0) : null;
  const statusLabel = laid.building
    ? t.agents.persona_list.badge_building
    : laid.draft
      ? t.agents.persona_list.badge_draft
      : !laid.enabled
        ? t.agents.persona_list.badge_disabled
        : (health?.status ?? 'healthy');

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-2">
        <div className="text-md uppercase tracking-wider text-foreground/50 font-semibold">Dossier</div>
        <button
          type="button"
          onClick={onClear}
          className="text-md text-foreground/60 hover:text-foreground transition-colors"
        >
          clear
        </button>
      </div>

      <div className="flex items-start gap-3">
        <div
          className="icon-frame icon-frame-pop bg-primary/10 border border-primary/15 flex-shrink-0"
          style={p.color ? { borderColor: `${p.color}30`, backgroundColor: `${p.color}15` } : undefined}
        >
          <PersonaIcon icon={p.icon} color={p.color} size="w-5 h-5" framed frameSize="lg" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-base font-medium text-foreground truncate">{p.name}</div>
          {p.description && (
            <div className="text-md text-foreground/60 leading-snug mt-0.5 line-clamp-3">{p.description}</div>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-md text-foreground/80">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: laid.ring }} />
          <span className="capitalize">{statusLabel}</span>
        </span>
        {tier ? (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-input text-md font-semibold ${tier.bg} ${tier.color}`}>
            {tier.label}
            <span className="opacity-60">· {Math.round(p.trust_score ?? 0)}</span>
          </span>
        ) : (
          <span className="text-md text-foreground/40">--</span>
        )}
      </div>

      <div>
        <div className="text-md uppercase tracking-wider text-foreground/50 font-semibold mb-2">
          {t.common.connectors}
        </div>
        {connectors.length === 0 ? (
          <div className="text-md text-foreground/40">{t.agents.persona_list.no_connectors}</div>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {connectors.map((name) => {
              const meta = getConnectorMeta(name);
              return (
                <Tooltip key={name} content={meta.label}>
                  <div className="inline-flex items-center gap-1.5 px-2 py-1 rounded-input bg-secondary/40 border border-primary/10 text-md text-foreground/80 cursor-help">
                    <ConnectorIcon meta={meta} size="w-3.5 h-3.5" />
                    <span className="truncate max-w-[90px]">{meta.label}</span>
                  </div>
                </Tooltip>
              );
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-card border border-primary/10 bg-secondary/30 px-3 py-2.5">
          <div className="text-md uppercase tracking-wider text-foreground/50 font-semibold flex items-center gap-1">
            <Zap className="w-3 h-3" />
            {t.common.triggers}
          </div>
          <div className="text-2xl font-semibold text-foreground tabular-nums leading-tight mt-1">
            {triggerCount}
          </div>
        </div>
        <div className="rounded-card border border-primary/10 bg-secondary/30 px-3 py-2.5">
          <div className="text-md uppercase tracking-wider text-foreground/50 font-semibold flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {t.agents.overview_columns.last_run}
          </div>
          <div className="text-md font-medium text-foreground/90 leading-tight mt-1">
            {lastRun ? formatRelativeTime(lastRun) : t.agents.persona_list.never}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="mt-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-interactive bg-primary/15 hover:bg-primary/25 border border-primary/25 text-md font-medium text-primary transition-colors"
      >
        <ExternalLink className="w-3.5 h-3.5" />
        Open
        <ArrowRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
});

/* -- Fleet overview --------------------------------------------------- */

function FleetOverview({ stats }: { stats: { healthy: number; degraded: number; failing: number; drafts: number; totalTriggers: number; total: number } }) {
  const { t } = useTranslation();
  const active = stats.healthy + stats.degraded + stats.failing;
  const healthyPct = active > 0 ? Math.round((stats.healthy / active) * 100) : 0;

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="text-md uppercase tracking-wider text-foreground/50 font-semibold">Fleet</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-4xl font-semibold text-foreground tabular-nums leading-none">{stats.total}</div>
          <div className="text-md text-foreground/60 mt-1">personas in orbit</div>
        </div>
        <div className="inline-flex items-center gap-1 text-md text-emerald-400">
          <Activity className="w-3.5 h-3.5" />
          {healthyPct}%
        </div>
      </div>

      <div className="space-y-2">
        <StatLine label="Healthy" value={stats.healthy} accent="bg-emerald-400" />
        <StatLine label="Degraded" value={stats.degraded} accent="bg-amber-400" />
        <StatLine label="Failing" value={stats.failing} accent="bg-red-400" />
        <StatLine label="Drafts" value={stats.drafts} accent="bg-zinc-500" />
      </div>

      <div className="rounded-card border border-primary/10 bg-secondary/30 px-3 py-2.5">
        <div className="text-md uppercase tracking-wider text-foreground/50 font-semibold flex items-center gap-1">
          <Zap className="w-3 h-3" />
          {t.common.triggers}
        </div>
        <div className="text-2xl font-semibold text-foreground tabular-nums leading-tight mt-1">
          {stats.totalTriggers}
        </div>
        <div className="text-md text-foreground/50">across all personas</div>
      </div>

      <div className="text-md text-foreground/50 leading-snug pt-2 border-t border-primary/8">
        Click a node to inspect a persona. Inner orbits = recently active. Ring colour = health.
      </div>
    </div>
  );
}

function StatLine({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="flex items-center justify-between text-md">
      <span className="inline-flex items-center gap-2 text-foreground/70">
        <span className={`w-2 h-2 rounded-full ${accent}`} />
        {label}
      </span>
      <span className="tabular-nums text-foreground/90 font-medium">{value}</span>
    </div>
  );
}
