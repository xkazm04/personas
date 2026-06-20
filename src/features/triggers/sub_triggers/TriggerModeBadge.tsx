import type { PersonaTrigger } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

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
    <span
      className={`typo-code px-1.5 py-0.5 rounded-card font-mono border ${
        isApproval
          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20'
          : 'bg-amber-500/15 text-amber-400 border-amber-500/20'
      } ${className}`}
      title={isApproval ? t.triggers.unattended.approval_desc : t.triggers.unattended.dry_run_desc}
    >
      {isApproval ? t.triggers.unattended.badge_approval : t.triggers.unattended.badge_dry_run}
    </span>
  );
}
