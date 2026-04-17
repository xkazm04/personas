import { CheckSquare, Square, Cloud, Monitor } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { SOURCE_LABELS, type SourceFilter } from '../libs/reviewHelpers';
import type { Persona } from '@/lib/bindings/Persona';

interface ReviewFilterTrailingProps {
  isCloudConnected: boolean;
  sourceFilter: SourceFilter;
  onSourceFilterChange: (src: SourceFilter) => void;
  selectedPersonaId: string;
  onPersonaChange: (id: string) => void;
  personas: Persona[];
  selectablePendingCount: number;
  activeSelectionCount: number;
  onToggleSelectAll: () => void;
}

export function ReviewFilterTrailing({
  isCloudConnected,
  sourceFilter,
  onSourceFilterChange,
  selectedPersonaId,
  onPersonaChange,
  personas,
  selectablePendingCount,
  activeSelectionCount,
  onToggleSelectAll,
}: ReviewFilterTrailingProps) {
  const { t } = useTranslation();
  return (
    <div className="ml-auto flex items-center gap-2">
      {isCloudConnected && (
        <div className="flex items-center rounded-modal border border-primary/15 overflow-hidden text-xs">
          {(['all', 'local', 'cloud'] as SourceFilter[]).map((src) => (
            <button
              key={src}
              onClick={() => onSourceFilterChange(src)}
              className={`flex items-center gap-1 px-2.5 py-1.5 transition-colors ${
                sourceFilter === src
                  ? 'bg-primary/10 text-foreground/90 font-medium'
                  : 'text-foreground hover:text-muted-foreground hover:bg-white/[0.03]'
              }`}
            >
              {src === 'local' && <Monitor className="w-3 h-3" />}
              {src === 'cloud' && <Cloud className="w-3 h-3" />}
              {SOURCE_LABELS[src]}
            </button>
          ))}
        </div>
      )}
      <PersonaSelect value={selectedPersonaId} onChange={onPersonaChange} personas={personas} />
      {selectablePendingCount > 0 && (
        <button
          onClick={onToggleSelectAll}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-modal text-sm text-foreground hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
        >
          {activeSelectionCount === selectablePendingCount ? (
            <CheckSquare className="w-3.5 h-3.5" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}{' '}
          {t.overview.review.select_all}
        </button>
      )}
    </div>
  );
}
