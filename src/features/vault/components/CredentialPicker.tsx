import { useState, useMemo, useEffect } from 'react';
import { Plug, ExternalLink } from 'lucide-react';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';
import { getAuthMethods } from '@/lib/types/types';
import { getAuthBadgeClasses } from '@/features/vault/utils/authMethodStyles';

interface CredentialPickerProps {
  connectors: ConnectorDefinition[];
  credentials: CredentialMetadata[];
  onPickType: (connector: ConnectorDefinition) => void;
  searchTerm?: string;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function CredentialPicker({ connectors, credentials, onPickType, searchTerm }: CredentialPickerProps) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const ownedServiceTypes = useMemo(() => {
    const set = new Set<string>();
    for (const c of credentials) set.add(c.service_type);
    return set;
  }, [credentials]);

  const categoryTabs = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of connectors) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category, count]) => ({ category, count, label: capitalize(category) }));
  }, [connectors]);

  const filteredConnectors = activeCategory
    ? connectors.filter((c) => c.category === activeCategory)
    : connectors;

  useEffect(() => {
    if (searchTerm?.trim()) setActiveCategory(null);
  }, [searchTerm]);

  return (
    <div className="space-y-3">
      {/* Category tabs */}
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
            activeCategory === null
              ? 'bg-primary/15 text-primary border-primary/25'
              : 'bg-secondary/25 text-muted-foreground/70 border-primary/10 hover:bg-secondary/40'
          }`}
        >
          All ({connectors.length})
        </button>
        {categoryTabs.map((tab) => (
          <button
            key={tab.category}
            onClick={() => setActiveCategory(tab.category)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
              activeCategory === tab.category
                ? 'bg-primary/15 text-primary border-primary/25'
                : 'bg-secondary/25 text-muted-foreground/70 border-primary/10 hover:bg-secondary/40'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>

      {/* 4-column grid */}
      <div className="grid grid-cols-4 gap-2.5">
        {filteredConnectors.map((connector) => {
          const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
          const docsUrl = typeof metadata.docs_url === 'string' ? metadata.docs_url : null;
          const isOwned = ownedServiceTypes.has(connector.name);
          const authMethods = getAuthMethods(connector);

          return (
            <button
              key={connector.id}
              onClick={() => onPickType(connector)}
              className={`group relative flex flex-col items-center gap-2 p-4 rounded-xl border text-center transition-all ${
                isOwned
                  ? 'bg-emerald-500/8 border-emerald-500/20 hover:bg-emerald-500/15'
                  : 'bg-secondary/25 border-primary/15 hover:bg-secondary/50 hover:border-primary/25'
              }`}
            >
              {/* Auth method badges — top-left corner, stacked */}
              <div className="absolute top-1.5 left-1.5 flex flex-col gap-0.5 z-10">
                {authMethods.map((m) => (
                  <span
                    key={m.id}
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-md backdrop-blur-sm border ${getAuthBadgeClasses(m)}`}
                  >
                    {m.label}
                  </span>
                ))}
              </div>

              {/* Large icon */}
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center border"
                style={{
                  backgroundColor: `${connector.color}12`,
                  borderColor: `${connector.color}25`,
                }}
              >
                {connector.icon_url ? (
                  <img src={connector.icon_url} alt={connector.label} className="w-10 h-10" />
                ) : (
                  <Plug className="w-8 h-8" style={{ color: connector.color }} />
                )}
              </div>

              {/* Label */}
              <span className="text-base font-semibold text-foreground/90 truncate w-full leading-tight">
                {connector.label}
              </span>

              {/* Docs link on hover */}
              {docsUrl && (
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="absolute top-1.5 right-1.5 p-1 rounded-md opacity-0 group-hover:opacity-70 hover:!opacity-100 text-muted-foreground/60 hover:text-foreground transition-all"
                  title="How to get this credential"
                >
                  <ExternalLink className="w-3 h-3" />
                </a>
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
