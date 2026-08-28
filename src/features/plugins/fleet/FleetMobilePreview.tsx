import { useMemo } from 'react';
import { Hourglass, Smartphone } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { FLEET_STATE_META, fleetStateCounts } from './fleetStateMeta';
import { useNowTick, formatAgo } from './relativeAgo';

/**
 * Mobile companion preview — a read-only render of the fleet glance view
 * inside a phone frame, fed by the operator's *live* session data. This lets
 * the remote glance surface be designed and validated locally, long before
 * the paired mobile client exists. It is deliberately non-interactive: it
 * mirrors what a phone would show, not a second control surface.
 *
 * The per-state chips read `FLEET_STATE_META` — the ONE palette + order every
 * fleet glance surface shares. This file used to keep a private six-entry copy
 * of that list, and the copy had drifted: `finished` and `hibernated` were
 * missing, so a fleet holding either counted them in the "N sessions" header
 * and then rendered no chip for them. The header and the chips disagreed, and
 * the two states it silently dropped are exactly the pair the rest of Fleet
 * treats as terminal — the same drift that once let the broadcast composer
 * target hibernated sessions.
 */

export function FleetMobilePreview() {
  const { t, tx } = useTranslation();
  const now = useNowTick();
  const sessions = useSystemStore(useShallow((s) => s.fleetSessions));

  const { counts, total, waitingItems } = useMemo(() => {
    const waiting: { name: string; lastActivityMs: number }[] = [];
    for (const s of sessions) {
      if (s.state === 'awaiting_input') {
        waiting.push({ name: s.name ?? s.projectLabel, lastActivityMs: Number(s.lastActivityMs) });
      }
    }
    return { counts: fleetStateCounts(sessions), total: sessions.length, waitingItems: waiting };
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
      <p className="text-[14px] text-foreground leading-relaxed mb-3">{t.plugins.fleet.preview_desc}</p>

      <div className="flex justify-center">
        {/* Phone frame */}
        <div className="relative w-[260px] rounded-[2.25rem] border-4 border-primary/20 bg-[#0a0a0c] p-2 shadow-elevation-2">
          <div className="absolute left-1/2 top-2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-primary/25" aria-hidden="true" />
          {/* Screen. NOT aria-hidden: the phone FRAME is decorative, but what
              is on the screen is the operator's real, live fleet — session
              totals, per-state counts, and which sessions are waiting on them.
              Hiding the whole subtree left a screen-reader user with the
              heading, the description, and then silence. Only the frame
              chrome (notch above) carries aria-hidden. */}
          <div
            className="mt-5 rounded-[1.6rem] bg-background/90 px-4 py-4 min-h-[300px]"
            data-testid="fleet-mobile-preview-screen"
          >
            <p className="typo-label text-foreground mb-0.5">Personas</p>
            <p className="text-[17px] font-semibold text-foreground">Fleet</p>
            <p className="text-[13px] text-foreground mb-3">{sessionCount}</p>

            {total === 0 ? (
              <p className="text-[14px] text-foreground py-8 text-center">{t.plugins.fleet.preview_no_sessions}</p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5 mb-4">
                  {FLEET_STATE_META.filter((m) => counts[m.id] > 0).map((m) => (
                    <span
                      key={m.id}
                      className="flex items-center gap-1.5 rounded-interactive border border-primary/10 bg-secondary/40 px-2 py-0.5 text-[13px] text-foreground"
                    >
                      <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden="true" />
                      <span>{t.plugins.fleet[m.labelKey]}</span>
                      <span className="font-semibold tabular-nums">{counts[m.id]}</span>
                    </span>
                  ))}
                </div>

                <div className="flex items-center gap-1.5 mb-1.5">
                  <Hourglass className="w-3 h-3 text-violet-400" aria-hidden="true" />
                  <span className="typo-label text-foreground">
                    {waitingItems.length === 1
                      ? tx(t.plugins.fleet.needs_input_one, { count: waitingItems.length })
                      : tx(t.plugins.fleet.needs_input_other, { count: waitingItems.length })}
                  </span>
                </div>
                {waitingItems.length === 0 ? (
                  <p className="text-[14px] text-emerald-300">{t.plugins.fleet.preview_all_clear}</p>
                ) : (
                  <ul className="space-y-1">
                    {waitingItems.map((item, i) => (
                      <li
                        key={`${item.name}-${i}`}
                        className="flex items-center justify-between gap-2 rounded-interactive border border-violet-400/25 bg-violet-400/10 px-2 py-1 text-[14px] text-violet-100"
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
