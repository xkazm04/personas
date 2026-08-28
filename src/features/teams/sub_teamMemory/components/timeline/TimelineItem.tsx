import { Brain, Zap } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';

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
          <RelativeTime timestamp={memory.created_at} className="typo-body text-foreground" />
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
