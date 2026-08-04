import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { FleetTerminalPane } from '../FleetTerminalPane';
import { FleetTileStatusBlock } from '../FleetTileStatusBlock';
import { FleetStatusDots } from '../FleetStatusDots';
import { sessionsToMonitorModel } from './monitorModel';
import { TerminalStats } from './monitorProtoMeta';
import { VariantHeatboard } from './VariantHeatboard';
import { VariantTriageLanes } from './VariantTriageLanes';
import { VariantLedger } from './VariantLedger';
import type { ProtoTerminal } from './mockFleet';

export type MonitorVariantId = 'heatboard' | 'lanes' | 'ledger';

/**
 * REAL-DATA monitor layer inside the fullscreen grid overlay (/prototype r2).
 *
 * Renders live fleet sessions through one of the three minimized variants —
 * zero xterms mounted, so this layer is near-free at any fleet size. Clicking
 * a terminal focuses it (parent `onSelect`, so the terminal manager + Athena
 * targeting follow) and expands the REAL terminal pane fullscreen via the
 * shared layoutId; Escape / back collapses to the monitor (capture-phase
 * handler so the overlay's own Escape-to-minimize doesn't fire).
 *
 * Stats not yet backend-wired (subprocs / subagents / cost) are simulated
 * per-session — see monitorModel.ts.
 */
export function MonitorView({
  sessions, variant, onSelect,
}: {
  sessions: FleetSession[];
  variant: MonitorVariantId;
  onSelect: (id: string) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const model = useMemo(() => sessionsToMonitorModel(sessions), [sessions]);
  const openTerm = openId ? model.find((m) => m.id === openId) ?? null : null;
  const openSession = openId ? sessions.find((s) => s.id === openId) ?? null : null;

  const onOpen = (t: ProtoTerminal) => {
    onSelect(t.id);
    setOpenId(t.id);
  };

  // Close the fullscreen pane on Escape BEFORE the overlay's own bubble-phase
  // Escape handler minimizes the whole grid.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [openId]);

  // Session left the registry while fullscreen (killed/removed) — fall back.
  useEffect(() => {
    if (openId && !sessions.some((s) => s.id === openId)) setOpenId(null);
  }, [openId, sessions]);

  const tombstone = openSession && (openSession.state === 'exited' || openSession.state === 'hibernated');
  const showsTerminal = openSession && !tombstone && openSession.mode !== 'headless';

  return (
    <LayoutGroup>
      <div className="relative flex-1 min-h-0">
        {variant === 'heatboard' && <VariantHeatboard fleet={model} onOpen={onOpen} />}
        {variant === 'lanes' && <VariantTriageLanes fleet={model} onOpen={onOpen} />}
        {variant === 'ledger' && <VariantLedger fleet={model} onOpen={onOpen} />}
        <AnimatePresence>
          {openTerm && openSession && (
            <motion.div
              key={openTerm.id}
              layoutId={`proto-term-${openTerm.id}`}
              className="absolute inset-0 z-30 flex flex-col rounded-modal border border-primary/25 bg-[#0a0a0c] overflow-hidden shadow-elevation-4"
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/20 shrink-0">
                <button
                  type="button"
                  data-testid="fleet-monitor-fullscreen-back"
                  onClick={() => setOpenId(null)}
                  aria-label="Back to monitor"
                  className="p-1 rounded-interactive text-foreground hover:bg-secondary/50 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <FleetStatusDots state={openSession.state} reason={openSession.stateReason} />
                <span className="typo-body font-medium text-foreground truncate">
                  {openSession.name ?? openSession.title ?? openSession.projectLabel}
                </span>
                <span className="typo-caption text-foreground opacity-50">{openSession.projectLabel}</span>
                <div className="flex-1" />
                <TerminalStats t={openTerm} />
              </div>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.12, duration: 0.2 }}
                className="flex-1 min-h-0"
              >
                {showsTerminal ? (
                  <FleetTerminalPane sessionId={openSession.id} autoFocus />
                ) : (
                  <FleetTileStatusBlock session={openSession} />
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}
