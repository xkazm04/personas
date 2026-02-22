import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Zap, CheckCircle2, XCircle, Timer, TrendingUp } from 'lucide-react';
import { listExecutions } from '@/api/executions';
import { formatDuration } from '@/lib/utils/formatters';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

interface PersonaHoverPreviewProps {
  personaId: string;
  triggerCount: number | undefined;
  anchorRef: React.RefObject<HTMLElement | null>;
  visible: boolean;
}

/** Tiny inline sparkline drawn as an SVG path */
function Sparkline({ data }: { data: number[] }) {
  if (data.length === 0) return null;
  const max = Math.max(...data, 1);
  const w = 84;
  const h = 20;
  const step = w / (data.length - 1 || 1);

  const points = data.map((v, i) => ({
    x: i * step,
    y: h - (v / max) * (h - 2) - 1,
  }));

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
  const areaPath = `${linePath} L${w},${h} L0,${h} Z`;

  return (
    <svg width={w} height={h} className="flex-shrink-0" viewBox={`0 0 ${w} ${h}`}>
      <path d={areaPath} fill="url(#sparkGrad)" />
      <path d={linePath} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary/60" />
      <defs>
        <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.15" />
          <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function computeStats(executions: PersonaExecution[]) {
  const now = Date.now();
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  // Last execution
  const last = executions[0] ?? null;

  // Runs today
  const runsToday = executions.filter(e => {
    const t = e.started_at ?? e.created_at;
    return new Date(t).getTime() >= todayStart.getTime();
  }).length;

  // 7-day sparkline (one bucket per day, most recent = last element)
  const days = Array.from({ length: 7 }, () => 0);
  for (const e of executions) {
    const t = e.started_at ?? e.created_at;
    const daysAgo = Math.floor((now - new Date(t).getTime()) / 86_400_000);
    const idx = 6 - daysAgo;
    if (daysAgo >= 0 && daysAgo < 7 && days[idx] != null) {
      days[idx]++;
    }
  }

  // Success / failure counts (all loaded executions)
  const successCount = executions.filter(e => e.status === 'completed').length;
  const failCount = executions.filter(e => e.status === 'failed' || e.status === 'error').length;

  return { last, runsToday, sparkline: days, successCount, failCount };
}

export default function PersonaHoverPreview({ personaId, triggerCount, anchorRef, visible }: PersonaHoverPreviewProps) {
  const [executions, setExecutions] = useState<PersonaExecution[] | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Fetch executions when popover becomes visible
  useEffect(() => {
    if (!visible) {
      setExecutions(null);
      return;
    }
    let cancelled = false;
    listExecutions(personaId, 50).then(data => {
      if (!cancelled) setExecutions(data);
    }).catch(() => {
      if (!cancelled) setExecutions([]);
    });
    return () => { cancelled = true; };
  }, [personaId, visible]);

  // Position calculation
  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popW = 260;
    const popH = 200;

    let top = rect.top;
    let left = rect.right + 8;

    // If overflows right, position to left of the card
    if (left + popW > window.innerWidth - 8) {
      left = rect.left - popW - 8;
    }
    // If overflows bottom, shift up
    if (top + popH > window.innerHeight - 8) {
      top = window.innerHeight - popH - 8;
    }
    // If overflows top
    if (top < 8) top = 8;

    setPos({ top, left });
  }, [anchorRef]);

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    window.addEventListener('scroll', updatePosition, true);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('scroll', updatePosition, true);
      window.removeEventListener('resize', updatePosition);
    };
  }, [visible, updatePosition]);

  const stats = executions ? computeStats(executions) : null;

  return createPortal(
    <AnimatePresence>
      {visible && pos && (
        <motion.div
          ref={popoverRef}
          initial={{ opacity: 0, scale: 0.96, y: 4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 4 }}
          transition={{ duration: 0.15 }}
          className="fixed z-[9999] w-[260px] p-3.5 rounded-xl bg-background/95 backdrop-blur-xl border border-primary/15 shadow-xl shadow-black/20 pointer-events-none"
          style={{ top: pos.top, left: pos.left }}
        >
          {!stats ? (
            <div className="flex items-center justify-center py-4">
              <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Last Execution */}
              <div className="space-y-1">
                <div className="text-[10px] font-mono text-muted-foreground/40 uppercase tracking-wider">Last Execution</div>
                {stats.last ? (
                  <div className="flex items-center gap-2">
                    {stats.last.status === 'completed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : stats.last.status === 'failed' || stats.last.status === 'error' ? (
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 text-blue-400" />
                    )}
                    <span className={`text-xs font-medium ${
                      stats.last.status === 'completed' ? 'text-emerald-400/90' :
                      stats.last.status === 'failed' || stats.last.status === 'error' ? 'text-red-400/90' :
                      'text-blue-400/90'
                    }`}>
                      {stats.last.status}
                    </span>
                    {stats.last.duration_ms != null && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground/40 ml-auto font-mono">
                        <Timer className="w-3 h-3" />
                        {formatDuration(stats.last.duration_ms)}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground/30">No executions yet</span>
                )}
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded-lg bg-secondary/40 border border-primary/8">
                  <div className="text-[10px] text-muted-foreground/35 mb-0.5">Today</div>
                  <div className="text-sm font-semibold text-foreground/80 font-mono">{stats.runsToday}</div>
                </div>
                <div className="p-2 rounded-lg bg-secondary/40 border border-primary/8">
                  <div className="text-[10px] text-muted-foreground/35 mb-0.5 flex items-center gap-0.5">
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400/50" /> OK
                  </div>
                  <div className="text-sm font-semibold text-emerald-400/80 font-mono">{stats.successCount}</div>
                </div>
                <div className="p-2 rounded-lg bg-secondary/40 border border-primary/8">
                  <div className="text-[10px] text-muted-foreground/35 mb-0.5 flex items-center gap-0.5">
                    <XCircle className="w-2.5 h-2.5 text-red-400/50" /> Fail
                  </div>
                  <div className="text-sm font-semibold text-red-400/80 font-mono">{stats.failCount}</div>
                </div>
              </div>

              {/* Trigger Summary + Sparkline Row */}
              <div className="flex items-center justify-between gap-2">
                {triggerCount != null && triggerCount > 0 ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/50">
                    <Zap className="w-3 h-3 text-amber-400/60" />
                    <span>{triggerCount} trigger{triggerCount !== 1 ? 's' : ''} active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground/30">
                    <Zap className="w-3 h-3" />
                    <span>No triggers</span>
                  </div>
                )}

                {/* 7-day sparkline */}
                {stats.sparkline.some(v => v > 0) && (
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-muted-foreground/30" />
                    <Sparkline data={stats.sparkline} />
                  </div>
                )}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
