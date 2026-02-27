import { useEffect, useRef, useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, Zap, CheckCircle2, XCircle, TrendingUp } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import type { PersonaHealth } from '@/lib/bindings/PersonaHealth';

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

export default function PersonaHoverPreview({ personaId, triggerCount, anchorRef, visible }: PersonaHoverPreviewProps) {
  const healthMap = usePersonaStore(s => s.personaHealthMap);
  const health: PersonaHealth | undefined = healthMap[personaId];
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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

  // Derive stats from the unified health model
  const successCount = health
    ? health.recentStatuses.filter(s => s === 'completed').length
    : 0;
  const failCount = health
    ? health.recentStatuses.filter(s => s === 'failed' || s === 'error').length
    : 0;
  const lastStatus = health?.recentStatuses[0] ?? null;

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
          data-testid={`persona-hover-preview-${personaId}`}
        >
          {!health ? (
            <div className="flex items-center justify-center py-4">
              <span className="text-sm text-muted-foreground/80">No data</span>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Last Execution */}
              <div className="space-y-1">
                <div className="text-sm font-mono text-muted-foreground/80 uppercase tracking-wider">Last Execution</div>
                {lastStatus ? (
                  <div className="flex items-center gap-2">
                    {lastStatus === 'completed' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    ) : lastStatus === 'failed' || lastStatus === 'error' ? (
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    ) : (
                      <Activity className="w-3.5 h-3.5 text-blue-400" />
                    )}
                    <span className={`text-sm font-medium ${
                      lastStatus === 'completed' ? 'text-emerald-400/90' :
                      lastStatus === 'failed' || lastStatus === 'error' ? 'text-red-400/90' :
                      'text-blue-400/90'
                    }`}>
                      {lastStatus}
                    </span>
                    <span className="text-sm text-muted-foreground/60 ml-auto font-mono">
                      {Math.round(health.successRate * 100)}% ok
                    </span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground/80">No executions yet</span>
                )}
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-2">
                <div className="p-2 rounded-lg bg-secondary/40 border border-primary/8">
                  <div className="text-sm text-muted-foreground/35 mb-0.5">Today</div>
                  <div className="text-sm font-semibold text-foreground/80 font-mono" data-testid="hover-runs-today">{health.runsToday}</div>
                </div>
                <div className="p-2 rounded-lg bg-secondary/40 border border-primary/8">
                  <div className="text-sm text-muted-foreground/35 mb-0.5 flex items-center gap-0.5">
                    <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400/50" /> OK
                  </div>
                  <div className="text-sm font-semibold text-emerald-400/80 font-mono" data-testid="hover-success-count">{successCount}</div>
                </div>
                <div className="p-2 rounded-lg bg-secondary/40 border border-primary/8">
                  <div className="text-sm text-muted-foreground/35 mb-0.5 flex items-center gap-0.5">
                    <XCircle className="w-2.5 h-2.5 text-red-400/50" /> Fail
                  </div>
                  <div className="text-sm font-semibold text-red-400/80 font-mono" data-testid="hover-fail-count">{failCount}</div>
                </div>
              </div>

              {/* Trigger Summary + Sparkline Row */}
              <div className="flex items-center justify-between gap-2">
                {triggerCount != null && triggerCount > 0 ? (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground/90">
                    <Zap className="w-3 h-3 text-amber-400/60" />
                    <span>{triggerCount} trigger{triggerCount !== 1 ? 's' : ''} active</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-sm text-muted-foreground/80">
                    <Zap className="w-3 h-3" />
                    <span>No triggers</span>
                  </div>
                )}

                {/* 7-day sparkline from unified health */}
                {health.sparkline.some(v => v > 0) && (
                  <div className="flex items-center gap-1.5">
                    <TrendingUp className="w-3 h-3 text-muted-foreground/80" />
                    <Sparkline data={health.sparkline} />
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
