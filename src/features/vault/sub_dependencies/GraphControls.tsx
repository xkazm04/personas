import { KIND_ICONS, KIND_LABELS } from './graphConstants';
import type { GraphNodeKind } from './credentialGraph';

interface GraphControlsProps {
  stats: Record<GraphNodeKind, number>;
  filterKind: GraphNodeKind | 'all';
  onFilterChange: (kind: GraphNodeKind | 'all') => void;
}

export function GraphControls({ stats, filterKind, onFilterChange }: GraphControlsProps) {
  return (
    <div className="grid grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-6 gap-2">
      {(Object.keys(KIND_LABELS) as GraphNodeKind[]).map((kind) => {
        const Icon = KIND_ICONS[kind];
        const active = filterKind === kind;
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onFilterChange(active ? 'all' : kind)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-left transition-colors cursor-pointer ${
              active
                ? 'bg-primary/10 border-primary/25 text-foreground/90'
                : 'bg-secondary/25 border-primary/10 text-muted-foreground/70 hover:border-primary/20 hover:bg-secondary/40'
            }`}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <div>
              <span className="text-lg font-semibold leading-none">{stats[kind]}</span>
              <span className="text-xs ml-1.5">{KIND_LABELS[kind]}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
