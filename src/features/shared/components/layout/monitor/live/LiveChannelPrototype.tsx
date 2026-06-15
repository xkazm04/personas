/* eslint-disable custom/no-hardcoded-jsx-text -- throwaway /prototype demo harness; the control panel is deleted at consolidation, only the variant overlays ship. */
// LIVE-MODE PROTOTYPE HOST.
//
// Mounted at App root (sibling to ToastContainer) so the corner overlay floats
// over the whole app whether or not the Persona Monitor is open. It owns the
// shared queue engine — message accumulation, click-to-dismiss, the natural
// auto-timeout, and hover-pause — and delegates presentation to the active
// directional variant. The top control strip is a THROWAWAY A/B harness: flip
// variants + fire demo traffic to feel the motion + queue behaviour live. At
// consolidation this is replaced by the real useTeamChannel feed projection +
// the on/off toggle wired into the Channels → Timeline view.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { Send, Zap, Play, Pause, RotateCcw } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { LiveCommsStack } from './LiveCommsStack';
import { LiveTeamLanes } from './LiveTeamLanes';
import { LivePulseStrip } from './LivePulseStrip';
import { LIVE_TTL_MS, type LiveMessage, type LiveVariantProps } from './liveModel';
import { makeMessage, makeBurst } from './demo';

type Variant = 'off' | 'stack' | 'lanes' | 'pulse';

const CAP = 30;        // bound the accumulated window
const TICK_MS = 300;   // auto-expire resolution
const AUTO_MS = 2600;  // auto-stream cadence

const VARIANTS: { id: Variant; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'stack', label: 'A · Comms Stack' },
  { id: 'lanes', label: 'B · Team Lanes' },
  { id: 'pulse', label: 'C · Pulse Strip' },
];

export function LiveChannelPrototype() {
  const [variant, setVariant] = useState<Variant>('stack');
  const [incoming, setIncoming] = useState<LiveMessage[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [auto, setAuto] = useState(false);
  const reducedMotion = useReducedMotion() ?? false;

  // Refs read by the interval/callbacks without re-arming them.
  const incomingRef = useRef(incoming);
  incomingRef.current = incoming;
  const pauseStart = useRef(new Map<string, number>()); // id → ms when hover-paused
  const pausedTotal = useRef(new Map<string, number>()); // id → accumulated paused ms

  const push = useCallback((msgs: LiveMessage[]) => {
    setIncoming((prev) => [...msgs, ...prev].slice(0, CAP));
  }, []);

  const onDismiss = useCallback((id: string) => setDismissed((p) => new Set(p).add(id)), []);
  const onDismissAll = useCallback(
    () => setDismissed(new Set(incomingRef.current.map((m) => m.id))),
    [],
  );
  const onHover = useCallback((id: string, hovered: boolean) => {
    if (hovered) {
      pauseStart.current.set(id, Date.now());
    } else {
      const started = pauseStart.current.get(id);
      if (started != null) {
        pausedTotal.current.set(id, (pausedTotal.current.get(id) ?? 0) + (Date.now() - started));
        pauseStart.current.delete(id);
      }
    }
  }, []);
  const onOpenTimeline = useCallback(() => {
    // Prototype redirect — open the Monitor (Channels → Timeline deep-link is a
    // consolidation follow-up). Real wiring will set channel view + team filter.
    useSystemStore.getState().setHeaderOverlay('monitor');
  }, []);
  const reset = useCallback(() => {
    setIncoming([]);
    setDismissed(new Set());
    pauseStart.current.clear();
    pausedTotal.current.clear();
  }, []);

  // Natural auto-timeout — expire non-paused messages once they out-live the TTL.
  useEffect(() => {
    if (variant === 'off') return;
    const iv = setInterval(() => {
      const now = Date.now();
      setDismissed((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (const m of incomingRef.current) {
          if (next.has(m.id) || pauseStart.current.has(m.id)) continue;
          const age = now - m.receivedAt - (pausedTotal.current.get(m.id) ?? 0);
          if (age >= LIVE_TTL_MS) { next.add(m.id); changed = true; }
        }
        return changed ? next : prev;
      });
    }, TICK_MS);
    return () => clearInterval(iv);
  }, [variant]);

  // Auto-stream demo traffic.
  useEffect(() => {
    if (!auto || variant === 'off') return;
    const iv = setInterval(() => push([makeMessage()]), AUTO_MS);
    return () => clearInterval(iv);
  }, [auto, variant, push]);

  const live = incoming.filter((m) => !dismissed.has(m.id));
  const props: LiveVariantProps = { messages: live, onDismiss, onDismissAll, onOpenTimeline, onHover, reducedMotion };

  const ctrlBtn = 'inline-flex items-center gap-1.5 rounded-full border border-primary/15 bg-secondary/30 px-2.5 py-1 typo-caption text-foreground/80 transition-colors hover:bg-secondary/50';

  return (
    <>
      {/* THROWAWAY harness control strip. */}
      <div className="fixed top-12 right-4 z-[55] flex items-center gap-2 rounded-full border border-amber-500/30 bg-background/90 px-2 py-1.5 shadow-elevation-3 backdrop-blur-md">
        <span className="px-1 typo-caption font-semibold uppercase tracking-wider text-amber-400">Live proto</span>
        <div className="flex items-center gap-0.5 rounded-full bg-secondary/20 p-0.5">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              onClick={() => setVariant(v.id)}
              aria-pressed={variant === v.id}
              className={`rounded-full px-2.5 py-0.5 typo-caption transition-colors ${
                variant === v.id ? 'bg-primary/15 font-medium text-foreground' : 'text-foreground/50 hover:text-foreground/80'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <span className="h-4 w-px bg-primary/15" />
        <button type="button" onClick={() => push([makeMessage()])} className={ctrlBtn}><Send className="h-3 w-3" /> Send 1</button>
        <button type="button" onClick={() => push(makeBurst(3))} className={ctrlBtn}><Zap className="h-3 w-3" /> Burst ×3</button>
        <button
          type="button"
          onClick={() => setAuto((v) => !v)}
          aria-pressed={auto}
          className={`${ctrlBtn} ${auto ? 'border-status-success/40 bg-status-success/15 text-status-success' : ''}`}
        >
          {auto ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />} Auto
        </button>
        <button type="button" onClick={reset} className={ctrlBtn} title="Reset"><RotateCcw className="h-3 w-3" /></button>
      </div>

      {variant === 'stack' && <LiveCommsStack {...props} />}
      {variant === 'lanes' && <LiveTeamLanes {...props} />}
      {variant === 'pulse' && <LivePulseStrip {...props} />}
    </>
  );
}

export default LiveChannelPrototype;
