import { useState, useMemo, useEffect } from 'react';
import { Plug, DollarSign } from 'lucide-react';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses, getAuthIcon } from '@/features/vault/utils/authMethodStyles';
import { PURPOSE_GROUPS, getPurposeForConnector } from '@/lib/credentials/connectorRoles';

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

export function CredentialPicker({ connectors, credentials, onPickType, searchTerm }: CredentialPickerProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activePurpose, setActivePurpose] = useState<string | null>(null);
  const [connectedFilter, setConnectedFilter] = useState<ConnectedFilter>('all');

  const ownedServiceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const c of credentials) set.add(c.service_type);
    return set;
  }, [credentials]);

  // ── Cross-filter helpers ────────────────────────────────────────
  // Each filter row's counts are computed from connectors matching ALL OTHER
  // active filters, so the user sees how many results each option would yield.

  const applyConnected = (list: ConnectorDefinition[], filter: ConnectedFilter) => {
    if (filter === 'connected') return list.filter((c) => ownedServiceTypes.has(c.name));
    if (filter === 'new') return list.filter((c) => !ownedServiceTypes.has(c.name));
    return list;
  };

  const applyCategory = (list: ConnectorDefinition[], cat: string | null) =>
    cat ? list.filter((c) => c.category === cat) : list;

  const applyPurpose = (list: ConnectorDefinition[], purpose: string | null) =>
    purpose ? list.filter((c) => getPurposeForConnector(c.name) === purpose) : list;

  // Base for purpose filter counts = connectors filtered by category + connected
  const purposeBase = useMemo(
    () => applyConnected(applyCategory(connectors, activeCategory), connectedFilter),
    [connectors, activeCategory, connectedFilter, ownedServiceTypes],
  );

  // Base for category filter counts = connectors filtered by purpose + connected
  const categoryBase = useMemo(
    () => applyConnected(applyPurpose(connectors, activePurpose), connectedFilter),
    [connectors, activePurpose, connectedFilter, ownedServiceTypes],
  );

  // Base for connected filter counts = connectors filtered by purpose + category
  const connectedBase = useMemo(
    () => applyCategory(applyPurpose(connectors, activePurpose), activeCategory),
    [connectors, activePurpose, activeCategory],
  );

  // ── Tab data with cross-filtered counts ─────────────────────────

  const purposeTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of purposeBase) {
      const p = getPurposeForConnector(c.name);
      if (p) counts[p] = (counts[p] || 0) + 1;
    }
    return PURPOSE_GROUPS
      .filter((pg) => counts[pg.purpose])
      .map((pg) => ({ purpose: pg.purpose, label: pg.label, count: counts[pg.purpose] }));
  }, [purposeBase]);

  const categoryTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of categoryBase) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, count]) => ({ category, count, label: capitalize(category) }));
  }, [categoryBase]);

  const connectedCounts = useMemo(() => {
    let connected = 0;
    let fresh = 0;
    for (const c of connectedBase) {
      if (ownedServiceTypes.has(c.name)) connected++;
      else fresh++;
    }
    return { all: connectedBase.length, connected, new: fresh };
  }, [connectedBase, ownedServiceTypes]);

  // ── Final filtered list (all three filters applied) ─────────────

  const filteredConnectors = useMemo(() => {
    let result = connectors;
    if (activeCategory) result = result.filter((c) => c.category === activeCategory);
    if (activePurpose) result = result.filter((c) => getPurposeForConnector(c.name) === activePurpose);
    if (connectedFilter === 'connected') result = result.filter((c) => ownedServiceTypes.has(c.name));
    if (connectedFilter === 'new') result = result.filter((c) => !ownedServiceTypes.has(c.name));
    return result;
  }, [connectors, activeCategory, activePurpose, connectedFilter, ownedServiceTypes]);

  // Reset filters when search text arrives
  useEffect(() => {
    if (searchTerm?.trim()) {
      setActiveCategory(null);
      setActivePurpose(null);
      setConnectedFilter('all');
    }
  }, [searchTerm]);

  return (
    <div className="space-y-3">
      {/* Connected filter */}
      <div className="flex flex-wrap gap-1.5">
        {([
          { key: 'all' as const, label: 'All', count: connectedCounts.all, active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
          { key: 'connected' as const, label: 'Connected', count: connectedCounts.connected, active: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
          { key: 'new' as const, label: 'New', count: connectedCounts.new, active: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setConnectedFilter(connectedFilter === tab.key && tab.key !== 'all' ? 'all' : tab.key)}
            className={`px-2.5 py-1 rounded-lg text-md font-medium border transition-all ${
              connectedFilter === tab.key
                ? tab.active
                : 'bg-secondary/25 text-muted-foreground/70 border-primary/10 hover:bg-secondary/40'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Purpose filter */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActivePurpose(null)}
          className={`px-2.5 py-1 rounded-lg text-md font-medium border transition-all ${
            activePurpose === null
              ? 'bg-violet-500/15 text-violet-400 border-violet-500/25'
              : 'bg-secondary/25 text-muted-foreground/70 border-primary/10 hover:bg-secondary/40'
          }`}
        >
          All Purposes
        </button>
        {purposeTabs.map((tab) => (
          <button
            key={tab.purpose}
            onClick={() => setActivePurpose(activePurpose === tab.purpose ? null : tab.purpose)}
            className={`px-2.5 py-1 rounded-lg text-md font-medium border transition-all ${
              activePurpose === tab.purpose
                ? 'bg-violet-500/15 text-violet-400 border-violet-500/25'
                : 'bg-secondary/25 text-muted-foreground/70 border-primary/10 hover:bg-secondary/40'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2.5 py-1 rounded-lg text-md font-medium border transition-all ${
            activeCategory === null
              ? 'bg-primary/15 text-primary border-primary/25'
              : 'bg-secondary/25 text-muted-foreground/70 border-primary/10 hover:bg-secondary/40'
          }`}
        >
          All ({categoryBase.length})
        </button>
        {categoryTabs.map((tab) => (
          <button
            key={tab.category}
            onClick={() => setActiveCategory(activeCategory === tab.category ? null : tab.category)}
            className={`px-2.5 py-1 rounded-lg text-md font-medium border transition-all ${
              activeCategory === tab.category
                ? 'bg-primary/15 text-primary border-primary/25'
                : 'bg-secondary/25 text-muted-foreground/70 border-primary/10 hover:bg-secondary/40'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* Responsive auto-fill grid */}
      <div className="grid [grid-template-columns:repeat(auto-fill,minmax(9rem,1fr))] gap-2.5">
        {filteredConnectors.map((connector) => {
          const isOwned = ownedServiceTypes.has(connector.name);
          const authMethods = getAuthMethods(connector);

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
              {/* Auth method icons — top-left corner, stacked, 20% → 100% on hover */}
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

              {/* Large icon */}
              <div
                className="w-14 h-14 min-w-14 min-h-14 rounded-xl flex items-center justify-center border"
                style={{
                  backgroundColor: `${connector.color}12`,
                  borderColor: `${connector.color}25`,
                }}
              >
                {connector.icon_url ? (
                  <img src={connector.icon_url} alt={connector.label} className="w-10 h-10" referrerPolicy="no-referrer" crossOrigin="anonymous" />
                ) : (
                  <Plug className="w-8 h-8" style={{ color: connector.color }} />
                )}
              </div>

              {/* Label */}
              <span className="text-base font-semibold text-foreground/90 truncate w-full leading-tight">
                {connector.label}
              </span>

              {/* Paid-only indicator — top-right */}
              {((connector.metadata as Record<string, unknown> | undefined)?.pricing_tier === 'paid') && (
                <span
                  className="absolute top-1.5 right-1.5 inline-flex items-center justify-center w-6 h-6 rounded-lg bg-amber-500/10 border border-amber-500/20 opacity-20 group-hover:opacity-100 transition-opacity duration-200"
                  title="Paid plan required"
                >
                  <DollarSign className="w-3 h-3 text-amber-400" />
                </span>
              )}
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
