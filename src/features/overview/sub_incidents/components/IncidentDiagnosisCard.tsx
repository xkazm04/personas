import { useEffect, useState } from 'react';
import { Stethoscope, Wrench } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AthenaComposedBadge } from '@/features/shared/components/feedback/AthenaComposedBadge';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { getIncidentDiagnosis, diagnoseAuditIncident } from '@/api/overview/incidents';
import type { IncidentDiagnosis } from '@/lib/bindings/IncidentDiagnosis';

/**
 * Root-cause card for the incident detail modal (Autonomous NOC v1).
 *
 * Shows the stored diagnosis when the server-side evaluator already attached
 * one; otherwise offers an explicit "Diagnose" affordance (one click — the
 * pass is read-only except that it may create ONE pending companion approval,
 * which the user then decides in Athena's Approvals — nothing auto-runs).
 * Renders in the `AthenaVerdictCard` shape: provenance badge, first-person
 * summary, facts rail (evidence), and the proposal state.
 */
export function IncidentDiagnosisCard({ incidentId }: { incidentId: string }) {
  const { t } = useTranslation();
  const [diagnosis, setDiagnosis] = useState<IncidentDiagnosis | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDiagnosis(null);
    (async () => {
      try {
        const d = await getIncidentDiagnosis(incidentId);
        if (!cancelled) setDiagnosis(d);
      } catch (err) {
        silentCatch('IncidentDiagnosisCard:get')(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [incidentId]);

  const runDiagnosis = async () => {
    setRunning(true);
    try {
      setDiagnosis(await diagnoseAuditIncident(incidentId));
    } catch (err) {
      toastCatch('IncidentDiagnosisCard:diagnose', t.overview.incidents.noc_diagnose_failed)(err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-card border border-primary/15 bg-secondary/20 p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Stethoscope className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h3 className="typo-overline text-foreground">{t.overview.incidents.noc_diagnosis_title}</h3>
        {diagnosis && (
          <AthenaComposedBadge
            variant="diagnosed"
            label={t.overview.incidents.noc_diagnosed_by}
            title={diagnosis.summary}
          />
        )}
        {diagnosis && (
          <span className="ml-auto typo-caption text-foreground">
            {t.overview.incidents.noc_confidence}: {Math.round(diagnosis.confidence * 100)}%
          </span>
        )}
      </div>

      {loading ? (
        /* Ghost line — invisible for its first beat so a fast fetch never flashes. */
        <div aria-hidden="true" className="animate-fade-in" style={{ animationDelay: '120ms' }}>
          <span className="block h-3.5 w-3/4 rounded bg-primary/[0.06]" />
          <span className="mt-2 block h-3.5 w-1/2 rounded bg-primary/[0.06]" />
        </div>
      ) : diagnosis ? (
        <div className="flex flex-col gap-3">
          <p className="typo-body text-foreground whitespace-pre-wrap break-words">{diagnosis.summary}</p>

          {diagnosis.evidence.length > 0 && (
            <div>
              <h4 className="typo-overline text-foreground mb-1">
                {t.overview.incidents.noc_evidence_label}
              </h4>
              <ul className="flex flex-col gap-1">
                {diagnosis.evidence.map((line, i) => (
                  <li key={i} className="typo-caption text-foreground break-words">
                    · {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {diagnosis.proposedAction && (
            <div className="flex items-start gap-2 rounded-card border border-primary/10 bg-primary/5 px-3 py-2">
              <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex flex-col gap-1">
                <span className="typo-overline text-foreground">
                  {t.overview.incidents.noc_proposed_label}
                </span>
                {diagnosis.proposedRationale && (
                  <p className="typo-caption text-foreground break-words">{diagnosis.proposedRationale}</p>
                )}
                {diagnosis.approvalId && (
                  <StatusBadge variant="warning" size="sm">
                    {t.overview.incidents.noc_proposal_pending}
                  </StatusBadge>
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="typo-caption text-foreground">
            {running ? t.overview.incidents.noc_diagnosing : t.overview.incidents.noc_no_diagnosis}
          </p>
          <Button variant="secondary" onClick={() => void runDiagnosis()} loading={running}>
            {t.overview.incidents.noc_diagnose_action}
          </Button>
        </div>
      )}
    </div>
  );
}
