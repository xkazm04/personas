import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/features/shared/components/display/Badge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Team-path honesty (Direction 2): a small amber chip shown next to a persona
 * on team candidate / goal-advance surfaces when its `setup_status` is
 * `needs_credentials`. The team path lets an unready persona participate
 * (advisory — capabilities are stripped to zero at run time), which used to be
 * INVISIBLE: the badge said "can't run", the team ran it blind. This chip makes
 * the degraded state explicit wherever a persona is listed for/after selection.
 *
 * Renders nothing when the persona is ready — safe to drop into any roster row.
 */
export function TeamReadinessChip({
  setupStatus,
  size = 'xs',
}: {
  /** The persona's `setup_status` column (`ready` | `needs_credentials`). */
  setupStatus: string | null | undefined;
  size?: 'xs' | 'sm';
}) {
  const { t } = useTranslation();
  if (setupStatus !== 'needs_credentials') return null;
  const ts = t.pipeline.team_studio;
  return (
    <Tooltip content={ts.readiness_chip_tooltip}>
      <Badge variant="amber" size={size} data-testid="team-readiness-chip">
        <AlertTriangle className="w-3 h-3" aria-hidden />
        {ts.readiness_chip_label}
      </Badge>
    </Tooltip>
  );
}
