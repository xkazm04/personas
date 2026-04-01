import { useMemo } from 'react';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { isTierVisible, type Tier } from '@/lib/constants/uiModes';
import { useSystemStore } from '@/stores/systemStore';
import { CredentialPickerFilters } from './CredentialPickerFilters';
import { PickerGrid } from './PickerGrid';
import { usePickerFilters } from './usePickerFilters';

interface CredentialPickerProps {
  connectors: ConnectorDefinition[];
  credentials: CredentialMetadata[];
  onPickType: (connector: ConnectorDefinition) => void;
  searchTerm?: string;
}

export function CredentialPicker({ connectors: rawConnectors, credentials, onPickType, searchTerm }: CredentialPickerProps) {
  const viewMode = useSystemStore((s) => s.viewMode);

  // Filter out connectors gated behind a higher tier than the user's current mode
  const connectors = useMemo(() => rawConnectors.filter((c) => {
    const meta = (c.metadata ?? {}) as Record<string, unknown>;
    const minTier = meta.min_tier as Tier | undefined;
    return !minTier || isTierVisible(minTier, viewMode);
  }), [rawConnectors, viewMode]);

  const filters = usePickerFilters(connectors, credentials, searchTerm);

  return (
    <div className="space-y-3">
      <CredentialPickerFilters
        connectedFilter={filters.connectedFilter}
        onConnectedFilterChange={filters.setConnectedFilter}
        connectedOptions={filters.connectedOptions}
        activePurpose={filters.activePurpose}
        onPurposeChange={filters.setActivePurpose}
        purposeOptions={filters.purposeOptions}
        activeCategory={filters.activeCategory}
        onCategoryChange={filters.setActiveCategory}
        categoryOptions={filters.categoryOptions}
        activeLicense={filters.activeLicense}
        onLicenseChange={filters.setActiveLicense}
        licenseOptions={filters.licenseOptions}
        activeRole={filters.activeRole}
        onRoleToggle={filters.handleRoleToggle}
      />

      <PickerGrid
        filteredConnectors={filters.filteredConnectors}
        ownedServiceTypes={filters.ownedServiceTypes}
        onPickType={onPickType}
      />
    </div>
  );
}
