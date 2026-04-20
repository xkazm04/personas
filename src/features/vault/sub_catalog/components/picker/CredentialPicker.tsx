import { useCallback } from 'react';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { useSystemStore } from '@/stores/systemStore';
import { CredentialPickerFilters } from './CredentialPickerFilters';
import { PickerGrid } from './PickerGrid';
import { usePickerFilters } from './usePickerFilters';
import { useRecipeIndicators } from './useRecipeIndicators';

interface CredentialPickerProps {
  connectors: ConnectorDefinition[];
  credentials: CredentialMetadata[];
  onPickType: (connector: ConnectorDefinition) => void;
  searchTerm?: string;
}

export function CredentialPicker({ connectors, credentials, onPickType, searchTerm }: CredentialPickerProps) {
  const filters = usePickerFilters(connectors, credentials, searchTerm);
  const recipeIndicators = useRecipeIndicators();
  const tourActive = useSystemStore((s) => s.tourActive);
  const recordCredentialInteraction = useSystemStore((s) => s.recordCredentialInteraction);

  const handleCategoryChange = useCallback((v: string | null) => {
    filters.setActiveCategory(v);
    if (tourActive && v) recordCredentialInteraction('category', v);
  }, [filters, tourActive, recordCredentialInteraction]);

  const handlePickType = useCallback((connector: ConnectorDefinition) => {
    if (tourActive) recordCredentialInteraction('connector', connector.name);
    onPickType(connector);
  }, [onPickType, tourActive, recordCredentialInteraction]);

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
        onCategoryChange={handleCategoryChange}
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
        recipeIndicators={recipeIndicators}
        onPickType={handlePickType}
      />
    </div>
  );
}
