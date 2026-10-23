import { useTranslation } from '@/i18n/useTranslation';
import { CheckCircle2, AlertCircle, XCircle, MinusCircle, HelpCircle, type LucideIcon } from 'lucide-react';

type Outcome = 'value_delivered' | 'no_input_available' | 'precondition_failed' | 'partial' | 'unknown';

interface OutcomeStyle {
  icon: LucideIcon;
  color: string;
}

const OUTCOME_STYLES: Record<Outcome, OutcomeStyle> = {
  value_delivered: { icon: CheckCircle2, color: 'text-emerald-400' },
  no_input_available: { icon: MinusCircle, color: 'text-amber-400' },
  precondition_failed: { icon: XCircle, color: 'text-red-400' },
  partial: { icon: AlertCircle, color: 'text-orange-400' },
  unknown: { icon: HelpCircle, color: 'text-foreground' },
};

interface Props {
  outcome: string | null | undefined;
  /** Compact = icon + 1-word label. Default = icon only. */
  variant?: 'icon-only' | 'compact';
  className?: string;
}

export function BusinessOutcomeBadge({ outcome, variant = 'icon-only', className = '' }: Props) {
  const { t } = useTranslation();
  const copy = t.shared.business_outcome;
  const known = outcome != null && Object.prototype.hasOwnProperty.call(OUTCOME_STYLES, outcome);
  const key = (known ? outcome : 'unknown') as Outcome;
  const cfg = {
    ...OUTCOME_STYLES[key],
    label: copy[`${key}_label`],
    title: copy[`${key}_title`],
  };
  const Icon = cfg.icon;

  if (variant === 'icon-only') {
    return (
      <span
        className={`inline-flex items-center ${cfg.color} ${className}`}
        title={cfg.title}
        aria-label={cfg.label}
      >
        <Icon className="w-3.5 h-3.5" />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 typo-code ${cfg.color} ${className}`}
      title={cfg.title}
    >
      <Icon className="w-3 h-3" />
      <span>{cfg.label}</span>
    </span>
  );
}
