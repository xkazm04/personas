import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { StatusShape } from '@/features/shared/components/display/StatusShape';
import { severityShapeStatus, severityUrgencyLabel } from '../libs/incidentTaxonomy';

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

/**
 * Compact, always-visible key that decodes the severity shapes + colours used
 * across the inbox into plain-language urgency, so a first-time user learns the
 * visual vocabulary without having to hover every row.
 */
export function IncidentSeverityLegend() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 pb-3 typo-caption text-foreground">
      {SEVERITIES.map((severity) => (
        <span key={severity} className="inline-flex items-center gap-1.5">
          <StatusShape status={severityShapeStatus(severity)} size="sm" />
          <span className="font-medium">{tokenLabel(t, 'severity', severity)}</span>
          <span>· {severityUrgencyLabel(t, severity)}</span>
        </span>
      ))}
    </div>
  );
}
