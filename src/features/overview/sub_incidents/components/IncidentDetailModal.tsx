import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import DetailModal from '@/features/overview/components/dashboard/widgets/DetailModal';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch } from '@/lib/silentCatch';
import {
  setIncidentInProgress,
  resolveAuditIncident,
  dismissAuditIncident,
  reopenAuditIncident,
} from '@/api/overview/incidents';
import {
  severityRank,
  severityShapeStatus,
  severityUrgencyLabel,
  sourceTableLabel,
  statusLabel,
} from '../libs/incidentTaxonomy';
import { IncidentDetailBreakdown } from './IncidentDetailBreakdown';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';

interface IncidentDetailModalProps {
  incident: AuditIncident;
  onClose: () => void;
  /** Called after a successful lifecycle mutation so the parent can re-fetch. */
  onChanged?: () => void;
}

type Action = 'start' | 'resolve' | 'dismiss' | 'reopen';

/**
 * Detail modal for a single audit incident with the full lifecycle
 * state-setter. Built on the shared DetailModal (which wraps BaseModal, so the
 * enforce-base-modal lint rule is satisfied). Shows the incident's metadata
 * grid, detail/resolution-note bodies, and an optional note field, and exposes
 * only the transitions valid for the current status:
 *   - open / acknowledged → Start work, Resolve (+ note), Dismiss (+ note)
 *   - in_progress         → Resolve (+ note), Dismiss (+ note), Back to open
 *   - resolved / dismissed → Reopen
 */
export function IncidentDetailModal({ incident, onClose, onChanged }: IncidentDetailModalProps) {
  const { t } = useTranslation();
  const [note, setNote] = useState('');
  const [pending, setPending] = useState<Action | null>(null);

  const status = incident.status;
  const isActive = status === 'open' || status === 'acknowledged' || status === 'in_progress';
  const canStartWork = status === 'open' || status === 'acknowledged';
  const canBackToOpen = status === 'in_progress';
  const canReopen = status === 'resolved' || status === 'dismissed';

  const run = async (action: Action, fn: () => Promise<unknown>) => {
    setPending(action);
    try {
      await fn();
      onChanged?.();
      onClose();
    } catch (err) {
      toastCatch('IncidentDetailModal:action')(err);
      setPending(null);
    }
  };

  const trimmedNote = note.trim();
  const noteArg = trimmedNote.length > 0 ? trimmedNote : undefined;

  const severityVariant = severityRank(incident.severity) >= 3 ? 'error' : 'warning';

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose} disabled={pending !== null}>
        {t.common.close}
      </Button>
      {canStartWork && (
        <Button
          variant="secondary"
          onClick={() => void run('start', () => setIncidentInProgress(incident.id))}
          loading={pending === 'start'}
          disabled={pending !== null}
        >
          {t.overview.incidents.action_start_work}
        </Button>
      )}
      {canBackToOpen && (
        <Button
          variant="secondary"
          onClick={() => void run('reopen', () => reopenAuditIncident(incident.id))}
          loading={pending === 'reopen'}
          disabled={pending !== null}
        >
          {t.overview.incidents.action_back_to_open}
        </Button>
      )}
      {isActive && (
        <>
          <Button
            variant="ghost"
            onClick={() => void run('dismiss', () => dismissAuditIncident(incident.id, noteArg))}
            loading={pending === 'dismiss'}
            disabled={pending !== null}
          >
            {t.overview.incidents.action_dismiss}
          </Button>
          <Button
            variant="primary"
            onClick={() => void run('resolve', () => resolveAuditIncident(incident.id, noteArg))}
            loading={pending === 'resolve'}
            disabled={pending !== null}
          >
            {t.overview.incidents.action_resolve}
          </Button>
        </>
      )}
      {canReopen && (
        <Button
          variant="primary"
          onClick={() => void run('reopen', () => reopenAuditIncident(incident.id))}
          loading={pending === 'reopen'}
          disabled={pending !== null}
        >
          {t.overview.incidents.action_reopen}
        </Button>
      )}
    </>
  );

  return (
    <DetailModal
      title={incident.title}
      subtitle={incident.personaName ?? undefined}
      onClose={onClose}
      maxWidthClass="max-w-2xl"
      actions={footer}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge variant={severityVariant}>
            <span className="inline-flex items-center gap-1.5">
              <StatusShape status={severityShapeStatus(incident.severity)} size="sm" colorClass="" />
              {tokenLabel(t, 'severity', incident.severity)}
            </span>
          </StatusBadge>
          <StatusBadge variant="neutral">{statusLabel(t, incident.status)}</StatusBadge>
          <span className="typo-caption text-foreground">{severityUrgencyLabel(t, incident.severity)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={t.overview.incidents.detail_label_status}>
            {statusLabel(t, incident.status)}
          </Field>
          <Field label={t.overview.incidents.detail_label_kind}>{incident.kind}</Field>
          <Field label={t.overview.incidents.detail_label_source}>
            {sourceTableLabel(t, incident.sourceTable)}
          </Field>
          <Field label={t.overview.incidents.detail_label_persona}>
            {incident.personaName ?? t.overview.incidents.detail_no_persona}
          </Field>
          <Field label={t.overview.incidents.detail_label_created}>
            <RelativeTime timestamp={incident.createdAt} />
          </Field>
          {incident.acknowledgedAt && (
            <Field label={t.overview.incidents.detail_label_acknowledged}>
              <RelativeTime timestamp={incident.acknowledgedAt} />
            </Field>
          )}
          {incident.resolvedAt && (
            <Field label={t.overview.incidents.detail_label_resolved}>
              <RelativeTime timestamp={incident.resolvedAt} />
            </Field>
          )}
        </div>

        <div>
          <h3 className="typo-overline text-foreground mb-1">
            {t.overview.incidents.detail_label_detail}
          </h3>
          <IncidentDetailBreakdown detail={incident.detail} />
        </div>

        {incident.resolutionNote && (
          <div>
            <h3 className="typo-overline text-foreground mb-1">
              {t.overview.incidents.detail_label_resolution_note}
            </h3>
            <p className="typo-body text-foreground whitespace-pre-wrap break-words">
              {incident.resolutionNote}
            </p>
          </div>
        )}

        {isActive && (
          <div>
            <label
              htmlFor="incident-resolution-note"
              className="typo-overline text-foreground mb-1 block"
            >
              {t.overview.incidents.detail_note_label}
            </label>
            <textarea
              id="incident-resolution-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.overview.incidents.resolution_note_placeholder}
              rows={3}
              className="w-full rounded-input border border-border bg-secondary/30 px-3 py-2 typo-body text-foreground placeholder:text-foreground/40 focus-ring"
            />
          </div>
        )}
      </div>
    </DetailModal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="typo-overline text-foreground mb-1">{label}</h3>
      <span className="typo-body text-foreground">{children}</span>
    </div>
  );
}
