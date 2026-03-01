import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Key, LayoutTemplate, Sparkles, Plug, ArrowRight } from 'lucide-react';
import { CredentialCard } from '@/features/vault/components/CredentialCard';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';

/** Well-known service names for quick-start buttons. Matched by connector `name`. */
const QUICK_START_SERVICES = ['openai', 'slack', 'github', 'linear'] as const;

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

interface CredentialListProps {
  credentials: CredentialMetadata[];
  connectorDefinitions: ConnectorDefinition[];
  searchTerm?: string;
  onDelete: (id: string) => void;
  onQuickStart?: (connector: ConnectorDefinition) => void;
  onGoToCatalog?: () => void;
  onGoToAddNew?: () => void;
}

export function CredentialList({ credentials, connectorDefinitions, searchTerm, onDelete, onQuickStart, onGoToCatalog, onGoToAddNew }: CredentialListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getConnectorForType = (type: string): ConnectorDefinition | undefined => {
    const exact = connectorDefinitions.find((c) => c.name === type);
    if (exact) return exact;

    const normalizedType = type.toLowerCase();
    if (
      normalizedType.includes('google')
      || normalizedType === 'gmail'
      || normalizedType === 'google_calendar'
      || normalizedType === 'google_drive'
    ) {
      return connectorDefinitions.find((c) => {
        const metadata = (c.metadata ?? {}) as Record<string, unknown>;
        return metadata.oauth_type === 'google' || c.name === 'google_workspace_oauth_template';
      });
    }

    return undefined;
  };

  const filteredCredentials = credentials.filter((credential) => {
    const q = (searchTerm ?? '').trim().toLowerCase();
    if (!q) return true;
    const connector = getConnectorForType(credential.service_type);
    return (
      credential.name.toLowerCase().includes(q)
      || credential.service_type.toLowerCase().includes(q)
      || connector?.label.toLowerCase().includes(q)
    );
  });

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const grouped = useMemo(() => {
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
  }, [filteredCredentials, connectorDefinitions]);

  return (
    <motion.div
      key="list"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="space-y-2"
    >
      {grouped.map(({ category, items }, gi) => (
        <div key={category}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/40 mb-2 ${gi > 0 ? 'mt-4' : ''}`}>
            {capitalize(category)}
          </p>
          {items.map(({ credential, connector }) => (
            <CredentialCard
              key={credential.id}
              credential={credential}
              connector={connector}
              isExpanded={expandedId === credential.id}
              onToggleExpand={() => toggleExpand(credential.id)}
              onDelete={onDelete}
            />
          ))}
        </div>
      ))}

      {filteredCredentials.length === 0 && credentials.length > 0 && (
        <div className="text-center py-10 text-muted-foreground/80 text-sm">
          No credentials match your search
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
            <div className="w-12 h-12 mx-auto rounded-2xl bg-secondary/60 border border-primary/15 flex items-center justify-center mb-3">
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
                      <img src={c.icon_url} alt={c.label} className="w-3 h-3" />
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
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-primary/10 bg-secondary/20 hover:bg-secondary/50 hover:border-primary/20 transition-all text-sm"
                    >
                      <div
                        className="w-4.5 h-4.5 rounded flex items-center justify-center"
                        style={{ backgroundColor: `${connector.color}15` }}
                      >
                        {connector.icon_url ? (
                          <img src={connector.icon_url} alt={connector.label} className="w-3 h-3" />
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
    </motion.div>
  );
}
