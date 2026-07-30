import { Sparkles, Stethoscope, ShieldCheck } from 'lucide-react';
import { StatusBadge, type BadgeSize } from '@/features/shared/components/display/StatusBadge';

/**
 * @catalog Provenance badge for anything Athena composed, diagnosed, or handled autonomously.
 * Shared across the Command Surfaces package (briefing, generated tours, NOC diagnosis/lanes)
 * so "an AI did this" reads identically everywhere. Callers supply the localized label.
 */
export type AthenaProvenance = 'composed' | 'diagnosed' | 'handled';

const VARIANT_META: Record<AthenaProvenance, { icon: typeof Sparkles; variant: 'info' | 'processing' | 'success' }> = {
  composed: { icon: Sparkles, variant: 'info' },
  diagnosed: { icon: Stethoscope, variant: 'processing' },
  handled: { icon: ShieldCheck, variant: 'success' },
};

interface AthenaComposedBadgeProps {
  variant: AthenaProvenance;
  /** Localized label, e.g. t.companion.composed_by_athena — the badge itself carries no copy. */
  label: string;
  /** Optional tooltip with rationale ("why is Athena showing this"). */
  title?: string;
  size?: BadgeSize;
  className?: string;
}

export function AthenaComposedBadge({ variant, label, title, size = 'sm', className }: AthenaComposedBadgeProps) {
  const meta = VARIANT_META[variant];
  const Icon = meta.icon;
  return (
    <StatusBadge
      variant={meta.variant}
      size={size}
      title={title}
      className={className}
      icon={<Icon className="w-3 h-3 opacity-90" />}
    >
      {label}
    </StatusBadge>
  );
}
