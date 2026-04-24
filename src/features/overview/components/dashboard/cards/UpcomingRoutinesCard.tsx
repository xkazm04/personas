import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, ArrowRight } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useTranslation } from '@/i18n/useTranslation';
import { listAllTriggers } from '@/api/pipeline/triggers';
import { silentCatch } from '@/lib/silentCatch';
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

  useEffect(() => {
    let cancelled = false;
    listAllTriggers()
      .then((rows) => {
        if (!cancelled) {
          setTriggers(rows);
          setLoaded(true);
        }
      })
      .catch(silentCatch('dashboard/UpcomingRoutinesCard'));
    return () => { cancelled = true; };
  }, []);

  const rows = useMemo<UpcomingRow[]>(() => {
    const now = Date.now();
    const nameById = new Map(personas.map((p) => [p.id, p.name]));
    const scheduled = triggers
      .filter((tr) => tr.enabled && SCHEDULE_TRIGGER_TYPES.has(tr.trigger_type))
      .map<UpcomingRow>((tr) => ({
        trigger: tr,
        personaName: nameById.get(tr.persona_id) ?? tr.persona_id.slice(0, 8),
        nextAt: tr.next_trigger_at,
        rel: formatRelative(tr.next_trigger_at, now),
      }))
      .sort((a, b) => {
        const at = a.nextAt ? new Date(a.nextAt).getTime() : Infinity;
        const bt = b.nextAt ? new Date(b.nextAt).getTime() : Infinity;
        return at - bt;
      });
    return scheduled.slice(0, MAX_ROWS);
  }, [triggers, personas]);

  if (!loaded) return null;
  if (rows.length === 0) {
    return (
      <div className="rounded-modal border border-primary/10 bg-secondary/[0.03] overflow-hidden">
        <CardHeader
          label={t.overview.upcoming_routines.title}
          subtitle={t.overview.upcoming_routines.subtitle}
        />
        <div className="px-4 py-6 typo-body text-foreground/60 text-center">
          {t.overview.upcoming_routines.empty}
        </div>
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
              <div className="typo-caption text-foreground/60 truncate font-mono uppercase tracking-wider">
                {row.trigger.trigger_type}
              </div>
            </div>
            <div className="typo-caption font-mono tabular-nums flex-shrink-0">
              {row.rel ? (
                <span className={row.rel.overdue ? 'text-rose-400' : 'text-foreground/80'}>
                  {row.rel.label}
                </span>
              ) : (
                <span className="text-foreground/40">{t.overview.upcoming_routines.never_fired}</span>
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
        <span className="typo-caption font-mono uppercase tracking-[0.3em] text-foreground/70">
          {label}
        </span>
        {subtitle && (
          <span className="typo-caption text-foreground/40">{subtitle}</span>
        )}
      </div>
      <ArrowRight className="w-3 h-3 text-foreground/30" />
    </div>
  );
}
