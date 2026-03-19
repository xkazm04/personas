import { motion, AnimatePresence } from 'framer-motion';
import { Plug, Sparkles, Bot, Import } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useState } from 'react';
import { QUICK_SERVICE_HINTS, HINT_COLORS } from '@/features/vault/sub_design/CredentialDesignHelpers';
import type { ConnectorDefinition } from '@/lib/types/types';

interface IdlePhaseProps {
  instruction: string;
  onInstructionChange: (value: string) => void;
  onStart: () => void;
  onAutoSetup?: () => void;
  onImportFrom?: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  showTemplates: boolean;
  onToggleTemplates: () => void;
  templateSearch: string;
  onTemplateSearchChange: (value: string) => void;
  templateConnectors: ConnectorDefinition[];
  expandedTemplateId: string | null;
  onExpandTemplate: (id: string | null) => void;
  onApplyTemplate: (connectorName: string) => void | Promise<void>;
}

export function IdlePhase({
  instruction,
  onInstructionChange,
  onStart,
  onAutoSetup,
  onImportFrom,
  onKeyDown,
  showTemplates,
  onToggleTemplates,
  templateSearch,
  onTemplateSearchChange,
  templateConnectors,
  expandedTemplateId,
  onExpandTemplate,
  onApplyTemplate,
}: IdlePhaseProps) {
  const [applyingTemplateId, setApplyingTemplateId] = useState<string | null>(null);

  return (
    <motion.div
      key="input"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      <div className="text-sm text-muted-foreground/80">
        Describe the tool and credential type. Claude will generate the exact fields you need, then you can save them securely.
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={onToggleTemplates}
          className="px-2.5 py-1 text-sm rounded-xl border border-primary/20 text-primary hover:bg-primary/10 transition-colors"
        >
          From Catalog
        </button>

        {onImportFrom && (
          <button
            onClick={onImportFrom}
            className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-xl border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
          >
            <Import className="w-3.5 h-3.5" />
            Import from...
          </button>
        )}

        {QUICK_SERVICE_HINTS.map((hint) => (
          <button
            key={hint}
            onClick={() => onInstructionChange(hint)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-sm rounded-xl border border-primary/15 text-foreground/85 hover:bg-secondary/60 transition-colors"
            data-testid={`hint-chip-${hint.split(' ')[0]?.toLowerCase()}`}
          >
            <span
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: HINT_COLORS[hint] ?? '#888' }}
            />
            {hint}
          </button>
        ))}
      </div>

      {showTemplates && (
        <div className="p-3 rounded-xl border border-primary/15 bg-secondary/20 space-y-2">
          <p className="text-sm text-muted-foreground/75">Saved local catalog</p>
          <input
            type="text"
            value={templateSearch}
            onChange={(e) => onTemplateSearchChange(e.target.value)}
            placeholder="Search catalog"
            className="w-full px-3 py-1.5 rounded-xl border border-primary/15 bg-background/40 text-sm text-foreground placeholder-muted-foreground/40 focus-ring"
          />
          {templateConnectors.length === 0 ? (
            <p className="text-sm text-muted-foreground/90">No catalog entries yet. Save a successfully tested connector first.</p>
          ) : (
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {templateConnectors.map((conn) => (
                <div key={conn.id} className="rounded-lg border border-primary/10 bg-background/30 overflow-hidden">
                  <div
                    onClick={() => onExpandTemplate(expandedTemplateId === conn.id ? null : conn.id)}
                    className="w-full px-2.5 py-2 flex items-center justify-between gap-2 hover:bg-secondary/40 transition-colors text-left cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="w-6 h-6 rounded-lg border flex items-center justify-center"
                        style={{
                          backgroundColor: `${conn.color}15`,
                          borderColor: `${conn.color}30`,
                        }}
                      >
                        <Plug className="w-3.5 h-3.5" style={{ color: conn.color }} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-foreground truncate">{conn.label}</p>
                        <p className="text-sm text-muted-foreground/65 truncate">{conn.category}</p>
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
                      className="px-2 py-1 text-sm rounded-lg border border-primary/20 bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
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
                  <AnimatePresence>
                    {expandedTemplateId === conn.id && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden border-t border-primary/10"
                      >
                        <div className="px-2.5 py-2 text-sm text-muted-foreground/80">
                          {(() => {
                            const meta = (conn.metadata ?? {}) as Record<string, unknown>;
                            if (typeof meta.summary === 'string' && meta.summary.trim()) {
                              return meta.summary;
                            }
                            return `${conn.fields.length} fields`;
                          })()}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <textarea
        value={instruction}
        onChange={(e) => onInstructionChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="e.g. Slack, OpenAI, GitHub, Stripe..."
        rows={3}
        autoFocus
        className="w-full px-4 py-3 bg-secondary/40 border border-primary/15 rounded-xl text-foreground text-sm placeholder-muted-foreground/30 focus-ring focus-visible:border-primary/40 transition-all resize-none"
      />
      <div className="flex justify-end gap-2.5">
        {onAutoSetup && (
          <button
            onClick={onAutoSetup}
            disabled={!instruction.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-cyan-600/20"
          >
            <Bot className="w-4 h-4" />
            Auto-Setup
          </button>
        )}
        <button
          onClick={onStart}
          disabled={!instruction.trim()}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed text-foreground rounded-xl text-sm font-medium transition-all shadow-lg shadow-primary/20"
        >
          <Sparkles className="w-4 h-4" />
          Design Credential
        </button>
      </div>
    </motion.div>
  );
}
