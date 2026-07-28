import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { tokenLabel } from '@/i18n/tokenMaps';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Single source of truth for the 4-value verdict vocabulary: verdict string
 * (as produced by the certification bundle) -> {accent, i18n token key}.
 *
 * Previously the accent color and the `status_tokens.verdict` token key were
 * two independently hand-maintained literal maps in this file — a new verdict
 * added to one but not the other degraded silently (unstyled `slate` badge, or
 * a raw un-translated token rendered to the user). Both now derive from this
 * one map; see `VerdictBadge.test.tsx` for the parity assertion against
 * `en.json`'s `status_tokens.verdict`.
 */
const VERDICT_CONFIG: Record<string, { accent: 'emerald' | 'amber' | 'rose' | 'red'; tokenKey: string }> = {
  PRODUCTION: { accent: 'emerald', tokenKey: 'production' },
  PROMISING: { accent: 'amber', tokenKey: 'promising' },
  'NOT-READY': { accent: 'rose', tokenKey: 'not_ready' },
  BROKEN: { accent: 'red', tokenKey: 'broken' },
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
  const config = VERDICT_CONFIG[verdict];
  const tokenKey = config?.tokenKey ?? verdict.toLowerCase().replace(/-/g, '_');
  const label = tokenLabel(t, 'verdict', tokenKey);
  return (
    <StatusBadge
      accent={config?.accent ?? 'slate'}
      size={size}
      pill
      title={provisional ? t.overview.certification.provisional : t.overview.certification.final}
    >
      {label}
      {provisional ? ' *' : ''}
    </StatusBadge>
  );
}

export { VERDICT_CONFIG };
