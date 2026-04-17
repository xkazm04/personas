/**
 * TrustBadge -- visual indicator of template origin verification and trust level.
 *
 * Shows a compact badge with icon + label for verified/sandboxed/untrusted states.
 * Used on TemplateCard headers and in the AdoptionWizardModal header.
 */
import { ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import type { TemplateTrustLevel } from '@/lib/types/templateTypes';
import {
  TRUST_LEVEL_LABELS,
  TRUST_LEVEL_COLORS,
} from '@/lib/templates/templateVerification';

interface TrustBadgeProps {
  trustLevel: TemplateTrustLevel;
  /** Show compact (icon only) or full (icon + label) */
  compact?: boolean;
  className?: string;
}

const TRUST_ICONS: Record<TemplateTrustLevel, typeof ShieldCheck> = {
  verified: ShieldCheck,
  sandboxed: ShieldAlert,
  untrusted: ShieldX,
};

export function TrustBadge({ trustLevel, compact = false, className = '' }: TrustBadgeProps) {
  const Icon = TRUST_ICONS[trustLevel];
  const colors = TRUST_LEVEL_COLORS[trustLevel];
  const label = TRUST_LEVEL_LABELS[trustLevel];

  if (compact) {
    return (
      <div
        className={`inline-flex items-center justify-center w-6 h-6 rounded-card ${colors.bg} ${className}`}
        title={label}
      >
        <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 typo-body font-medium rounded-card border ${colors.bg} ${colors.text} ${colors.border} ${className}`}
    >
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}
