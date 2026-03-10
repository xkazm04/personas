import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { IS_MOBILE } from '@/lib/utils/platform/platform';

type ConnectedFilter = 'all' | 'connected' | 'new';

interface CredentialPickerFiltersProps {
  connectedFilter: ConnectedFilter;
  onConnectedFilterChange: (v: ConnectedFilter) => void;
  connectedOptions: ThemedSelectOption[];
  activePurpose: string | null;
  onPurposeChange: (v: string | null) => void;
  purposeOptions: ThemedSelectOption[];
  activeCategory: string | null;
  onCategoryChange: (v: string | null) => void;
  categoryOptions: ThemedSelectOption[];
  activeLicense: string | null;
  onLicenseChange: (v: string | null) => void;
  licenseOptions: ThemedSelectOption[];
}

export function CredentialPickerFilters({
  connectedFilter,
  onConnectedFilterChange,
  connectedOptions,
  activePurpose,
  onPurposeChange,
  purposeOptions,
  activeCategory,
  onCategoryChange,
  categoryOptions,
  activeLicense,
  onLicenseChange,
  licenseOptions,
}: CredentialPickerFiltersProps) {
  return (
    <div className={`flex ${IS_MOBILE ? 'flex-col' : 'flex-row items-center'} gap-2`}>
      <div className={`flex ${IS_MOBILE ? 'flex-wrap' : ''} gap-2`}>
        <ThemedSelect
          filterable
          options={connectedOptions}
          value={connectedFilter}
          onValueChange={(v) => onConnectedFilterChange((v || 'all') as ConnectedFilter)}
          placeholder="Status"
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[150px]'}
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          filterable
          options={purposeOptions}
          value={activePurpose ?? ''}
          onValueChange={(v) => onPurposeChange(v || null)}
          placeholder="Purpose"
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[195px]'}
          className="!py-1.5 !text-sm"
        />
      </div>
      <div className={`flex ${IS_MOBILE ? 'flex-wrap' : ''} gap-2`}>
        <ThemedSelect
          filterable
          options={categoryOptions}
          value={activeCategory ?? ''}
          onValueChange={(v) => onCategoryChange(v || null)}
          placeholder="Category"
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[175px]'}
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          filterable
          options={licenseOptions}
          value={activeLicense ?? ''}
          onValueChange={(v) => onLicenseChange(v || null)}
          placeholder="License"
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[170px]'}
          className="!py-1.5 !text-sm"
        />
      </div>
    </div>
  );
}
