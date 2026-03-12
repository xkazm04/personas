export function AiHealingCounters({
  phase,
  fixCount,
  shouldRetry,
}: {
  phase: string;
  fixCount: number;
  shouldRetry: boolean;
}) {
  const label = (() => {
    switch (phase) {
      case 'started':
        return 'AI Healing started';
      case 'diagnosing':
        return 'Diagnosing...';
      case 'applying':
        return `Applying ${fixCount} fix${fixCount !== 1 ? 'es' : ''}...`;
      case 'completed':
        return fixCount > 0
          ? `${fixCount} fix${fixCount !== 1 ? 'es' : ''} applied${shouldRetry ? ' -- retrying' : ''}`
          : 'No fixes needed';
      case 'failed':
        return 'Healing failed';
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
    <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}
