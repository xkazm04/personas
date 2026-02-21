import { Wrench, Zap, Link } from 'lucide-react';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface N8nToolsPreviewTabProps {
  parsedResult: DesignAnalysisResult;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  onGoToAnalyze?: () => void;
}

export function N8nToolsPreviewTab({
  parsedResult,
  selectedToolIndices,
  selectedTriggerIndices,
  selectedConnectorNames,
  onGoToAnalyze,
}: N8nToolsPreviewTabProps) {
  const selectedTools = parsedResult.suggested_tools.filter((_, i) => selectedToolIndices.has(i));
  const selectedTriggers = parsedResult.suggested_triggers.filter((_, i) => selectedTriggerIndices.has(i));
  const selectedConnectors = (parsedResult.suggested_connectors ?? []).filter((c) =>
    selectedConnectorNames.has(c.name),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground/50">
          These items from your n8n workflow will be associated with this persona.
        </p>
        {onGoToAnalyze && (
          <button
            onClick={onGoToAnalyze}
            className="px-3 py-1.5 text-[11px] rounded-lg border border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 transition-colors"
          >
            Edit Selection
          </button>
        )}
      </div>

      {/* Tools */}
      {selectedTools.length > 0 && (
        <div className="bg-secondary/20 border border-primary/10 rounded-2xl p-4">
          <h5 className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2.5">
            <Wrench className="w-3 h-3" />
            Tools ({selectedTools.length})
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {selectedTools.map((tool) => (
              <span
                key={tool}
                className="px-2.5 py-1 text-[10px] font-mono rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20"
              >
                {tool}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Triggers */}
      {selectedTriggers.length > 0 && (
        <div className="bg-secondary/20 border border-primary/10 rounded-2xl p-4">
          <h5 className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2.5">
            <Zap className="w-3 h-3" />
            Triggers ({selectedTriggers.length})
          </h5>
          <div className="space-y-1.5">
            {selectedTriggers.map((trigger, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-foreground/60">
                <span className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  {trigger.trigger_type}
                </span>
                <span className="truncate">{trigger.description}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Connectors */}
      {selectedConnectors.length > 0 && (
        <div className="bg-secondary/20 border border-primary/10 rounded-2xl p-4">
          <h5 className="flex items-center gap-2 text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2.5">
            <Link className="w-3 h-3" />
            Connectors ({selectedConnectors.length})
          </h5>
          <div className="flex flex-wrap gap-1.5">
            {selectedConnectors.map((conn) => (
              <span
                key={conn.name}
                className="px-2.5 py-1 text-[10px] font-medium rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              >
                {conn.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {selectedTools.length === 0 && selectedTriggers.length === 0 && selectedConnectors.length === 0 && (
        <div className="text-center py-8 text-muted-foreground/30 text-xs">
          No items selected. Go back to the Analyze step to select tools and triggers.
        </div>
      )}
    </div>
  );
}
