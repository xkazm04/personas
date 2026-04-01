import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { Code2, HeadsetIcon, Briefcase } from 'lucide-react';
import type { RolePreset } from './catalogRolePresets';

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
      <div className="flex items-center gap-1 ml-auto">
        {([
          { role: 'developer' as const, icon: Code2, label: 'Developer' },
          { role: 'support' as const, icon: HeadsetIcon, label: 'Support' },
          { role: 'manager' as const, icon: Briefcase, label: 'Manager' },
        ]).map(({ role, icon: Icon, label }) => (
          <button
            key={role}
            type="button"
            onClick={() => onRoleToggle(role)}
            title={label}
            className={`p-1.5 rounded-lg border transition-colors ${
              activeRole === role
                ? 'bg-violet-500/15 border-violet-500/30 text-violet-400'
                : 'bg-secondary/30 border-primary/10 text-muted-foreground/50 hover:text-muted-foreground/80 hover:border-primary/20'
            }`}
          >
            <Icon className="w-4 h-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
