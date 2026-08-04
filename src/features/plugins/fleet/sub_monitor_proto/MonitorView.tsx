import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useSystemStore } from '@/stores/systemStore';
import { FleetTerminalPane } from '../FleetTerminalPane';
import { FleetTileStatusBlock } from '../FleetTileStatusBlock';
import { FleetStatusDots } from '../FleetStatusDots';
import { sessionsToMonitorModel } from './monitorModel';
import { useMonitorStats } from './useMonitorStats';
import { TerminalStats } from './monitorProtoMeta';
import { MonitorLedger } from './MonitorLedger';
import type { ProtoTerminal } from './monitorTypes';

/**
 * The minimized monitor layer inside the fullscreen grid overlay — the FUSED
 * variant (Ledger baseline + attention-lane grouping), living next to the
 * classic tile grid behind the header switcher.
 *
 * Zero xterms mounted while monitoring — near-free at any fleet size.
 * Clicking a row focuses the session (parent `onSelect`, so the terminal
 * manager + Athena targeting follow) and expands the REAL terminal pane
 * fullscreen via the shared layoutId. Both close paths return HERE, not out
 * of Fleet: Escape is intercepted in the capture phase (before the overlay's
 * Escape-to-minimize), and the titlebar Back button is re-pointed at the
 * pane while it's open, restoring the overlay's minimize interceptor after.
 *
 * Stats come from `fleet_monitor_stats` (one IPC for the whole fleet, polled
 * only while this view is mounted); sessions with no bound transcript keep the
 * per-session simulation — see monitorModel.ts.
 */
export function MonitorView({
  sessions, onSelect, onOverlayClose,
}: {
  sessions: FleetSession[];
  onSelect: (id: string) => void;
  /** The overlay's own minimize — restored as the Back interceptor when the
   *  fullscreen pane closes (the overlay registered it while opening). */
  onOverlayClose: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  // The row that currently owns the `proto-term-<id>` shared layout id. It is
  // armed a frame BEFORE `openId` (framer needs a measured box on the row to
  // animate from) and released only once the fullscreen pane has finished its
  // exit — otherwise the collapse would have no target to fly back to.
  const [armedId, setArmedId] = useState<string | null>(null);
  const setBackInterceptor = useSystemStore((s) => s.setBackInterceptor);
  const stats = useMonitorStats();
  const prevModel = useRef<ProtoTerminal[]>([]);
  const model = useMemo(() => {
    const next = sessionsToMonitorModel(sessions, stats, prevModel.current);
    prevModel.current = next;
    return next;
  }, [sessions, stats]);
  const openTerm = openId ? model.find((m) => m.id === openId) ?? null : null;
  const openSession = openId ? sessions.find((s) => s.id === openId) ?? null : null;

  const armedRef = useRef<string | null>(null);
  const arm = useCallback((id: string | null) => {
    armedRef.current = id;
    setArmedId(id);
  }, []);
  const onOpen = useCallback((t: ProtoTerminal) => {
    onSelect(t.id);
    // Pointer-down already armed this row a frame ago — expand immediately.
    // Any other entry path (keyboard, synthetic click) arms now and defers the
    // expand by one frame so the row's motion node gets measured first.
    if (armedRef.current === t.id) {
      setOpenId(t.id);
      return;
    }
    arm(t.id);
    requestAnimationFrame(() => setOpenId(t.id));
  }, [onSelect, arm]);

  // While the fullscreen pane is open, BOTH back affordances collapse to the
  // monitor instead of leaving it: Escape (capture, ahead of the overlay's
  // bubble handler) and the global titlebar Back (interceptor nesting).
  useEffect(() => {
    if (!openId) return;
    setBackInterceptor(() => setOpenId(null));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpenId(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      setBackInterceptor(onOverlayClose);
    };
  }, [openId, setBackInterceptor, onOverlayClose]);

  // Session left the registry while fullscreen (killed/removed) — fall back.
  useEffect(() => {
    if (openId && !sessions.some((s) => s.id === openId)) setOpenId(null);
  }, [openId, sessions]);

  const tombstone = openSession && (openSession.state === 'exited' || openSession.state === 'hibernated');
  const showsTerminal = openSession && !tombstone && openSession.mode !== 'headless';

  return (
    <LayoutGroup>
      <div className="relative flex-1 min-h-0 flex flex-col">
        <MonitorLedger fleet={model} onOpen={onOpen} onArm={arm} armedId={armedId} />
        {/* The armed row keeps its shared layout id until the pane has fully
            collapsed back onto it — releasing earlier would strand the exit. */}
        <AnimatePresence onExitComplete={() => arm(null)}>
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
