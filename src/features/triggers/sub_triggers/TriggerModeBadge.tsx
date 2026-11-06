import type { PersonaTrigger } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

interface TriggerModeBadgeProps {
  trigger: Pick<PersonaTrigger, 'unattended_mode'>;
  className?: string;
}

/**
 * Badge surfacing a trigger's unattended fire-mode ("armed to do what"): nothing
 * for `auto` (the implicit default), an amber "Dry run" pill, or an emerald
 * "Approval" pill. Shared by the global TriggerList and the per-persona
 * TriggerRow so both views describe the blast radius identically.
 * (UAT P5 — F-TRIGGER-BLAST-RADIUS / destructive-action gate.)
 */
export function TriggerModeBadge({ trigger, className = '' }: TriggerModeBadgeProps) {
  const { t } = useTranslation();
  const mode = trigger.unattended_mode;
  if (!mode || mode === 'auto') return null;
  const isApproval = mode === 'approval';
  return (
    <Tooltip content={isApproval ? t.triggers.unattended.approval_desc : t.triggers.unattended.dry_run_desc}><span
      className={`typo-code px-1.5 py-0.5 rounded-card border ${
        isApproval
          ? 'bg-status-success/15 text-status-success border-status-success/20'
          : 'bg-status-warning/15 text-status-warning border-status-warning/20'
      } ${className}`}>
      {isApproval ? t.triggers.unattended.badge_approval : t.triggers.unattended.badge_dry_run}
    </span></Tooltip>
  );
}
