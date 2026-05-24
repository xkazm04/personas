import { useMemo } from 'react';
import { Hourglass, Smartphone } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { FleetLabelKey } from './FleetStatusDots';
import { useNowTick, formatAgo } from './relativeAgo';

/**
 * Mobile companion preview — a read-only render of the fleet glance view
 * inside a phone frame, fed by the operator's *live* session data. This lets
 * the remote glance surface be designed and validated locally, long before
 * the paired mobile client exists. It is deliberately non-interactive: it
 * mirrors what a phone would show, not a second control surface.
 */

const GLANCE_STATES: ReadonlyArray<{ id: FleetSessionState; dot: string; labelKey: FleetLabelKey }> = [
  { id: 'awaiting_input', dot: 'bg-violet-400', labelKey: 'state_awaiting_input' },
  { id: 'running', dot: 'bg-blue-400', labelKey: 'state_working' },
  { id: 'spawning', dot: 'bg-cyan-400', labelKey: 'state_spawning' },
  { id: 'idle', dot: 'bg-emerald-400', labelKey: 'state_idle' },
  { id: 'stale', dot: 'bg-orange-400', labelKey: 'state_stale' },
  { id: 'exited', dot: 'bg-zinc-500', labelKey: 'state_exited' },
];

export function FleetMobilePreview() {
  const { t, tx } = useTranslation();
  const now = useNowTick();
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));

  const { counts, total, waitingItems } = useMemo(() => {
    const c: Record<FleetSessionState, number> = {
      spawning: 0, running: 0, awaiting_input: 0, idle: 0, stale: 0, exited: 0,
    };
    const waiting: { name: string; lastActivityMs: number }[] = [];
    for (const s of sessions) {
      c[s.state] += 1;
      if (s.state === 'awaiting_input') {
        waiting.push({ name: s.name ?? s.projectLabel, lastActivityMs: Number(s.lastActivityMs) });
      }
    }
    return { counts: c, total: sessions.length, waitingItems: waiting };
  }, [sessions]);

  const sessionCount =
    total === 1
      ? tx(t.plugins.fleet.sessions_one, { count: total })
      : tx(t.plugins.fleet.sessions_other, { count: total });

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-4 bg-secondary/20"
      data-testid="fleet-mobile-preview"
    >
      <div className="flex items-center gap-2 mb-1">
        <Smartphone className="w-4 h-4 text-primary" aria-hidden="true" />
        <p className="typo-caption font-medium text-foreground">{t.plugins.fleet.preview_title}</p>
      </div>
      <p className="text-[12px] text-foreground leading-relaxed mb-3">{t.plugins.fleet.preview_desc}</p>

      <div className="flex justify-center">
        {/* Phone frame */}
        <div className="relative w-[260px] rounded-[2.25rem] border-4 border-primary/20 bg-[#0a0a0c] p-2 shadow-elevation-2">
          <div className="absolute left-1/2 top-2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-primary/25" aria-hidden="true" />
          {/* Screen */}
          <div className="mt-5 rounded-[1.6rem] bg-background/90 px-4 py-4 min-h-[300px]" aria-hidden="true">
            <p className="typo-label uppercase tracking-wider text-foreground mb-0.5">Personas</p>
            <p className="text-[15px] font-semibold text-foreground">Fleet</p>
            <p className="text-[11px] text-foreground mb-3">{sessionCount}</p>

            {total === 0 ? (
              <p className="text-[12px] text-foreground py-8 text-center">{t.plugins.fleet.preview_no_sessions}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {GLANCE_STATES.filter((m) => counts[m.id] > 0).map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1.5 rounded-interactive border border-primary/10 bg-secondary/40 px-2 py-0.5 text-[11px] text-foreground"
                    >
                      <span className={`h-2 w-2 rounded-full ${m.dot}`} />
                      <span>{t.plugins.fleet[m.labelKey]}</span>
                      <span className="font-semibold tabular-nums">{counts[m.id]}</span>
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 mb-1.5">
                  <Hourglass className="w-3 h-3 text-violet-400" />
                  <span className="typo-label uppercase tracking-wider text-foreground">
                    {waitingItems.length === 1
                      ? tx(t.plugins.fleet.needs_input_one, { count: waitingItems.length })
                      : tx(t.plugins.fleet.needs_input_other, { count: waitingItems.length })}
                  </span>
                </div>
                {waitingItems.length === 0 ? (
                  <p className="text-[12px] text-emerald-300">{t.plugins.fleet.preview_all_clear}</p>
                ) : (
                  <ul className="space-y-1">
                    {waitingItems.map((item, i) => (
                      <li
                        key={`${item.name}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-interactive border border-violet-400/25 bg-violet-400/10 px-2 py-1 text-[12px] text-violet-100"
                      >
                        <span className="truncate">{item.name}</span>
                        <span className="shrink-0 text-violet-300/80">{formatAgo(t, item.lastActivityMs, now)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
