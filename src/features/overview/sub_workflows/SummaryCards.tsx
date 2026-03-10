import type { WorkflowsOverview } from '@/api/pipeline/workflows';

export function SummaryCards({ data }: { data: WorkflowsOverview }) {
  const cards = [
    { label: 'Total Jobs', value: data.total_count, color: 'text-foreground', bg: 'bg-secondary/40' },
    { label: 'Running', value: data.running_count, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: 'Completed', value: data.completed_count, color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
    { label: 'Failed', value: data.failed_count, color: 'text-red-400', bg: 'bg-red-500/10' },
  ];

  return (
    <div className="grid grid-cols-4 gap-3">
      {cards.map((c) => (
        <div key={c.label} className={`${c.bg} rounded-xl border border-primary/10 px-4 py-3`}>
          <div className="text-[11px] text-muted-foreground/80 uppercase tracking-wide mb-1">{c.label}</div>
          <div className={`text-2xl font-semibold tabular-nums ${c.color}`}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}
