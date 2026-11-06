import { CheckSquare, Square, Cloud, Monitor } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { PersonaSelect } from '@/features/overview/sub_usage/components/PersonaSelect';
import { reviewSourceLabel, type SourceFilter } from '../libs/reviewHelpers';
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
        <div className="flex items-center rounded-modal border border-hair overflow-hidden typo-caption">
          {(['all', 'local', 'cloud'] as SourceFilter[]).map((src) => (
            <Button variant={sourceFilter === src ? "secondary" : "ghost"} size="sm" key={src} onClick={() => onSourceFilterChange(src)}><span className="inline-flex items-center gap-1.5">{src === 'local' && <Monitor className="w-3 h-3" />}
              {src === 'cloud' && <Cloud className="w-3 h-3" />}
              {reviewSourceLabel(t, src)}</span></Button>
          ))}
        </div>
      )}
      <PersonaSelect value={selectedPersonaId} onChange={onPersonaChange} personas={personas} />
      {selectablePendingCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onToggleSelectAll} icon={activeSelectionCount === selectablePendingCount ? (
            <CheckSquare className="w-3.5 h-3.5" />
          ) : (
            <Square className="w-3.5 h-3.5" />
          )}>
{t.overview.review.select_all}
</Button>
      )}
    </div>
  );
}
