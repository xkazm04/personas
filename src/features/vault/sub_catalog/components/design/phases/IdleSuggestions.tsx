import { useState } from 'react';
import { Plug } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { ConnectorDefinition } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

interface IdleSuggestionsProps {
  templateSearch: string;
  onTemplateSearchChange: (value: string) => void;
  templateConnectors: ConnectorDefinition[];
  expandedTemplateId: string | null;
  onExpandTemplate: (id: string | null) => void;
  onApplyTemplate: (connectorName: string) => void | Promise<void>;
}

export function IdleSuggestions({
  templateSearch,
  onTemplateSearchChange,
  templateConnectors,
  expandedTemplateId,
  onExpandTemplate,
  onApplyTemplate,
}: IdleSuggestionsProps) {
  const { t } = useTranslation();
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);

  return (
    <div className="p-3 rounded-modal border border-primary/15 bg-secondary/20 space-y-2">
      <p className="text-sm text-foreground">{t.vault.design_phases.saved_catalog}</p>
      <input
        type="text"
        value={templateSearch}
        onChange={(e) => onTemplateSearchChange(e.target.value)}
        placeholder={t.vault.design_phases.search_catalog}
        className="w-full px-3 py-1.5 rounded-modal border border-primary/15 bg-background/40 text-sm text-foreground placeholder-muted-foreground/40 focus-ring"
      />
      {templateConnectors.length === 0 ? (
        <p className="text-sm text-foreground">{t.vault.design_phases.no_catalog}</p>
      ) : (
        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
          {templateConnectors.map((conn) => (
            <div key={conn.id} className="rounded-card border border-primary/10 bg-background/30 overflow-hidden">
              <div
                onClick={() => onExpandTemplate(expandedTemplateId === conn.id ? null : conn.id)}
                className="w-full px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-secondary/40 transition-colors text-left cursor-pointer"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-6 h-6 rounded-card border flex items-center justify-center"
                    style={{
                      backgroundColor: `${conn.color}15`,
                      borderColor: `${conn.color}30`,
                    }}
                  >
                    <Plug className="w-3.5 h-3.5" style={{ color: conn.color }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-foreground truncate">{conn.label}</p>
                    <p className="text-sm text-foreground truncate">{conn.category}</p>
                  </div>
                </div>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    setApplyingTemplateId(conn.id);
                    try {
                      await Promise.resolve(onApplyTemplate(conn.name));
                    } finally {
                      setApplyingTemplateId(null);
                    }
                  }}
                  disabled={applyingTemplateId === conn.id}
                  className="px-2 py-1 text-sm rounded-card border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
                >
                  {applyingTemplateId === conn.id ? (
                    <span className="inline-flex items-center gap-1">
                      <LoadingSpinner size="sm" />
                      Loading...
                    </span>
                  ) : (
                    'Use'
                  )}
                </button>
              </div>
              {expandedTemplateId === conn.id && (
                <div
                  className="animate-fade-slide-in overflow-hidden border-t border-primary/10"
                >
                  <div className="px-2.5 py-2 text-sm text-foreground">
                    {(() => {
                      const meta = (conn.metadata ?? {}) as Record<string, unknown>;
                      if (typeof meta.summary === 'string' && meta.summary.trim()) {
                        return meta.summary;
                      }
                      return `${conn.fields.length} fields`;
                    })()}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
