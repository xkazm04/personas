import { useState, useMemo, useEffect } from 'react';
import { Plug, User, CreditCard, Building2 } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { ThemedSelect } from '@/features/shared/components/ThemedSelect';
import type { ThemedSelectOption } from '@/features/shared/components/ThemedSelect';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses, getAuthIcon } from '@/features/vault/utils/authMethodStyles';
import { PURPOSE_GROUPS, getPurposeForConnector } from '@/lib/credentials/connectorRoles';
import { getLicenseTier, LICENSE_TIER_META, type LicenseTier } from '@/lib/credentials/connectorLicensing';

interface CredentialPickerProps {
  connectors: ConnectorDefinition[];
  credentials: CredentialMetadata[];
  onPickType: (connector: ConnectorDefinition) => void;
  searchTerm?: string;
}

type ConnectedFilter = 'all' | 'connected' | 'new';

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const LICENSE_ICON: Record<LicenseTier, typeof User> = {
  personal: User,
  paid: CreditCard,
  enterprise: Building2,
};

export function CredentialPicker({ connectors, credentials, onPickType, searchTerm }: CredentialPickerProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activePurpose, setActivePurpose] = useState<string | null>(null);
  const [activeLicense, setActiveLicense] = useState<string | null>(null);
  const [connectedFilter, setConnectedFilter] = useState<ConnectedFilter>('all');

  const ownedServiceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const c of credentials) set.add(c.service_type);
    return set;
  }, [credentials]);

  // ── Cross-filter helpers ────────────────────────────────────────

  const applyConnected = (list: ConnectorDefinition[], filter: ConnectedFilter) => {
    if (filter === 'connected') return list.filter((c) => ownedServiceTypes.has(c.name));
    if (filter === 'new') return list.filter((c) => !ownedServiceTypes.has(c.name));
    return list;
  };

  const applyCategory = (list: ConnectorDefinition[], cat: string | null) =>
    cat ? list.filter((c) => c.category === cat) : list;

  const applyPurpose = (list: ConnectorDefinition[], purpose: string | null) =>
    purpose ? list.filter((c) => getPurposeForConnector(c.name) === purpose) : list;

  const applyLicense = (list: ConnectorDefinition[], license: string | null) =>
    license
      ? list.filter((c) => getLicenseTier(c.name, c.metadata as Record<string, unknown> | null) === license)
      : list;

  // ── Cross-filtered counts ──────────────────────────────────────

  // Base for each filter = connectors with all OTHER filters applied
  const purposeBase = useMemo(
    () => applyLicense(applyConnected(applyCategory(connectors, activeCategory), connectedFilter), activeLicense),
    [connectors, activeCategory, connectedFilter, activeLicense, ownedServiceTypes],
  );

  const categoryBase = useMemo(
    () => applyLicense(applyConnected(applyPurpose(connectors, activePurpose), connectedFilter), activeLicense),
    [connectors, activePurpose, connectedFilter, activeLicense, ownedServiceTypes],
  );

  const connectedBase = useMemo(
    () => applyLicense(applyCategory(applyPurpose(connectors, activePurpose), activeCategory), activeLicense),
    [connectors, activePurpose, activeCategory, activeLicense],
  );

  const licenseBase = useMemo(
    () => applyConnected(applyCategory(applyPurpose(connectors, activePurpose), activeCategory), connectedFilter),
    [connectors, activePurpose, activeCategory, connectedFilter, ownedServiceTypes],
  );

  // ── Tab/option data with cross-filtered counts ─────────────────

  const purposeOptions = useMemo<ThemedSelectOption[]>(() => {
    const counts: Record<string, number> = {};
    for (const c of purposeBase) {
      const p = getPurposeForConnector(c.name);
      if (p) counts[p] = (counts[p] || 0) + 1;
    }
    const opts: ThemedSelectOption[] = [{ value: '', label: `All Purposes (${purposeBase.length})` }];
    for (const pg of PURPOSE_GROUPS) {
      if (counts[pg.purpose]) {
        opts.push({ value: pg.purpose, label: `${pg.label} (${counts[pg.purpose]})` });
      }
    }
    return opts;
  }, [purposeBase]);

  const categoryOptions = useMemo<ThemedSelectOption[]>(() => {
    const counts: Record<string, number> = {};
    for (const c of categoryBase) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }
    const opts: ThemedSelectOption[] = [{ value: '', label: `All Categories (${categoryBase.length})` }];
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([cat, count]) => {
        opts.push({ value: cat, label: `${capitalize(cat)} (${count})` });
      });
    return opts;
  }, [categoryBase]);

  const connectedOptions = useMemo<ThemedSelectOption[]>(() => {
    let connected = 0;
    let fresh = 0;
    for (const c of connectedBase) {
      if (ownedServiceTypes.has(c.name)) connected++;
      else fresh++;
    }
    const opts: ThemedSelectOption[] = [
      { value: 'all', label: `All (${connectedBase.length})` },
    ];
    if (connected > 0) opts.push({ value: 'connected', label: `Connected (${connected})` });
    if (fresh > 0) opts.push({ value: 'new', label: `New (${fresh})` });
    return opts;
  }, [connectedBase, ownedServiceTypes]);

  const licenseOptions = useMemo<ThemedSelectOption[]>(() => {
    const counts: Record<string, number> = {};
    for (const c of licenseBase) {
      const tier = getLicenseTier(c.name, c.metadata as Record<string, unknown> | null);
      counts[tier] = (counts[tier] || 0) + 1;
    }
    const opts: ThemedSelectOption[] = [{ value: '', label: `All Licenses (${licenseBase.length})` }];
    for (const tier of ['personal', 'paid', 'enterprise'] as LicenseTier[]) {
      if (counts[tier]) {
        opts.push({ value: tier, label: `${LICENSE_TIER_META[tier].label} (${counts[tier]})` });
      }
    }
    return opts;
  }, [licenseBase]);

  // ── Final filtered list ─────────────────────────────────────────

  const filteredConnectors = useMemo(() => {
    let result = connectors;
    if (activeCategory) result = result.filter((c) => c.category === activeCategory);
    if (activePurpose) result = result.filter((c) => getPurposeForConnector(c.name) === activePurpose);
    if (activeLicense) result = result.filter((c) => getLicenseTier(c.name, c.metadata as Record<string, unknown> | null) === activeLicense);
    if (connectedFilter === 'connected') result = result.filter((c) => ownedServiceTypes.has(c.name));
    if (connectedFilter === 'new') result = result.filter((c) => !ownedServiceTypes.has(c.name));
    return result;
  }, [connectors, activeCategory, activePurpose, activeLicense, connectedFilter, ownedServiceTypes]);

  // Reset filters when search text arrives
  useEffect(() => {
    if (searchTerm?.trim()) {
      setActiveCategory(null);
      setActivePurpose(null);
      setActiveLicense(null);
      setConnectedFilter('all');
    }
  }, [searchTerm]);

  return (
    <div className="space-y-3">
      {/* Compact filter row */}
      <div className="flex items-center gap-2">
        <ThemedSelect
          filterable
          options={connectedOptions}
          value={connectedFilter}
          onValueChange={(v) => setConnectedFilter((v || 'all') as ConnectedFilter)}
          placeholder="Status"
          wrapperClassName="w-[150px]"
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          filterable
          options={purposeOptions}
          value={activePurpose ?? ''}
          onValueChange={(v) => setActivePurpose(v || null)}
          placeholder="Purpose"
          wrapperClassName="w-[195px]"
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          filterable
          options={categoryOptions}
          value={activeCategory ?? ''}
          onValueChange={(v) => setActiveCategory(v || null)}
          placeholder="Category"
          wrapperClassName="w-[175px]"
          className="!py-1.5 !text-sm"
        />
        <ThemedSelect
          filterable
          options={licenseOptions}
          value={activeLicense ?? ''}
          onValueChange={(v) => setActiveLicense(v || null)}
          placeholder="License"
          wrapperClassName="w-[170px]"
          className="!py-1.5 !text-sm"
        />
      </div>

      {/* Responsive auto-fill grid */}
      <div className="grid [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))] gap-2.5">
        {filteredConnectors.map((connector) => {
          const isOwned = ownedServiceTypes.has(connector.name);
          const authMethods = getAuthMethods(connector);
          const tier = getLicenseTier(connector.name, connector.metadata as Record<string, unknown> | null);
          const tierMeta = LICENSE_TIER_META[tier];
          const TierIcon = LICENSE_ICON[tier];

          return (
            <button
              key={connector.id}
              onClick={() => onPickType(connector)}
              className={`group relative flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all transition-transform hover:scale-[1.02] ${
                isOwned
                  ? 'bg-emerald-500/8 border-emerald-500/20 hover:bg-emerald-500/15'
                  : 'bg-secondary/25 border-primary/15 hover:bg-secondary/50 hover:border-primary/25'
              }`}
            >
              {/* Auth method icons — top-left corner */}
              <div className="absolute top-1.5 left-1.5 flex flex-col gap-1 z-10 opacity-20 group-hover:opacity-100 transition-opacity duration-200">
                {authMethods.map((m) => {
                  const Icon = getAuthIcon(m);
                  return (
                    <span
                      key={m.id}
                      title={m.label}
                      className={`inline-flex items-center justify-center w-7 h-7 rounded-lg backdrop-blur-sm border ${getAuthBadgeClasses(m)}`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                  );
                })}
              </div>

              {/* License tier badge — top-right corner */}
              <span
                className={`absolute top-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-lg border opacity-20 group-hover:opacity-100 transition-opacity duration-200 ${tierMeta.bgClass} ${tierMeta.borderClass}`}
                title={`${tierMeta.label} license`}
              >
                <TierIcon className={`w-3 h-3 ${tierMeta.textClass}`} />
              </span>

              {/* Large icon */}
              <div
                className="w-14 h-14 min-w-14 min-h-14 rounded-xl flex items-center justify-center border"
                style={{
                  backgroundColor: `${connector.color}12`,
                  borderColor: `${connector.color}25`,
                }}
              >
                {connector.icon_url ? (
                  <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-10 h-10" />
                ) : (
                  <Plug className="w-8 h-8" style={{ color: connector.color }} />
                )}
              </div>

              {/* Label */}
              <span className="text-base font-semibold text-foreground/90 truncate w-full leading-tight">
                {connector.label}
              </span>
            </button>
          );
        })}
      </div>

      {filteredConnectors.length === 0 && (
        <div className="py-6 text-center text-sm text-muted-foreground/90 border border-dashed border-primary/15 rounded-lg">
          No connectors found
        </div>
      )}

    </div>
  );
}
