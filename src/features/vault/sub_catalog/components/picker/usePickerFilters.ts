import { useState, useMemo, useEffect } from 'react';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { getPurposeForConnector, PURPOSE_GROUPS, resolvePurposeLabel } from '@/lib/credentials/connectorRoles';
import { getLicenseTier, resolveTierLabel, type LicenseTier } from '@/lib/credentials/connectorLicensing';
import { ROLE_PRESETS, type RolePreset, assertRolePresetCategoriesValid } from './catalogRolePresets';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';

type ConnectedFilter = 'all' | 'connected' | 'new';

function capitalize(s: string) {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function usePickerFilters(connectors: ConnectorDefinition[], credentials: CredentialMetadata[], searchTerm?: string) {
  const { t, tx } = useTranslation();
  const ps = t.vault.picker_section;
  // Consume any pending category filter set by another part of the app (e.g.
  // the template adoption modal redirecting to the catalog when a credential
  // is missing). Read inside useEffect with empty deps so the mount-time
  // snapshot is deterministic under concurrent rendering, and always clear
  // unconditionally so a stale value can't survive an unmount/remount race.
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  useEffect(() => {
    const pending = useSystemStore.getState().pendingCatalogCategoryFilter;
    if (pending) setActiveCategory(pending);
    useSystemStore.getState().setPendingCatalogCategoryFilter(null);
  }, []);
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

  // Dev-mode contract assertion: every category referenced by ROLE_PRESETS
  // must appear in at least one live connector. A Rust-side rename of
  // `connector-categories.json` without an update to `catalogRolePresets.ts`
  // would otherwise produce silent zero-result filters with no telemetry.
  // The check console.warns once whenever the connector list shape changes.
  useEffect(() => {
    if (connectors.length === 0) return;
    const live = new Set<string>();
    for (const c of connectors) live.add(c.category);
    assertRolePresetCategoriesValid(live);
  }, [connectors]);

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
      ? list.filter((c) => getLicenseTier(c.name, c.metadata) === license)
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
    const opts: ThemedSelectOption[] = [
      { value: '', label: tx(ps.filter_all_purposes, { count: Object.keys(counts).length }) },
    ];
    for (const pg of PURPOSE_GROUPS) {
      const count = counts[pg.purpose];
      if (count) {
        opts.push({
          value: pg.purpose,
          label: tx(ps.filter_count, { label: resolvePurposeLabel(pg, t), count }),
        });
      }
    }
    return opts;
  }, [purposeBase, t, tx, ps.filter_all_purposes, ps.filter_count]);

  const categoryOptions = useMemo<ThemedSelectOption[]>(() => {
    const counts: Record<string, number> = {};
    for (const c of categoryBase) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }
    const opts: ThemedSelectOption[] = [
      { value: '', label: tx(ps.filter_all_categories, { count: Object.keys(counts).length }) },
    ];
    Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .forEach(([cat, count]) => {
        opts.push({
          value: cat,
          label: tx(ps.filter_count, { label: capitalize(cat), count }),
        });
      });
    return opts;
  }, [categoryBase, tx, ps.filter_all_categories, ps.filter_count]);

  const connectedOptions = useMemo<ThemedSelectOption[]>(() => {
    let connected = 0;
    let fresh = 0;
    for (const c of connectedBase) {
      if (ownedServiceTypes.has(c.name)) connected++;
      else fresh++;
    }
    const statusCount = (connected > 0 ? 1 : 0) + (fresh > 0 ? 1 : 0);
    const opts: ThemedSelectOption[] = [
      { value: 'all', label: tx(ps.filter_status_all, { count: statusCount }) },
    ];
    if (connected > 0) opts.push({ value: 'connected', label: tx(ps.filter_status_connected, { count: connected }) });
    if (fresh > 0) opts.push({ value: 'new', label: tx(ps.filter_status_new, { count: fresh }) });
    return opts;
  }, [connectedBase, ownedServiceTypes, tx, ps.filter_status_all, ps.filter_status_connected, ps.filter_status_new]);

  const licenseOptions = useMemo<ThemedSelectOption[]>(() => {
    const counts: Record<string, number> = {};
    for (const c of licenseBase) {
      const tier = getLicenseTier(c.name, c.metadata);
      counts[tier] = (counts[tier] || 0) + 1;
    }
    const opts: ThemedSelectOption[] = [
      { value: '', label: tx(ps.filter_all_licenses, { count: Object.keys(counts).length }) },
    ];
    for (const tier of ['personal', 'paid', 'enterprise'] as LicenseTier[]) {
      const count = counts[tier];
      if (count) {
        opts.push({
          value: tier,
          label: tx(ps.filter_count, { label: resolveTierLabel(tier, t), count }),
        });
      }
    }
    return opts;
  }, [licenseBase, t, tx, ps.filter_all_licenses, ps.filter_count]);

  const filteredConnectors = useMemo(() => {
    let result = connectors;
    if (activeCategory) result = result.filter((c) => c.category === activeCategory);
    if (activePurpose) result = result.filter((c) => getPurposeForConnector(c.name) === activePurpose);
    if (activeLicense) result = result.filter((c) => getLicenseTier(c.name, c.metadata) === activeLicense);
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
