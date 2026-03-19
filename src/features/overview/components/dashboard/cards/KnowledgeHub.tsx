import { useState } from 'react';
import { Brain, Network } from 'lucide-react';
import MemoriesPage from '@/features/overview/sub_memories/components/MemoriesPage';
import KnowledgeGraphDashboard from '@/features/overview/sub_knowledge/components/KnowledgeGraphDashboard';

type KnowledgeSubtab = 'memories' | 'patterns';

const SUBTABS: Array<{ id: KnowledgeSubtab; label: string; icon: typeof Brain }> = [
  { id: 'memories', label: 'Memories', icon: Brain },
  { id: 'patterns', label: 'Patterns', icon: Network },
];

export default function KnowledgeHub() {
  const [subtab, setSubtab] = useState<KnowledgeSubtab>('memories');

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {/* Subtab bar */}
      <div className="flex items-center gap-1 px-4 md:px-6 py-2 border-b border-primary/10 bg-secondary/10 flex-shrink-0">
        {SUBTABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = subtab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubtab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl typo-heading transition-all ${
                isActive
                  ? 'bg-primary/10 text-foreground border border-primary/20 shadow-sm'
                  : 'text-muted-foreground/70 hover:text-muted-foreground hover:bg-secondary/40'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      {subtab === 'memories' ? <MemoriesPage /> : <KnowledgeGraphDashboard />}
    </div>
  );
}
