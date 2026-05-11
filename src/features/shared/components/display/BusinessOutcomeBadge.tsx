import { CheckCircle2, AlertCircle, XCircle, MinusCircle, HelpCircle, type LucideIcon } from 'lucide-react';

type Outcome = 'value_delivered' | 'no_input_available' | 'precondition_failed' | 'partial' | 'unknown';

interface OutcomeConfig {
  icon: LucideIcon;
  color: string;
  label: string;
  title: string;
}

const OUTCOMES: Record<Outcome, OutcomeConfig> = {
  value_delivered: {
    icon: CheckCircle2,
    color: 'text-emerald-400',
    label: 'Delivered',
    title: 'Persona produced real work — actionable artifact, sent message, modified state, etc.',
  },
  no_input_available: {
    icon: MinusCircle,
    color: 'text-amber-400',
    label: 'No input',
    title: 'Ran cleanly but had nothing to process — emitted a readiness/status report only.',
  },
  precondition_failed: {
    icon: XCircle,
    color: 'text-red-400',
    label: 'Blocked',
    title: 'A required connector, credential, or precondition is missing/broken. Fix setup to unblock.',
  },
  partial: {
    icon: AlertCircle,
    color: 'text-orange-400',
    label: 'Partial',
    title: 'Did some of the work but not all — rate limit, transient error, or missing fields on some items.',
  },
  unknown: {
    icon: HelpCircle,
    color: 'text-foreground/50',
    label: '—',
    title: 'No business outcome reported (older execution or LLM did not emit the assessment).',
  },
};

interface Props {
  outcome: string | null | undefined;
  /** Compact = icon + 1-word label. Default = icon only. */
  variant?: 'icon-only' | 'compact';
  className?: string;
}

export function BusinessOutcomeBadge({ outcome, variant = 'icon-only', className = '' }: Props) {
  const key = (outcome ?? 'unknown') as Outcome;
  const cfg = OUTCOMES[key] ?? OUTCOMES.unknown;
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
      className={`inline-flex items-center gap-1 typo-code font-mono ${cfg.color} ${className}`}
      title={cfg.title}
    >
      <Icon className="w-3 h-3" />
      <span>{cfg.label}</span>
    </span>
  );
}
