import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';

const CATEGORY_COLORS: Record<string, { dot: string; bg: string }> = {
  observation: { dot: 'bg-cyan-500', bg: 'bg-cyan-500/10' },
  decision: { dot: 'bg-amber-500', bg: 'bg-amber-500/10' },
  context: { dot: 'bg-violet-500', bg: 'bg-violet-500/10' },
  learning: { dot: 'bg-emerald-500', bg: 'bg-emerald-500/10' },
};

const DEFAULT_COLOR = { dot: 'bg-gray-400', bg: 'bg-gray-400/10' };

interface TeamMemoryRowProps {
  memory: TeamMemory;
  onDelete: (id: string) => void;
  onImportanceChange: (id: string, importance: number) => void;
}

export default function TeamMemoryRow({ memory, onDelete, onImportanceChange }: TeamMemoryRowProps) {
  const [hovered, setHovered] = useState(false);
  const colors = CATEGORY_COLORS[memory.category] ?? DEFAULT_COLOR;
  const isAuto = memory.tags?.includes('auto');

  // Map importance 1-10 to filled dots out of 5
  const dots = Math.min(5, Math.max(1, Math.round(memory.importance / 2)));

  return (
    <div
      className="group relative px-2.5 py-2 rounded-xl border border-primary/5 hover:border-primary/15 transition-colors"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="flex items-start gap-2">
        {/* Category dot */}
        <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${colors.dot}`} />

        <div className="flex-1 min-w-0">
          {/* Title */}
          <p className="text-sm font-medium text-foreground/90 truncate">{memory.title}</p>
          {/* Content preview */}
          <p className="text-sm text-muted-foreground/70 line-clamp-2 mt-0.5">{memory.content}</p>

          <div className="flex items-center gap-2 mt-1.5">
            {/* Source badge */}
            <span className={`text-sm px-1.5 py-0.5 rounded-full ${colors.bg} text-foreground/60`}>
              {isAuto ? 'Auto' : 'Manual'}{memory.persona_id ? '' : ''}
            </span>

            {/* Importance dots */}
            <div className="flex items-center gap-0.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <button
                  key={i}
                  className={`w-1.5 h-1.5 rounded-full transition-colors ${
                    i < dots ? 'bg-amber-400' : 'bg-primary/10'
                  } hover:bg-amber-300`}
                  onClick={() => onImportanceChange(memory.id, (i + 1) * 2)}
                  title={`Set importance to ${(i + 1) * 2}`}
                />
              ))}
            </div>

            {/* Category label */}
            <span className="text-sm text-muted-foreground/50 capitalize">{memory.category}</span>
          </div>
        </div>
      </div>

      {/* Delete button on hover */}
      {hovered && (
        <button
          className="absolute top-1.5 right-1.5 p-1 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors"
          onClick={() => onDelete(memory.id)}
          title="Delete memory"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
