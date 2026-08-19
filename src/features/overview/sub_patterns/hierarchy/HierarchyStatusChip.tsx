// Status chip for hierarchy subjects/techniques — the status-vocabulary
// doctrine dogfooded: the backend token is a machine identifier, NEVER shown
// raw. Unknown tokens render a neutral "unknown" label. Colors follow the
// forge progression muted → info → primary → success on semantic tokens only.
import { useTranslation } from '@/i18n/useTranslation';

const STATUS_CLASSES: Record<string, string> = {
  draft: 'border-border/60 bg-secondary/50 text-foreground/60',
  forged: 'border-status-info/30 bg-status-info/10 text-status-info',
  reconciled: 'border-primary/30 bg-primary/10 text-primary',
  'transplant-tested': 'border-status-success/30 bg-status-success/10 text-status-success',
};

const UNKNOWN_CLASSES = 'border-border/60 bg-secondary/40 text-foreground/50';

export function HierarchyStatusChip({
  status,
  className,
}: {
  status: string | null;
  className?: string;
}) {
  const { t } = useTranslation();
  const p = t.overview.patterns_v2;
  const labels: Record<string, string> = {
    draft: p.status_draft,
    forged: p.status_forged,
    reconciled: p.status_reconciled,
    'transplant-tested': p.status_transplant_tested,
  };
  const known = status !== null && status in labels;
  const label = known ? labels[status as string] : p.status_unknown;
  const classes = known ? STATUS_CLASSES[status as string] : UNKNOWN_CLASSES;

  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-interactive border px-1.5 py-0.5 typo-caption font-medium ${classes}${className ? ` ${className}` : ''}`}
    >
      {label}
    </span>
  );
}
