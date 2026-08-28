import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { silentCatch } from '@/lib/silentCatch';
import { listAutonomouslyHandledIncidents } from '@/api/overview/incidents';
import { severityShapeStatus, sourceTableLabel } from '../libs/incidentTaxonomy';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

const LANE_LIMIT = 12;

/**
 * "Handled autonomously" lane (Autonomous NOC v1).
 *
 * Lists incidents the system continued/handled without a human click —
 * today that is the incident-continuation loop's `continued_at` stamp.
 * Deliberately sparse in v1: the empty state is honest about it rather than
 * padding the lane with human-resolved rows.
 */
export function AutonomousLane({
  onOpenIncident,
}: {
  onOpenIncident: (incident: AuditIncident) => void;
}) {
  const { t } = useTranslation();
  const [incidents, setIncidents] = useState<AuditIncident[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listAutonomouslyHandledIncidents(LANE_LIMIT);
        if (!cancelled) setIncidents(rows);
      } catch (err) {
        silentCatch('AutonomousLane:list')(err);
        if (!cancelled) setIncidents([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Still loading: render nothing — the lane is secondary chrome and must
  // never hold the inbox hostage with a spinner.
  if (incidents === null) return null;

  return (
    <div className="mx-4 mb-2 rounded-card border border-primary/10 bg-secondary/20">
      <div className="flex flex-wrap items-center gap-2 px-3.5 pt-2.5 pb-1.5">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden="true" />
        <h3 className="typo-overline text-foreground">{t.overview.incidents.noc_handled_title}</h3>
        {incidents.length > 0 && (
          <AthenaComposedBadge variant="handled" label={t.overview.incidents.noc_handled_by} />
        )}
      </div>
      {incidents.length === 0 ? (
        <p className="px-3.5 pb-2.5 typo-caption text-foreground">
          {t.overview.incidents.noc_handled_empty}
        </p>
      ) : (
        <ul className="flex flex-col pb-1.5">
          {incidents.map((inc) => (
            <li key={inc.id}>
              <button
                type="button"
                onClick={() => onOpenIncident(inc)}
                className="flex w-full items-center gap-2 px-3.5 py-1.5 text-left hover:bg-secondary/40 transition-colors focus-ring"
              >
                <StatusShape status={severityShapeStatus(inc.severity)} size="sm" />
                <span className="typo-caption text-foreground truncate flex-1 min-w-0">{inc.title}</span>
                <span className="typo-caption text-foreground shrink-0">
                  {sourceTableLabel(t, inc.sourceTable)}
                </span>
                <span className="typo-caption text-primary shrink-0 inline-flex items-center gap-1">
                  {t.overview.incidents.noc_handled_continued}
                  {inc.continuedAt && <RelativeTime timestamp={inc.continuedAt} />}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
