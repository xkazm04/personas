import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import { KIND_ICONS, getKindLabels } from './graphConstants';
import { useTranslation } from '@/i18n/useTranslation';
import type { GraphNodeKind } from './credentialGraph';

interface GraphControlsProps {
  stats: Record<GraphNodeKind, number>;
  filterKind: GraphNodeKind | 'all';
  onFilterChange: (kind: GraphNodeKind | 'all') => void;
}

export function GraphControls({ stats, filterKind, onFilterChange }: GraphControlsProps) {
  const { t } = useTranslation();
  const kindLabels = getKindLabels(t);

  return (
    <div className="grid grid-cols-3 3xl:grid-cols-4 4xl:grid-cols-6 gap-2">
      {(Object.keys(kindLabels) as GraphNodeKind[]).map((kind) => {
        const Icon = KIND_ICONS[kind];
        const active = filterKind === kind;
        return (
          <PressSurface key={kind} selected={active} onPress={() => onFilterChange(active ? "all" : kind)} className="flex items-center gap-2 px-3 py-2 rounded-modal border border-hair text-ink-1">
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <div>
              <span className="typo-data num">{stats[kind]}</span>
              <span className="typo-caption ml-1.5">{kindLabels[kind]}</span>
            </div>
          </PressSurface>
        );
      })}
    </div>
  );
}
