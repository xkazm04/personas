import { useState, useMemo, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Key, LayoutTemplate, Sparkles, Plug, ArrowRight, ChevronDown, Tag, X, Globe } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { CredentialCard } from '@/features/vault/sub_card/CredentialCard';
import { CredentialPlaygroundModal } from '@/features/vault/sub_playground/CredentialPlaygroundModal';
import { SchemaManagerModal } from '@/features/vault/sub_databases/SchemaManagerModal';
import { collectAllTags, getCredentialTags, getTagStyle } from '@/features/vault/utils/credentialTags';
import { computeHealthScore } from '@/features/vault/utils/credentialHealthScore';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

/** Well-known service names for quick-start buttons. Matched by connector `name`. */
const QUICK_START_SERVICES = ['openai', 'slack', 'github', 'linear'] as const;

function capitalize(s: string) {
  return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// ── Filter types ─────────────────────────────────────────────────────

type HealthFilter = 'all' | 'healthy' | 'failing' | 'untested';
type SortKey = 'name' | 'created' | 'last-used' | 'health';

function healthFilterLabel(f: HealthFilter): string {
  switch (f) {
    case 'all': return 'All health';
    case 'healthy': return 'Healthy';
    case 'failing': return 'Failing';
    case 'untested': return 'Untested';
  }
}

function sortLabel(s: SortKey): string {
  switch (s) {
    case 'name': return 'Name';
    case 'created': return 'Created';
    case 'last-used': return 'Last used';
    case 'health': return 'Health status';
  }
}

// ── Component ────────────────────────────────────────────────────────

interface CredentialListProps {
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  searchTerm?: string;
  onDelete: (id: string) => void;
  onQuickStart?: (connector: ConnectorDefinition) => void;
  onGoToCatalog?: () => void;
  onGoToAddNew?: () => void;
  onWorkspaceConnect?: () => void;
}

export function CredentialList({ credentials, connectorDefinitions, searchTerm, onDelete, onQuickStart, onGoToCatalog, onGoToAddNew, onWorkspaceConnect }: CredentialListProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [openDropdown, setOpenDropdown] = useState<'health' | 'sort' | null>(null);

  const allTags = useMemo(() => collectAllTags(credentials), [credentials]);
  const hasFilters = selectedTags.length > 0 || healthFilter !== 'all';

  const connectorMap = useMemo(() => {
    const map = new Map<string, ConnectorDefinition>();
    for (const connector of connectorDefinitions) {
      map.set(connector.name, connector);
    }
    return map;
  }, [connectorDefinitions]);

  const googleFallbackConnector = useMemo(
    () => connectorDefinitions.find((c) => {
      const metadata = (c.metadata ?? {}) as Record<string, unknown>;
      return metadata.oauth_type === 'google' || c.name === 'google_workspace_oauth_template';
    }),
    [connectorDefinitions],
  );

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag],
    );
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedTags([]);
    setHealthFilter('all');
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenDropdown(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const getConnectorForType = useCallback((type: string): ConnectorDefinition | undefined => {
    const exact = connectorMap.get(type);
    if (exact) return exact;

    const normalizedType = type.toLowerCase();
    if (
      normalizedType.includes('google')
      || normalizedType === 'gmail'
      || normalizedType === 'google_calendar'
      || normalizedType === 'google_drive'
    ) {
      return googleFallbackConnector;
    }

    return undefined;
  }, [connectorMap, googleFallbackConnector]);

  const filteredCredentials = useMemo(() => {
    let result = credentials;

    // Text search
    const q = (searchTerm ?? '').trim().toLowerCase();
    if (q) {
      result = result.filter((credential) => {
        const connector = getConnectorForType(credential.service_type);
        return (
          credential.name.toLowerCase().includes(q)
          || credential.service_type.toLowerCase().includes(q)
          || connector?.label.toLowerCase().includes(q)
        );
      });
    }

    // Tag filter
    if (selectedTags.length > 0) {
      result = result.filter((cred) => {
        const tags = getCredentialTags(cred);
        return selectedTags.some((t) => tags.includes(t));
      });
    }

    // Health filter
    if (healthFilter !== 'all') {
      result = result.filter((cred) => {
        if (healthFilter === 'untested') return cred.healthcheck_last_success === null;
        if (healthFilter === 'healthy') return cred.healthcheck_last_success === true;
        if (healthFilter === 'failing') return cred.healthcheck_last_success === false;
        return true;
      });
    }

    // Sort
    const sorted = [...result];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        case 'last-used': {
          const aTime = a.last_used_at ? new Date(a.last_used_at).getTime() : 0;
          const bTime = b.last_used_at ? new Date(b.last_used_at).getTime() : 0;
          return bTime - aTime;
        }
        case 'health': {
          const toResult = (m: CredentialMetadata) =>
            m.healthcheck_last_success !== null
              ? { success: m.healthcheck_last_success, message: m.healthcheck_last_message ?? '' }
              : null;
          const scoreA = computeHealthScore(toResult(a), null).score;
          const scoreB = computeHealthScore(toResult(b), null).score;
          return scoreA - scoreB; // lower score (worse health) sorts first
        }
        default:
          return 0;
      }
    });

    return sorted;
  }, [credentials, searchTerm, selectedTags, healthFilter, sortKey, getConnectorForType]);

  // Resolve selected credential + connector for modal
  const selectedCredential = selectedId ? credentials.find((c) => c.id === selectedId) : undefined;
  const selectedConnector = selectedCredential ? getConnectorForType(selectedCredential.service_type) : undefined;
  const selectedIsDatabase = selectedConnector?.category === 'database';

  const grouped = useMemo(() => {
    // When sorting is active (not name), skip category grouping for cleaner results
    if (sortKey !== 'name') {
      return [{ category: '', items: filteredCredentials.map((cred) => ({ credential: cred, connector: getConnectorForType(cred.service_type) })) }];
    }
    const groups: Record<string, { credential: CredentialMetadata; connector?: ConnectorDefinition }[]> = {};
    for (const cred of filteredCredentials) {
      const conn = getConnectorForType(cred.service_type);
      const cat = conn?.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push({ credential: cred, connector: conn });
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cat, items]) => ({ category: cat, items }));
  }, [filteredCredentials, sortKey, getConnectorForType]);

  // Only show filter bar when there are credentials
  const showFilterBar = credentials.length > 0 && (allTags.length > 0 || credentials.length > 3);

  return (
    <motion.div
      key="list"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-2"
    >
      {/* Filter bar */}
      {showFilterBar && (
        <div className="flex items-center gap-2 flex-wrap pb-1">
          {/* Tag chips */}
          {allTags.length > 0 && (
            <div className="flex items-center gap-1">
              <Tag className="w-3 h-3 text-muted-foreground/40 shrink-0" />
              {allTags.map((tag) => {
                const active = selectedTags.includes(tag);
                const style = getTagStyle(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`text-sm font-medium px-1.5 py-0.5 rounded border transition-colors ${
                      active
                        ? `${style.bg} ${style.text} ${style.border}`
                        : 'bg-secondary/30 text-muted-foreground/50 border-primary/10 hover:bg-secondary/50'
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          )}

          {/* Health filter dropdown */}
          <div className="relative">
            <button
              onClick={() => setOpenDropdown((v) => (v === 'health' ? null : 'health'))}
              aria-haspopup="listbox"
              aria-expanded={openDropdown === 'health'}
              className={`flex items-center gap-1 text-sm font-medium px-2 py-1 rounded border transition-colors ${
                healthFilter !== 'all'
                  ? 'bg-primary/10 text-primary border-primary/20'
                  : 'bg-secondary/30 text-muted-foreground/50 border-primary/10 hover:bg-secondary/50'
              }`}
            >
              {healthFilterLabel(healthFilter)}
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {openDropdown === 'health' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)} />
                <div role="listbox" className="absolute top-full mt-1 left-0 z-20 bg-background border border-primary/15 rounded-lg shadow-lg py-1 min-w-[100px]">
                  {(['all', 'healthy', 'failing', 'untested'] as HealthFilter[]).map((f) => (
                    <button
                      key={f}
                      role="option"
                      aria-selected={f === healthFilter}
                      onClick={() => { setHealthFilter(f); setOpenDropdown(null); }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/50 transition-colors ${
                        f === healthFilter ? 'text-primary font-medium' : 'text-foreground/80'
                      }`}
                    >
                      {healthFilterLabel(f)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Sort dropdown */}
          <div className="relative ml-auto">
            <button
              onClick={() => setOpenDropdown((v) => (v === 'sort' ? null : 'sort'))}
              aria-haspopup="listbox"
              aria-expanded={openDropdown === 'sort'}
              className="flex items-center gap-1 text-sm font-medium px-2 py-1 rounded border bg-secondary/30 text-muted-foreground/50 border-primary/10 hover:bg-secondary/50 transition-colors"
            >
              Sort: {sortLabel(sortKey)}
              <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {openDropdown === 'sort' && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setOpenDropdown(null)} />
                <div role="listbox" className="absolute top-full mt-1 right-0 z-20 bg-background border border-primary/15 rounded-lg shadow-lg py-1 min-w-[110px]">
                  {(['name', 'created', 'last-used', 'health'] as SortKey[]).map((s) => (
                    <button
                      key={s}
                      role="option"
                      aria-selected={s === sortKey}
                      onClick={() => { setSortKey(s); setOpenDropdown(null); }}
                      className={`w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/50 transition-colors ${
                        s === sortKey ? 'text-primary font-medium' : 'text-foreground/80'
                      }`}
                    >
                      {sortLabel(s)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* Clear filters */}
          {hasFilters && (
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-sm font-medium px-1.5 py-0.5 rounded border border-red-500/15 text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            >
              <X className="w-2.5 h-2.5" /> Clear
            </button>
          )}
        </div>
      )}

      {grouped.map(({ category, items }, gi) => (
        <div key={category || gi}>
          {category && (
            <p className={`text-sm font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2 ${gi > 0 ? 'mt-4' : ''}`}>
              {capitalize(category)}
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {items.map(({ credential, connector }) => (
              <CredentialCard
                key={credential.id}
                credential={credential}
                connector={connector}
                onSelect={() => setSelectedId(credential.id)}
                onDelete={onDelete}
              />
            ))}
          </div>
        </div>
      ))}

      {filteredCredentials.length === 0 && credentials.length > 0 && (
        <div className="text-center py-10 text-muted-foreground/80 text-sm">
          {hasFilters ? 'No credentials match your filters' : 'No credentials match your search'}
        </div>
      )}

      {credentials.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Heading */}
          <div className="text-center pt-6 pb-2">
            <div className="w-12 h-12 mx-auto rounded-xl bg-secondary/60 border border-primary/15 flex items-center justify-center mb-3">
              <Key className="w-6 h-6 text-muted-foreground/90" />
            </div>
            <h3 className="text-sm font-medium text-foreground/90">Connect your first service</h3>
            <p className="text-sm text-muted-foreground/80 mt-1">Choose how you want to add a credential</p>
          </div>

          {/* Two pathway cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* Catalog path */}
            <button
              onClick={() => onGoToCatalog?.()}
              className="group text-left p-4 rounded-xl border border-primary/15 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/25 transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
                <LayoutTemplate className="w-4.5 h-4.5 text-emerald-400" />
              </div>
              <p className="text-sm font-medium text-foreground/80 mb-1">Add from catalog</p>
              <p className="text-sm text-muted-foreground/90 leading-relaxed">
                Pick a known service like Slack, GitHub, or OpenAI. Pre-configured fields and healthchecks.
              </p>
              <div className="flex items-center gap-1.5 mt-3">
                {connectorDefinitions.slice(0, 4).map((c) => (
                  <div
                    key={c.id}
                    className="w-5 h-5 rounded border flex items-center justify-center"
                    style={{
                      backgroundColor: `${c.color}12`,
                      borderColor: `${c.color}25`,
                    }}
                    title={c.label}
                  >
                    {c.icon_url ? (
                      <ThemedConnectorIcon url={c.icon_url} label={c.label} color={c.color} size="w-3 h-3" />
                    ) : (
                      <Plug className="w-2.5 h-2.5" style={{ color: c.color }} />
                    )}
                  </div>
                ))}
                {connectorDefinitions.length > 4 && (
                  <span className="text-sm text-muted-foreground/80 ml-0.5">+{connectorDefinitions.length - 4}</span>
                )}
              </div>
            </button>

            {/* AI design path */}
            <button
              onClick={() => onGoToAddNew?.()}
              className="group text-left p-4 rounded-xl border border-primary/15 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/25 transition-all"
            >
              <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center mb-3">
                <Sparkles className="w-4.5 h-4.5 text-violet-400" />
              </div>
              <p className="text-sm font-medium text-foreground/80 mb-1">AI-designed credential</p>
              <p className="text-sm text-muted-foreground/90 leading-relaxed">
                Describe any service and AI will configure the fields, auth type, and healthcheck for you.
              </p>
              <span className="inline-flex items-center gap-1 mt-3 text-sm text-violet-400/60 group-hover:text-violet-400/80 transition-colors">
                Works with any API <ArrowRight className="w-3 h-3" />
              </span>
            </button>
          </div>

          {/* Workspace Connect — full width */}
          {onWorkspaceConnect && (
            <button
              onClick={onWorkspaceConnect}
              className="w-full text-left p-4 rounded-xl bg-gradient-to-r from-blue-500/5 to-emerald-500/5 border border-blue-500/15 hover:from-blue-500/10 hover:to-emerald-500/10 hover:border-blue-500/25 transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                  <Globe className="w-4.5 h-4.5 text-blue-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground/80">Workspace Connect</p>
                  <p className="text-sm text-muted-foreground/60">
                    One Google login creates Gmail, Calendar, Drive, and Sheets credentials
                  </p>
                </div>
              </div>
            </button>
          )}

          {/* Quick-start row */}
          {(() => {
            const quickConnectors = QUICK_START_SERVICES
              .map((name) => connectorDefinitions.find((c) => c.name.toLowerCase().includes(name)))
              .filter((c): c is ConnectorDefinition => c != null);

            if (quickConnectors.length === 0 || !onQuickStart) return null;

            return (
              <div className="space-y-2">
                <p className="text-sm font-mono uppercase tracking-wider text-muted-foreground/80 text-center">Quick start</p>
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {quickConnectors.map((connector) => (
                    <button
                      key={connector.id}
                      onClick={() => onQuickStart(connector)}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-xl border border-primary/10 bg-secondary/20 hover:bg-secondary/50 hover:border-primary/20 transition-all text-sm"
                    >
                      <div
                        className="w-4.5 h-4.5 rounded flex items-center justify-center"
                        style={{ backgroundColor: `${connector.color}15` }}
                      >
                        {connector.icon_url ? (
                          <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-3 h-3" />
                        ) : (
                          <Plug className="w-2.5 h-2.5" style={{ color: connector.color }} />
                        )}
                      </div>
                      <span className="text-foreground/80">{connector.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
        </motion.div>
      )}

      {/* Credential detail modal */}
      {selectedCredential && selectedIsDatabase && (
        <SchemaManagerModal
          credential={selectedCredential}
          connector={selectedConnector}
          onClose={() => setSelectedId(null)}
        />
      )}
      {selectedCredential && !selectedIsDatabase && (
        <CredentialPlaygroundModal
          credential={selectedCredential}
          connector={selectedConnector}
          onClose={() => setSelectedId(null)}
          onDelete={onDelete}
        />
      )}
    </motion.div>
  );
}
