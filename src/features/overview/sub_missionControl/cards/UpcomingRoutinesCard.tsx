import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ArrowRight } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { listAllTriggers } from '@/api/pipeline/triggers';
import { silentCatch } from '@/lib/silentCatch';
import { IllustratedEmptyState as EmptyState } from '@/features/shared/components/display/IllustratedEmptyState';
import { formatRelativeShort, type RelativeShortResult } from '@/features/overview/libs/formatRelativeShort';
import { PaneHeader } from '../PaneHeader';
import { RevealItem } from '@/features/shared/components/display/RevealItem';
import { useRevealTracker } from '@/hooks/utility/interaction/useProgressiveReveal';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

const MAX_ROWS = 5;
const SCHEDULE_TRIGGER_TYPES = new Set(['schedule', 'cron', 'polling']);
const ROW_HEIGHT = 44;
const GHOST_BAR = 'rounded bg-primary/[0.06]';
const GHOST_NAME_WIDTHS = ['w-32', 'w-24', 'w-28'];

interface UpcomingRow {
  trigger: PersonaTrigger;
  personaName: string;
  nextAt: string | null;
  rel: RelativeShortResult | null;
}

export default function UpcomingRoutinesCard() {
  const { t } = useTranslation();
  const personas = useAgentStore((s) => s.personas);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>([]);
  const [loaded, setLoaded] = useState(false);
  // Ticking clock: the card stays mounted for the whole session, so a `now`
  // captured once at render froze every relative time and never re-ran the
  // "drop past runs" filter — a routine 2m out read "2m" ten minutes later and
  // fired routines lingered as upcoming. Bump on an interval (and on tab
  // re-show) so the memo recomputes against the current time.
  const [nowTick, setNowTick] = useState(() => Date.now());
  // Guards against overlapping in-flight refetches (a slow request must not be
  // stacked by the next tick).
  const fetchingRef = useRef(false);

  // Load triggers on mount AND refetch on the same 30s/visibility cadence as
  // `nowTick`. The clock alone only re-filters the already-fetched list, so as
  // each `next_trigger_at` elapses its row is dropped (the past-time filter
  // below) and never rolls forward — after ~1h the card empties while routines
  // are still scheduled. Re-pulling pulls the scheduler's advanced
  // `next_trigger_at`, so the list rolls to the next occurrence instead.
  useEffect(() => {
    let cancelled = false;
    const refetch = () => {
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      listAllTriggers()
        .then((rows) => {
          if (!cancelled) {
            setTriggers(rows);
            setLoaded(true);
          }
        })
        .catch(silentCatch('dashboard/UpcomingRoutinesCard'))
        .finally(() => {
          fetchingRef.current = false;
        });
    };
    refetch();
    const tick = () => {
      if (!document.hidden) {
        setNowTick(Date.now());
        refetch();
      }
    };
    const id = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const rows = useMemo<UpcomingRow[]>(() => {
    const now = nowTick;
    const nameById = new Map(personas.map((p) => [p.id, p.name]));
    const scheduled = triggers
      .filter((tr) => tr.enabled && SCHEDULE_TRIGGER_TYPES.has(tr.trigger_type))
      .map<UpcomingRow>((tr) => ({
        trigger: tr,
        personaName: nameById.get(tr.persona_id) ?? tr.persona_id.slice(0, 8),
        nextAt: tr.next_trigger_at,
        rel: formatRelativeShort(tr.next_trigger_at, { now, signed: true, hourCutoff: 48 }),
      }))
      // Only genuinely-upcoming runs: a next-run time in the future, or a
      // schedule still pending its first computed run (null). A next-run time
      // in the PAST means the scheduler never advanced it (no leader instance
      // ticking, or a one-shot that already fired) — those aren't "upcoming"
      // and previously rendered here as misleading overdue rows, so drop them.
      .filter((row) => row.nextAt === null || new Date(row.nextAt).getTime() >= now)
      .sort((a, b) => {
        const at = a.nextAt ? new Date(a.nextAt).getTime() : Infinity;
        const bt = b.nextAt ? new Date(b.nextAt).getTime() : Infinity;
        return at - bt;
      });
    return scheduled.slice(0, MAX_ROWS);
  }, [triggers, personas, nowTick]);

  // No filter/context switch exists for this card — the reveal tracker never
  // resets, so a row's one-shot cascade never replays across the 30s/
  // visibility refetch loop above (same ids keep coming back).
  const enter = useRevealTracker();
  // Ghosts ONLY into genuine emptiness while the first fetch is in flight;
  // once `loaded` is true (even with zero rows) the settled empty state
  // takes over. Data already on screen from a warm store paints instantly —
  // `loaded` never hides it.
  const showGhost = !loaded && rows.length === 0;

  // Frame (header) renders immediately — the title/subtitle are static i18n
  // strings, never gated on data. Only the row region has three states:
  // ghost (fetch in flight, nothing yet) / empty (settled, none scheduled) /
  // rows (real data, instant paint + one-shot cascade).
  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <PaneHeader
        label={t.overview.upcoming_routines.title}
        subtitle={t.overview.upcoming_routines.subtitle}
      >
        <ArrowRight className="w-3 h-3 text-foreground" />
      </PaneHeader>
      {showGhost ? (
        <RoutinesGhostRows />
      ) : rows.length === 0 ? (
        <EmptyState variant="routines" heading={t.overview.upcoming_routines.empty} dominant className="py-6" />
      ) : (
        <div className="divide-y divide-primary/5">
          {rows.map((row, index) => (
            <RevealItem
              key={row.trigger.id}
              revealId={row.trigger.id}
              order={index}
              hasEntered={enter.hasEntered}
              markEntered={enter.markEntered}
              className="flex items-center gap-3 px-3 py-2"
            >
              <CalendarClock className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="typo-body text-foreground truncate">{row.personaName}</div>
                <div className="typo-caption text-foreground truncate font-mono uppercase tracking-wider">
                  {row.trigger.trigger_type}
                </div>
              </div>
              <div className="typo-caption font-mono tabular-nums flex-shrink-0">
                {row.rel ? (
                  <span className={row.rel.overdue ? 'text-rose-400' : 'text-foreground'}>
                    {row.rel.label}
                  </span>
                ) : (
                  <span className="text-foreground">{t.overview.upcoming_routines.never_fired}</span>
                )}
              </div>
            </RevealItem>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RoutinesGhostRows — calm, geometry-matched ghost for the only moment the
// row region has nothing yet (first fetch in flight, cold store). Each bar
// enters via `animate-fade-in` behind a ≥120ms staggered delay (fill-mode
// both) so a fast fetch skips them entirely — no timers, no held content.
// ---------------------------------------------------------------------------
function RoutinesGhostRows() {
  return (
    <div className="divide-y divide-primary/5" aria-hidden="true">
      {Array.from({ length: 3 }).map((_, i) => {
        const nameW = GHOST_NAME_WIDTHS[i % GHOST_NAME_WIDTHS.length];
        return (
          <div
            key={i}
            className="flex items-center gap-3 px-3 py-2 animate-fade-in"
            style={{ height: ROW_HEIGHT, animationDelay: `${120 + i * 35}ms` }}
          >
            <span className="w-3.5 h-3.5 rounded-full bg-primary/[0.06] flex-shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <span className={`block h-3 ${nameW} max-w-full ${GHOST_BAR}`} />
              <span className={`block h-2.5 w-16 ${GHOST_BAR}`} />
            </div>
            <span className="h-2.5 w-10 flex-shrink-0 rounded bg-primary/[0.06]" />
          </div>
        );
      })}
    </div>
  );
}
