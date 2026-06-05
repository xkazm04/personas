import { Brain, Zap } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export { formatTime };

const CATEGORY_DOT: Record<string, string> = {
  observation: 'bg-cyan-500',
  decision: 'bg-amber-500',
  context: 'bg-violet-500',
  learning: 'bg-emerald-500',
};

export function MemoryEntry({ memory, isManual }: { memory: TeamMemory; isManual?: boolean }) {
  return (
    <div className="flex items-start gap-2 px-2 py-1 rounded-card hover:bg-primary/5 transition-colors">
      <div className={`mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${CATEGORY_DOT[memory.category] ?? 'bg-gray-400'}`} />
      <div className="flex-1 min-w-0">
        <p className="typo-body text-foreground truncate">{memory.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {isManual ? (
            <Brain className="w-2.5 h-2.5 text-foreground" />
          ) : (
            <Zap className="w-2.5 h-2.5 text-amber-400/50" />
          )}
          <span className="typo-body text-foreground">{formatTime(memory.created_at)}</span>
        </div>
      </div>
    </div>
  );
}

export function ManualGroup({ memories }: { memories: TeamMemory[] }) {
  return (
    <div className="space-y-0.5">
      {memories.map((m) => (
        <MemoryEntry key={m.id} memory={m} isManual />
      ))}
    </div>
  );
}
