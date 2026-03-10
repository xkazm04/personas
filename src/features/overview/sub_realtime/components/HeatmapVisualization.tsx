import { useMemo, useRef, useEffect, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { RealtimeEvent } from '@/hooks/realtime/useRealtimeEvents';
import { EVENT_TYPE_HEX_COLORS } from '@/hooks/realtime/useRealtimeEvents';
import type { DiscoveredSource } from '../libs/visualizationHelpers';
import {
  colorForSource, labelForSource,
  DEFAULT_TOOLS, DEFAULT_PERSONAS,
  clampLabel, iconChar,
} from '../libs/visualizationHelpers';
import EventLogSidebar from './EventLogSidebar';

/*
 * Heatmap / Matrix visualization — a grid where rows = sources, columns = agents.
 * Each cell shows traffic intensity as colored heat, with pulse rings on active events.
 * Philosophy: data-dense overview of all connections at once, spot hot paths instantly.
 */

/* ---------- Layout ---------- */
const GRID_LEFT = 16;
const GRID_TOP = 14;
const GRID_RIGHT = 96;
const GRID_BOTTOM = 92;
const HEADER_H = 10;
const ROW_LABEL_W = 14;

interface PersonaInfo {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
}

interface Props {
  events: RealtimeEvent[];
  personas: PersonaInfo[];
  droppedCount?: number;
  onSelectEvent: (event: RealtimeEvent | null) => void;
}

interface CellData {
  sourceId: string;
  agentId: string;
  count: number;
  lastColor: string;
  isActive: boolean;
  lastEventType: string;
}

export default function HeatmapVisualization({ events, personas, onSelectEvent }: Props) {
  const uid = useId();

  /* ---------- source discovery ---------- */
  const discoveredRef = useRef(new Map<string, DiscoveredSource>());

  useEffect(() => {
    const map = discoveredRef.current;
    for (const evt of events) {
      const key = evt.source_id || evt.source_type || 'unknown';
      if (key === 'unknown') continue;
      const existing = map.get(key);
      if (existing) { existing.count++; existing.lastSeen = Date.now(); }
      else { map.set(key, { id: key, label: labelForSource(key), count: 1, lastSeen: Date.now() }); }
    }
  }, [events]);

  const sourceRows = useMemo(() => {
    const disc = discoveredRef.current;
    if (disc.size === 0) return DEFAULT_TOOLS.slice(0, 7).map(t => ({ id: t.id, label: t.label, color: t.color }));
    const sources = Array.from(disc.values()).sort((a, b) => b.count - a.count).slice(0, 8);
    return sources.map(s => ({ id: s.id, label: s.label, color: colorForSource(s.id) }));
  }, [events.length]);

  const agentCols = useMemo(() => {
    if (personas.length > 0) return personas.slice(0, 8).map(p => ({ id: p.id, label: p.name, icon: p.icon, color: p.color ?? '#8b5cf6' }));
    return DEFAULT_PERSONAS.slice(0, 6);
  }, [personas]);

  /* ---------- Build cell data ---------- */
  const { cells, maxCount } = useMemo(() => {
    const cellMap = new Map<string, CellData>();
    const activeIds = new Set(events.filter(e => e._phase !== 'done').map(e => e._animationId));

    for (const evt of events) {
      const srcKey = evt.source_id || evt.source_type || 'unknown';
      const agtKey = evt.target_persona_id ?? agentCols[evt.id.charCodeAt(0) % agentCols.length]?.id ?? 'unknown';
      const cellId = `${srcKey}::${agtKey}`;
      const existing = cellMap.get(cellId);
      const color = EVENT_TYPE_HEX_COLORS[evt.event_type] ?? '#818cf8';
      if (existing) {
        existing.count++;
        existing.lastColor = color;
        existing.lastEventType = evt.event_type;
        if (activeIds.has(evt._animationId)) existing.isActive = true;
      } else {
        cellMap.set(cellId, {
          sourceId: srcKey,
          agentId: agtKey,
          count: 1,
          lastColor: color,
          isActive: activeIds.has(evt._animationId),
          lastEventType: evt.event_type,
        });
      }
    }

    let mc = 0;
    for (const c of cellMap.values()) { if (c.count > mc) mc = c.count; }
    return { cells: cellMap, maxCount: Math.max(1, mc) };
  }, [events, agentCols]);

  /* ---------- Dimensions ---------- */
  const nRows = sourceRows.length;
  const nCols = agentCols.length;
  const cellW = nCols > 0 ? (GRID_RIGHT - GRID_LEFT - ROW_LABEL_W) / nCols : 10;
  const cellH = nRows > 0 ? (GRID_BOTTOM - GRID_TOP - HEADER_H) / nRows : 10;
  const gridContentLeft = GRID_LEFT + ROW_LABEL_W;
  const gridContentTop = GRID_TOP + HEADER_H;

  const { inFlightCount } = useMemo(() => {
    let inflight = 0;
    for (const e of events) { if (e._phase !== 'done') inflight++; }
    return { inFlightCount: inflight };
  }, [events]);

  return (
    <div className="w-full h-full flex min-h-[280px]">
      <div className="flex-1 relative">
        <svg viewBox="0 0 100 100" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
          <defs>
            <filter id={`${uid}-cellGlow`}>
              <feGaussianBlur stdDeviation="0.4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Title */}
          <text x={GRID_LEFT} y={GRID_TOP - 1} fill="rgba(255,255,255,0.3)" fontSize="1.8" fontFamily="monospace">
            SOURCE \ AGENT
          </text>
          <text x={GRID_RIGHT} y={GRID_TOP - 1} textAnchor="end" fill={inFlightCount > 0 ? 'rgba(6,182,212,0.6)' : 'rgba(6,182,212,0.25)'} fontSize="1.6" fontFamily="monospace">
            {inFlightCount > 0 ? `${inFlightCount} active` : 'idle'}
          </text>

          {/* Column headers (agents) */}
          {agentCols.map((col, ci) => {
            const cx = gridContentLeft + ci * cellW + cellW / 2;
            const cy = GRID_TOP + HEADER_H / 2;
            return (
              <g key={col.id}>
                <circle cx={cx} cy={cy - 1} r={2.2} fill={`${col.color}15`} stroke={col.color} strokeWidth="0.15" />
                <text x={cx} y={cy - 0.7} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.75)" fontSize="1.8" fontFamily="monospace">
                  {iconChar({ id: col.id, label: col.label, icon: col.icon, color: col.color, x: 0, y: 0 })}
                </text>
                <text x={cx} y={cy + 2.8} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="1.1" fontFamily="monospace">
                  {clampLabel(col.label, 7)}
                </text>
              </g>
            );
          })}

          {/* Row labels (sources) */}
          {sourceRows.map((row, ri) => {
            const cy = gridContentTop + ri * cellH + cellH / 2;
            return (
              <g key={row.id}>
                <rect x={GRID_LEFT} y={cy - 1.5} width={ROW_LABEL_W - 1} height={3} rx={0.5} fill={`${row.color}10`} stroke={`${row.color}20`} strokeWidth="0.1" />
                <text x={GRID_LEFT + (ROW_LABEL_W - 1) / 2} y={cy + 0.3} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.5)" fontSize="1.2" fontFamily="monospace">
                  {clampLabel(row.label, 8)}
                </text>
              </g>
            );
          })}

          {/* Grid lines */}
          {Array.from({ length: nCols + 1 }, (_, i) => (
            <line key={`vc${i}`} x1={gridContentLeft + i * cellW} y1={gridContentTop} x2={gridContentLeft + i * cellW} y2={gridContentTop + nRows * cellH} stroke="rgba(255,255,255,0.02)" strokeWidth="0.1" />
          ))}
          {Array.from({ length: nRows + 1 }, (_, i) => (
            <line key={`hr${i}`} x1={gridContentLeft} y1={gridContentTop + i * cellH} x2={gridContentLeft + nCols * cellW} y2={gridContentTop + i * cellH} stroke="rgba(255,255,255,0.02)" strokeWidth="0.1" />
          ))}

          {/* Cells */}
          {sourceRows.map((row, ri) => agentCols.map((col, ci) => {
            const cellId = `${row.id}::${col.id}`;
            const cell = cells.get(cellId);
            const cx = gridContentLeft + ci * cellW + cellW / 2;
            const cy = gridContentTop + ri * cellH + cellH / 2;
            const intensity = cell ? cell.count / maxCount : 0;
            const r = Math.max(0.6, Math.min(cellW, cellH) * 0.35 * (0.3 + 0.7 * intensity));
            const color = cell?.lastColor ?? 'rgba(255,255,255,0.05)';

            return (
              <g key={cellId}>
                {/* Background heat */}
                {cell && intensity > 0 && (
                  <rect
                    x={gridContentLeft + ci * cellW + 0.3}
                    y={gridContentTop + ri * cellH + 0.3}
                    width={cellW - 0.6}
                    height={cellH - 0.6}
                    rx={0.8}
                    fill={color}
                    opacity={0.03 + intensity * 0.12}
                  />
                )}
                {/* Intensity dot */}
                {cell && (
                  <>
                    <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.15 + intensity * 0.35} />
                    <circle cx={cx} cy={cy} r={r * 0.5} fill={color} opacity={0.3 + intensity * 0.4} filter={`url(#${uid}-cellGlow)`} />
                    {/* Count label */}
                    {cell.count > 1 && (
                      <text x={cx} y={cy + 0.35} textAnchor="middle" dominantBaseline="middle" fill="rgba(255,255,255,0.6)" fontSize={r > 2 ? '1.4' : '1'} fontFamily="monospace">
                        {cell.count}
                      </text>
                    )}
                  </>
                )}
                {/* Active pulse */}
                {cell?.isActive && (
                  <AnimatePresence>
                    <motion.circle
                      key={`pulse-${cellId}`}
                      cx={cx} cy={cy}
                      fill="none" stroke={color} strokeWidth="0.2"
                      initial={{ r: r * 0.5, opacity: 0.6 }}
                      animate={{ r: r * 2.5, opacity: 0 }}
                      transition={{ duration: 0.8, ease: 'easeOut', repeat: Infinity, repeatDelay: 0.3 }}
                    />
                  </AnimatePresence>
                )}
                {/* Empty cell marker */}
                {!cell && (
                  <circle cx={cx} cy={cy} r={0.3} fill="rgba(255,255,255,0.03)" />
                )}
              </g>
            );
          }))}

          {/* Row totals (right edge) */}
          {sourceRows.map((row, ri) => {
            let total = 0;
            for (const col of agentCols) {
              const cell = cells.get(`${row.id}::${col.id}`);
              if (cell) total += cell.count;
            }
            if (total === 0) return null;
            const cy = gridContentTop + ri * cellH + cellH / 2;
            const tx = gridContentLeft + nCols * cellW + 2;
            return (
              <text key={row.id} x={tx} y={cy + 0.3} textAnchor="start" fill="rgba(255,255,255,0.25)" fontSize="1.2" fontFamily="monospace">
                {total}
              </text>
            );
          })}

          {/* Column totals (bottom edge) */}
          {agentCols.map((col, ci) => {
            let total = 0;
            for (const row of sourceRows) {
              const cell = cells.get(`${row.id}::${col.id}`);
              if (cell) total += cell.count;
            }
            if (total === 0) return null;
            const cx = gridContentLeft + ci * cellW + cellW / 2;
            const ty = gridContentTop + nRows * cellH + 2.5;
            return (
              <text key={col.id} x={cx} y={ty} textAnchor="middle" fill="rgba(255,255,255,0.25)" fontSize="1.2" fontFamily="monospace">
                {total}
              </text>
            );
          })}

          {/* Intensity scale legend */}
          <g>
            <text x={GRID_LEFT} y={98} fill="rgba(255,255,255,0.2)" fontSize="1" fontFamily="monospace">low</text>
            {[0.1, 0.3, 0.5, 0.7, 0.9].map((v, i) => (
              <rect key={i} x={GRID_LEFT + 5 + i * 3} y={96.5} width={2.5} height={2} rx={0.3} fill="rgba(139,92,246,1)" opacity={0.05 + v * 0.4} />
            ))}
            <text x={GRID_LEFT + 21} y={98} fill="rgba(255,255,255,0.2)" fontSize="1" fontFamily="monospace">high</text>
          </g>
        </svg>

        {events.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="flex flex-col items-center gap-2 bg-background/40 backdrop-blur-sm border border-primary/10 rounded-2xl px-6 py-4">
              <span className="text-sm text-muted-foreground/40 font-mono">Idle</span>
              <span className="text-xs text-muted-foreground/30">Click <span className="text-purple-400/60 font-medium">Test Flow</span> to simulate traffic</span>
            </div>
          </div>
        )}
      </div>

      <EventLogSidebar events={events} onSelectEvent={onSelectEvent} />
    </div>
  );
}
