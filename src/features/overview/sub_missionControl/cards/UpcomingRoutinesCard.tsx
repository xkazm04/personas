import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, ArrowRight } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { listAllTriggers } from '@/api/pipeline/triggers';
import { silentCatch } from '@/lib/silentCatch';
import { EmptyState } from '@/features/shared/components/display/EmptyState';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

const MAX_ROWS = 5;
const SCHEDULE_TRIGGER_TYPES = new Set(['schedule', 'cron', 'polling']);

function formatRelative(iso: string | null, nowMs: number): { label: string; overdue: boolean } | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const diffMs = t - nowMs;
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);
  let label: string;
  if (mins < 1) label = 'now';
  else if (mins < 60) label = `${mins}m`;
  else if (hours < 48) label = `${hours}h`;
  else label = `${days}d`;
  return { label: overdue ? `-${label}` : label, overdue };
}

interface UpcomingRow {
  trigger: PersonaTrigger;
  personaName: string;
  nextAt: string | null;
  rel: { label: string; overdue: boolean } | null;
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
        rel: formatRelative(tr.next_trigger_at, now),
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

  if (!loaded) return null;
  if (rows.length === 0) {
    return (
      <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
        <CardHeader
          label={t.overview.upcoming_routines.title}
          subtitle={t.overview.upcoming_routines.subtitle}
        />
        <EmptyState variant="routines" heading={t.overview.upcoming_routines.empty} dominant className="py-6" />
      </div>
    );
  }

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
      <CardHeader
        label={t.overview.upcoming_routines.title}
        subtitle={t.overview.upcoming_routines.subtitle}
      />
      <div className="divide-y divide-primary/5">
        {rows.map((row) => (
          <div
            key={row.trigger.id}
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
          </div>
        ))}
      </div>
    </div>
  );
}

function CardHeader({ label, subtitle }: { label: string; subtitle?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-primary/[0.04]">
      <div className="flex items-baseline gap-2">
        <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground">
          {label}
        </span>
        {subtitle && (
          <span className="typo-caption text-foreground">{subtitle}</span>
        )}
      </div>
      <ArrowRight className="w-3 h-3 text-foreground" />
    </div>
  );
}
