import { useState } from 'react';
import { Plug, ChevronDown, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ConnectorDefinition } from '@/lib/types/types';
import { isGoogleOAuthConnector } from '@/lib/utils/connectors';

interface CredentialPickerProps {
  connectors: ConnectorDefinition[];
  onPickType: (connector: ConnectorDefinition) => void;
}

export function CredentialPicker({ connectors, onPickType }: CredentialPickerProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const isRecommended = (connector: ConnectorDefinition) => {
    const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
    return metadata.recommended === true || isGoogleOAuthConnector(connector);
  };

  const recommendedConnectors = connectors.filter(isRecommended);
  const otherConnectors = connectors.filter((c) => !isRecommended(c));

  const renderConnector = (connector: ConnectorDefinition) => {
    const isExpanded = expandedId === connector.id;
    const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
    const summary = typeof metadata.summary === 'string' ? metadata.summary : null;

    return (
      <div key={connector.id} className="rounded-lg border border-primary/15 bg-secondary/25 overflow-hidden">
        <button
          onClick={() => setExpandedId((prev) => (prev === connector.id ? null : connector.id))}
          className="w-full px-3 py-2.5 text-left hover:bg-secondary/50 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center border shrink-0"
              style={{
                backgroundColor: `${connector.color}15`,
                borderColor: `${connector.color}30`,
              }}
            >
              {connector.icon_url ? (
                <img src={connector.icon_url} alt={connector.label} className="w-4 h-4" />
              ) : (
                <Plug className="w-4 h-4" style={{ color: connector.color }} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground truncate">{connector.label}</p>
              <p className="text-sm text-muted-foreground/75 truncate">
                {connector.category} · {connector.fields.length} fields
              </p>
            </div>

            {isExpanded ? (
              <ChevronDown className="w-4 h-4 text-muted-foreground/80" />
            ) : (
              <ChevronRight className="w-4 h-4 text-muted-foreground/80" />
            )}
          </div>
        </button>

        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-primary/10"
            >
              <div className="px-3 py-2.5 space-y-2">
                {summary && (
                  <p className="text-sm text-muted-foreground/80">{summary}</p>
                )}
                <button
                  onClick={() => onPickType(connector)}
                  className="px-3 py-1.5 rounded-lg border border-primary/20 bg-primary/10 text-primary text-sm font-medium hover:bg-primary/15 transition-colors"
                >
                  Use Template
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-foreground/85">Select a template</p>

      {recommendedConnectors.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-mono uppercase tracking-wider text-primary/70">Recommended</p>
          {recommendedConnectors.map(renderConnector)}
        </div>
      )}

      {recommendedConnectors.length > 0 && otherConnectors.length > 0 && (
        <div className="flex items-center gap-2 py-1">
          <div className="h-px bg-primary/15 flex-1" />
          <span className="text-sm font-mono uppercase tracking-wider text-muted-foreground/45">All templates</span>
          <div className="h-px bg-primary/15 flex-1" />
        </div>
      )}

      {otherConnectors.map(renderConnector)}

      {connectors.length === 0 && (
        <div className="py-6 text-center text-sm text-muted-foreground/90 border border-dashed border-primary/15 rounded-lg">
          No templates found
        </div>
      )}
    </div>
  );
}
