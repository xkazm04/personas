import { useTranslation } from '@/i18n/useTranslation';

export function AiHealingCounters({
  phase,
  fixCount,
  shouldRetry,
}: {
  phase: string;
  fixCount: number;
  shouldRetry: boolean;
}) {
  const { t, tx } = useTranslation();
  const label = (() => {
    switch (phase) {
      case 'started':
        return t.agents.executions.healing_started;
      case 'diagnosing':
        return t.agents.executions.healing_diagnosing;
      case 'applying':
        return tx(fixCount !== 1 ? t.agents.executions.healing_applying_other : t.agents.executions.healing_applying_one, { count: fixCount });
      case 'completed':
        return fixCount > 0
          ? tx(fixCount !== 1 ? t.agents.executions.healing_completed_fixes_other : t.agents.executions.healing_completed_fixes_one, { count: fixCount }) + (shouldRetry ? t.agents.executions.healing_completed_retrying : '')
          : t.agents.executions.healing_no_fixes;
      case 'failed':
        return t.agents.executions.healing_failed;
      default:
        return '';
    }
  })();

  const dotColor =
    phase === 'completed'
      ? 'bg-emerald-400'
      : phase === 'failed'
        ? 'bg-red-400'
        : 'bg-violet-400 animate-pulse';

  return (
    <span className="flex items-center gap-1.5 typo-heading text-foreground">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}
