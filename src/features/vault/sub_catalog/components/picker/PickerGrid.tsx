import { SearchX } from 'lucide-react';
import type { ConnectorDefinition } from '@/lib/types/types';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { ConnectorCard } from './ConnectorCard';
import { useTranslation } from '@/i18n/useTranslation';

interface PickerGridProps {
  filteredConnectors: ConnectorDefinition[];
  ownedServiceTypes: Set<string>;
  onPickType: (connector: ConnectorDefinition) => void;
}

export function PickerGrid({ filteredConnectors, ownedServiceTypes, onPickType }: PickerGridProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="grid [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))] gap-2.5">
        {filteredConnectors.map((connector) => (
          <ConnectorCard
            key={connector.id}
            connector={connector}
            isOwned={ownedServiceTypes.has(connector.name)}
            onPickType={onPickType}
          />
        ))}
      </div>

      {filteredConnectors.length === 0 && (
        <EmptyIllustration
          icon={SearchX}
          heading={t.vault.picker_section.no_connectors}
          description={t.vault.picker_section.no_connectors_hint}
          className="py-6"
        />
      )}
    </>
  );
}
