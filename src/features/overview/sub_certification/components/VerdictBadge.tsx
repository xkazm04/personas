import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useTranslation } from '@/i18n/useTranslation';

/** Verdict string (from the bundle) → StatusBadge accent color. */
const VERDICT_ACCENT: Record<string, 'emerald' | 'amber' | 'rose' | 'red' | 'slate'> = {
  PRODUCTION: 'emerald',
  PROMISING: 'amber',
  'NOT-READY': 'rose',
  BROKEN: 'red',
};

interface VerdictBadgeProps {
  verdict: string | null;
  /** When true, the verdict is deterministic-only (judge not yet scored). */
  provisional?: boolean;
  size?: 'sm' | 'md';
}

/** Renders a run verdict as a colored pill, marking provisional verdicts. */
export function VerdictBadge({ verdict, provisional, size = 'md' }: VerdictBadgeProps) {
  const { t } = useTranslation();
  if (!verdict) {
    return (
      <StatusBadge accent="slate" size={size} pill>
        —
      </StatusBadge>
    );
  }
  const tokenKey = verdict.toLowerCase().replace(/-/g, '_');
  const label = tokenLabel(t, 'verdict', tokenKey);
  return (
    <StatusBadge
      accent={VERDICT_ACCENT[verdict] ?? 'slate'}
      size={size}
      pill
      title={provisional ? t.overview.certification.provisional : t.overview.certification.final}
    >
      {label}
      {provisional ? ' *' : ''}
    </StatusBadge>
  );
}
