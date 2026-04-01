import { useState, useMemo, useEffect } from 'react';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { getPurposeForConnector, PURPOSE_GROUPS } from '@/lib/credentials/connectorRoles';
import { getLicenseTier, LICENSE_TIER_META, type LicenseTier } from '@/lib/credentials/connectorLicensing';
import { ROLE_PRESETS, type RolePreset } from './catalogRolePresets';

type ConnectedFilter = 'all' | 'connected' | 'new';

function capitalize(s: string) {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function usePickerFilters(connectors: ConnectorDefinition[], credentials: CredentialMetadata[], searchTerm?: string) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activePurpose, setActivePurpose] = useState<string | null>(null);
  const [activeLicense, setActiveLicense] = useState<string | null>(null);
  const [connectedFilter, setConnectedFilter] = useState<ConnectedFilter>('all');
  const [activeRole, setActiveRole] = useState<RolePreset | null>(null);

  const handleRoleToggle = (role: RolePreset) => {
    if (activeRole === role) {
      setActiveRole(null);
    } else {
      setActiveRole(role);
      setActiveCategory(null);
    }
  };

  const ownedServiceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const c of credentials) set.add(c.service_type);
    return set;
  }, [credentials]);

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

  const applyRole = (list: ConnectorDefinition[], role: RolePreset | null) =>
    role ? list.filter((c) => ROLE_PRESETS[role].categories.includes(c.category)) : list;

  const purposeBase = useMemo(
    () => applyRole(applyLicense(applyConnected(applyCategory(connectors, activeCategory), connectedFilter), activeLicense), activeRole),
    [connectors, activeCategory, connectedFilter, activeLicense, activeRole, ownedServiceTypes],
  );

  const categoryBase = useMemo(
    () => applyRole(applyLicense(applyConnected(applyPurpose(connectors, activePurpose), connectedFilter), activeLicense), activeRole),
    [connectors, activePurpose, connectedFilter, activeLicense, activeRole, ownedServiceTypes],
  );

  const connectedBase = useMemo(
    () => applyRole(applyLicense(applyCategory(applyPurpose(connectors, activePurpose), activeCategory), activeLicense), activeRole),
    [connectors, activePurpose, activeCategory, activeLicense, activeRole],
  );

  const licenseBase = useMemo(
    () => applyRole(applyConnected(applyCategory(applyPurpose(connectors, activePurpose), activeCategory), connectedFilter), activeRole),
    [connectors, activePurpose, activeCategory, connectedFilter, activeRole, ownedServiceTypes],
  );

  const purposeOptions = useMemo<ThemedSelectOption[]>(() => {
    const counts: Record<string, number> = {};
    for (const c of purposeBase) {
      const p = getPurposeForConnector(c.name);
      if (p) counts[p] = (counts[p] || 0) + 1;
    }
    const opts: ThemedSelectOption[] = [{ value: '', label: `All Purposes (${Object.keys(counts).length})` }];
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
    const opts: ThemedSelectOption[] = [{ value: '', label: `All Categories (${Object.keys(counts).length})` }];
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
    const statusCount = (connected > 0 ? 1 : 0) + (fresh > 0 ? 1 : 0);
    const opts: ThemedSelectOption[] = [
      { value: 'all', label: `All (${statusCount})` },
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
    const opts: ThemedSelectOption[] = [{ value: '', label: `All Licenses (${Object.keys(counts).length})` }];
    for (const tier of ['personal', 'paid', 'enterprise'] as LicenseTier[]) {
      if (counts[tier]) {
        opts.push({ value: tier, label: `${LICENSE_TIER_META[tier].label} (${counts[tier]})` });
      }
    }
    return opts;
  }, [licenseBase]);

  const filteredConnectors = useMemo(() => {
    let result = connectors;
    if (activeCategory) result = result.filter((c) => c.category === activeCategory);
    if (activePurpose) result = result.filter((c) => getPurposeForConnector(c.name) === activePurpose);
    if (activeLicense) result = result.filter((c) => getLicenseTier(c.name, c.metadata as Record<string, unknown> | null) === activeLicense);
    if (connectedFilter === 'connected') result = result.filter((c) => ownedServiceTypes.has(c.name));
    if (connectedFilter === 'new') result = result.filter((c) => !ownedServiceTypes.has(c.name));
    if (activeRole) {
      const roleCats = ROLE_PRESETS[activeRole].categories;
      result = result.filter((c) => roleCats.includes(c.category));
    }
    return result;
  }, [connectors, activeCategory, activePurpose, activeLicense, connectedFilter, activeRole, ownedServiceTypes]);

  useEffect(() => {
    if (searchTerm?.trim()) {
      setActiveCategory(null);
      setActivePurpose(null);
      setActiveLicense(null);
      setConnectedFilter('all');
      setActiveRole(null);
    }
  }, [searchTerm]);

  return {
    activeCategory,
    activePurpose,
    activeLicense,
    connectedFilter,
    activeRole,
    ownedServiceTypes,
    filteredConnectors,
    purposeOptions,
    categoryOptions,
    connectedOptions,
    licenseOptions,
    setActiveCategory,
    setActivePurpose,
    setActiveLicense,
    setConnectedFilter: setConnectedFilter as (f: ConnectedFilter) => void,
    handleRoleToggle,
  };
}
