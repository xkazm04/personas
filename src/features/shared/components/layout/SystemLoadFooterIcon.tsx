// SystemLoadFooterIcon — a small, always-on CPU/RAM gauge in the footer's
// bottom-right cluster.
//
// A deliberately *soft* signal: it answers "does my machine have headroom for
// more local work?" — not "will my LLM provider let me run more agents?".
// Host load is influenced by every other process on the PC, so this is an
// advisory hint (run more / ease off), never a hard gate. Polls the cheap
// `get_system_metrics` command every ~2s while the window is visible; all the
// smoothing + banding lives in the pure `systemLoad` helpers.

import { useState, useEffect, useRef } from 'react';
import { Cpu } from 'lucide-react';
import { getSystemMetrics, type SystemMetrics } from '@/api/system/systemMetrics';
import { useDocumentVisibility } from '@/hooks/utility/useDocumentVisibility';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { ema, nextLoadLevel, type LoadLevel } from './systemLoad';

const POLL_MS = 2000;

const LEVEL_TONE: Record<LoadLevel, { icon: string; bar: string }> = {
  green: { icon: 'text-emerald-400', bar: 'bg-emerald-400' },
  amber: { icon: 'text-amber-400', bar: 'bg-amber-400' },
  red: { icon: 'text-red-400', bar: 'bg-red-400' },
};

const HEADROOM_KEY = {
  green: 'headroom_green',
  amber: 'headroom_amber',
  red: 'headroom_red',
} as const;

interface SystemLoad {
  level: LoadLevel;
  /** Smoothed CPU %. */
  cpu: number;
  /** Smoothed used-RAM %. */
  memUsedPct: number;
  /** Latest raw sample (for exact numbers in the tooltip). */
  metrics: SystemMetrics | null;
  /** True once at least one valid (non-first) sample has landed. */
  ready: boolean;
}

/** Poll host metrics on a timer, smoothing into a stable load level. */
function useSystemLoad(): SystemLoad {
  const visible = useDocumentVisibility();
  const cpuEma = useRef<number | null>(null);
  const memEma = useRef<number | null>(null);
  const levelRef = useRef<LoadLevel>('green');
  const [state, setState] = useState<SystemLoad>({
    level: 'green', cpu: 0, memUsedPct: 0, metrics: null, ready: false,
  });

  useEffect(() => {
    if (!visible) return; // pause polling when the window is hidden
    let cancelled = false;

    const tick = async () => {
      try {
        const m = await getSystemMetrics();
        if (cancelled) return;
        if (!m.sampleValid) {
          // First reading after start — CPU% not yet meaningful; keep the raw
          // sample for display but don't seed the smoother off a 0.
          setState((s) => ({ ...s, metrics: m }));
          return;
        }
        cpuEma.current = ema(cpuEma.current, m.cpuPercent);
        memEma.current = ema(memEma.current, m.memUsedPercent);
        levelRef.current = nextLoadLevel(levelRef.current, cpuEma.current, memEma.current);
        setState({
          level: levelRef.current,
          cpu: cpuEma.current,
          memUsedPct: memEma.current,
          metrics: m,
          ready: true,
        });
      } catch (err) {
        // Best-effort gauge — a transient IPC miss shouldn't surface to the user.
        silentCatch('features/shared/components/layout/SystemLoadFooterIcon:poll')(err);
      }
    };

    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, [visible]);

  return state;
}

function MiniBar({ pct, barClass }: { pct: number; barClass: string }) {
  return (
    <div className="h-[3px] w-full rounded-full bg-foreground/10 overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ease-out ${barClass}`}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </div>
  );
}

/** Footer CPU/RAM load gauge — an advisory "machine headroom" signal. */
export default function SystemLoadFooterIcon() {
  const { t, tx } = useTranslation();
  const { level, cpu, memUsedPct, metrics, ready } = useSystemLoad();
  const tone = LEVEL_TONE[level];

  const headroom = ready ? t.chrome.system_load[HEADROOM_KEY[level]] : t.chrome.system_load.measuring;
  // memAvailableMb is a u64 → bigint in the binding; widen to number for display.
  const freeGb = metrics ? (Number(metrics.memAvailableMb) / 1024).toFixed(1) : '—';
  const tooltip = ready
    ? `${tx(t.chrome.system_load.cpu, { pct: Math.round(cpu) })} · ${tx(t.chrome.system_load.ram, { pct: Math.round(memUsedPct), free: freeGb })} — ${headroom}`
    : t.chrome.system_load.measuring;

  return (
    <div
      className="flex items-center gap-1.5 px-0.5"
      role="status"
      aria-label={`${t.chrome.system_load.label}: ${headroom}`}
      title={tooltip}
      data-testid="footer-system-load"
    >
      <Cpu className={`w-3.5 h-3.5 transition-colors ${tone.icon}`} />
      <div className="flex flex-col gap-[2px] w-5" aria-hidden>
        <MiniBar pct={cpu} barClass={tone.bar} />
        <MiniBar pct={memUsedPct} barClass={tone.bar} />
      </div>
    </div>
  );
}
