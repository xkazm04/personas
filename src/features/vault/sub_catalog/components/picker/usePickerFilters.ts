import { useState, useMemo, useEffect, useCallback } from 'react';
import type { ThemedSelectOption } from '@/features/shared/components/forms/ThemedSelect';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { getPurposeForConnector, PURPOSE_GROUPS, resolvePurposeLabel } from '@/lib/credentials/connectorRoles';
import { getLicenseTier, resolveTierLabel, type LicenseTier } from '@/lib/credentials/connectorLicensing';
import type { RolePreset } from './catalogRolePresets';
import { connectorMatchesAudience } from '@/lib/credentials/connectorAudiences';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import type { CatalogSortMode } from '@/stores/slices/vault/catalogPrefsSlice';
import { useTranslation } from '@/i18n/useTranslation';
import type { RecipeIndicator } from './useRecipeIndicators';

/** Connectors with `created_at` newer than this are flagged with the "New" ribbon. */
export const NEW_CONNECTOR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function isConnectorRecent(createdAt: string, now: number = Date.now()): boolean {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  return now - t <= NEW_CONNECTOR_WINDOW_MS;
}

type ConnectedFilter = 'all' | 'connected' | 'new';
type FilterKey = 'category' | 'purpose' | 'connected' | 'license' | 'role';

function capitalize(s: string) {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function usePickerFilters(
  connectors: ConnectorDefinition[],
  credentials: CredentialMetadata[],
  searchTerm?: string,
  recipeIndicators?: Map<string, RecipeIndicator>,
) {
  const { t, tx } = useTranslation();
  const ps = t.vault.picker_section;
  const sortMode = useVaultStore((s) => s.catalogSortMode);
  const viewCounts = useVaultStore((s) => s.catalogConnectorViewCounts);
  const setSortMode = useVaultStore((s) => s.setCatalogSortMode);
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

  // Single filter pipeline. Pass `except` when computing the option list for a
  // given filter — the dropdown for "Purpose" should reflect counts after the
  // OTHER filters apply, not after the purpose filter applies to itself.
  //
  // Role-filter note: matching is per-connector via `connectorMatchesAudience`,
  // not via a category-to-role preset map. A connector declares its audiences
  // (`metadata.audiences`, falling back to `connectorAudiences.ts`) and the
  // filter aggregates emergently. Adding a new connector with a new category
  // no longer requires editing a separate ROLE_PRESETS table.
  const applyFilters = useCallback((list: ConnectorDefinition[], except?: FilterKey) => {
    let result = list;
    if (except !== 'category' && activeCategory) {
      result = result.filter((c) => c.category === activeCategory);
    }
    if (except !== 'purpose' && activePurpose) {
      result = result.filter((c) => getPurposeForConnector(c.name) === activePurpose);
    }
    if (except !== 'license' && activeLicense) {
      result = result.filter((c) => getLicenseTier(c.name, c.metadata) === activeLicense);
    }
    if (except !== 'connected') {
      if (connectedFilter === 'connected') result = result.filter((c) => ownedServiceTypes.has(c.name));
      else if (connectedFilter === 'new') result = result.filter((c) => !ownedServiceTypes.has(c.name));
    }
    if (except !== 'role' && activeRole) {
      result = result.filter((c) => connectorMatchesAudience(c.name, c.metadata, activeRole));
    }
    return result;
  }, [activeCategory, activePurpose, activeLicense, connectedFilter, activeRole, ownedServiceTypes]);

  const purposeBase = useMemo(() => applyFilters(connectors, 'purpose'), [connectors, applyFilters]);
  const categoryBase = useMemo(() => applyFilters(connectors, 'category'), [connectors, applyFilters]);
  const connectedBase = useMemo(() => applyFilters(connectors, 'connected'), [connectors, applyFilters]);
  const licenseBase = useMemo(() => applyFilters(connectors, 'license'), [connectors, applyFilters]);

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

  // Localized category labels (purpose/license already resolve through their
  // own label helpers; categories used to fall through to capitalize(), so a
  // category rendered as a capitalized English identifier in every locale).
  // Known built-in categories resolve here; user-defined categories fall back
  // to capitalize().
  const categoryLabels = t.vault.connector_categories as Record<string, string>;
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
          label: tx(ps.filter_count, { label: categoryLabels[cat] ?? capitalize(cat), count }),
        });
      });
    return opts;
  }, [categoryBase, tx, ps.filter_all_categories, ps.filter_count, categoryLabels]);

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

  const credentialUsageByType = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of credentials) {
      m.set(c.service_type, (m.get(c.service_type) ?? 0) + (c.usage_count ?? 0));
    }
    return m;
  }, [credentials]);

  const popularityScore = useCallback((c: ConnectorDefinition) => {
    const credUse = credentialUsageByType.get(c.name) ?? 0;
    const recipeUse = recipeIndicators?.get(c.name)?.usageCount ?? 0;
    const localViews = viewCounts[c.name] ?? 0;
    return credUse + recipeUse + localViews;
  }, [credentialUsageByType, recipeIndicators, viewCounts]);

  const sortConnectors = useCallback((list: ConnectorDefinition[], mode: CatalogSortMode) => {
    const copy = list.slice();
    switch (mode) {
      case 'popular':
        return copy.sort((a, b) => {
          const diff = popularityScore(b) - popularityScore(a);
          return diff !== 0 ? diff : a.label.localeCompare(b.label);
        });
      case 'recently_added':
        return copy.sort((a, b) => {
          const tb = Date.parse(b.created_at);
          const ta = Date.parse(a.created_at);
          const safeTb = Number.isFinite(tb) ? tb : 0;
          const safeTa = Number.isFinite(ta) ? ta : 0;
          const diff = safeTb - safeTa;
          return diff !== 0 ? diff : a.label.localeCompare(b.label);
        });
      case 'most_used_with_recipes':
        return copy.sort((a, b) => {
          const rb = recipeIndicators?.get(b.name)?.usageCount ?? 0;
          const ra = recipeIndicators?.get(a.name)?.usageCount ?? 0;
          const diff = rb - ra;
          return diff !== 0 ? diff : a.label.localeCompare(b.label);
        });
      case 'alphabetical':
      default:
        return copy.sort((a, b) => a.label.localeCompare(b.label));
    }
  }, [popularityScore, recipeIndicators]);

  const filteredConnectors = useMemo(
    () => sortConnectors(applyFilters(connectors), sortMode),
    [connectors, applyFilters, sortMode, sortConnectors],
  );

  const sortOptions = useMemo<ThemedSelectOption[]>(() => [
    { value: 'alphabetical', label: ps.sort_alphabetical },
    { value: 'popular', label: ps.sort_popular },
    { value: 'recently_added', label: ps.sort_recently_added },
    { value: 'most_used_with_recipes', label: ps.sort_most_used_with_recipes },
  ], [ps.sort_alphabetical, ps.sort_popular, ps.sort_recently_added, ps.sort_most_used_with_recipes]);

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
    sortMode,
    sortOptions,
    setSortMode,
    setActiveCategory,
    setActivePurpose,
    setActiveLicense,
    setConnectedFilter: setConnectedFilter as (f: ConnectedFilter) => void,
    handleRoleToggle,
  };
}
