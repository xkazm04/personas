import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { Code2, HeadsetIcon, Briefcase } from 'lucide-react';
import type { RolePreset } from './catalogRolePresets';
import type { CatalogSortMode } from '@/stores/slices/vault/catalogPrefsSlice';
import { useTranslation } from '@/i18n/useTranslation';

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
  activeRole: RolePreset | null;
  onRoleToggle: (role: RolePreset) => void;
  sortMode: CatalogSortMode;
  onSortModeChange: (v: CatalogSortMode) => void;
  sortOptions: ThemedSelectOption[];
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
  activeRole,
  onRoleToggle,
  sortMode,
  onSortModeChange,
  sortOptions,
}: CredentialPickerFiltersProps) {
  const { t } = useTranslation();
  return (
    <div className={`flex ${IS_MOBILE ? 'flex-col' : 'flex-row items-center'} gap-2`}>
      <div className={`flex ${IS_MOBILE ? 'flex-wrap' : ''} gap-2`}>
        <ThemedSelect
          filterable
          options={connectedOptions}
          value={connectedFilter}
          onValueChange={(v) => onConnectedFilterChange((v || 'all') as ConnectedFilter)}
          placeholder={t.vault.picker_section.filter_status}
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[150px]'}
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          filterable
          options={purposeOptions}
          value={activePurpose ?? ''}
          onValueChange={(v) => onPurposeChange(v || null)}
          placeholder={t.vault.picker_section.filter_purpose}
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
          placeholder={t.vault.picker_section.filter_category}
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[175px]'}
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          filterable
          options={licenseOptions}
          value={activeLicense ?? ''}
          onValueChange={(v) => onLicenseChange(v || null)}
          placeholder={t.vault.picker_section.filter_license}
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[170px]'}
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          options={sortOptions}
          value={sortMode}
          onValueChange={(v) => onSortModeChange((v || 'alphabetical') as CatalogSortMode)}
          placeholder={t.vault.picker_section.filter_sort}
          wrapperClassName={IS_MOBILE ? 'flex-1 min-w-[100px]' : 'w-[180px]'}
          className="!py-1.5 !text-sm"
          data-testid="catalog-sort-select"
        />
      </div>
      <div className="flex items-center gap-1 ml-auto">
        {([
          { role: 'developer' as const, icon: Code2, label: t.vault.picker_section.role_developer },
          { role: 'support' as const, icon: HeadsetIcon, label: t.vault.picker_section.role_support },
          { role: 'manager' as const, icon: Briefcase, label: t.vault.picker_section.role_manager },
        ]).map(({ role, icon: Icon, label }) => (
          <button
            key={role}
            type="button"
            onClick={() => onRoleToggle(role)}
            title={label}
            aria-label={label}
            aria-pressed={activeRole === role}
            className={`p-1.5 rounded-card border transition-colors ${
              activeRole === role
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-400'
                : 'bg-secondary/30 border-primary/10 text-foreground hover:text-muted-foreground/80 hover:border-primary/20'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
