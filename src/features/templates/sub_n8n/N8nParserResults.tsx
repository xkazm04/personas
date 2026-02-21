import { FileJson, Wrench, Zap, Link, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';

interface N8nParserResultsProps {
  parsedResult: DesignAnalysisResult;
  workflowName: string;
  onReset: () => void;
  selectedToolIndices?: Set<number>;
  selectedTriggerIndices?: Set<number>;
  selectedConnectorNames?: Set<string>;
  onToggleTool?: (index: number) => void;
  onToggleTrigger?: (index: number) => void;
  onToggleConnector?: (name: string) => void;
}

function SelectionCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`w-4 h-4 rounded-md flex items-center justify-center flex-shrink-0 transition-all duration-200 cursor-pointer ${
        checked
          ? 'bg-violet-500 border border-violet-500'
          : 'bg-secondary/40 border border-primary/20 hover:border-primary/40'
      }`}
    >
      <AnimatePresence>
        {checked && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 400, duration: 0.15 }}
          >
            <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}

export function N8nParserResults({
  parsedResult,
  workflowName,
  onReset,
  selectedToolIndices,
  selectedTriggerIndices,
  selectedConnectorNames,
  onToggleTool,
  onToggleTrigger,
  onToggleConnector,
}: N8nParserResultsProps) {
  const hasSelection = !!selectedToolIndices;

  const toolCount = selectedToolIndices?.size ?? parsedResult.suggested_tools.length;
  const triggerCount = selectedTriggerIndices?.size ?? parsedResult.suggested_triggers.length;
  const connectorCount = selectedConnectorNames?.size ?? (parsedResult.suggested_connectors?.length ?? 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
            <FileJson className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground/90">{workflowName}</h3>
            <p className="text-xs text-muted-foreground/50">{parsedResult.summary}</p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="px-3 py-1.5 text-xs rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/60 transition-colors"
        >
          Import Another
        </button>
      </div>

      {/* Selection summary */}
      {hasSelection && (
        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground/45">
          <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/15">
            {toolCount} tools
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/15">
            {triggerCount} triggers
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
            {connectorCount} connectors
          </span>
          <span className="text-muted-foreground/30 ml-1">selected for import</span>
        </div>
      )}

      {/* Tools */}
      <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
        {parsedResult.suggested_tools.length > 0 && (
          <div className="p-4">
            <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Wrench className="w-3 h-3" />
              Tools ({parsedResult.suggested_tools.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {parsedResult.suggested_tools.map((tool, i) => {
                const isSelected = selectedToolIndices?.has(i) ?? true;
                return (
                  <div
                    key={tool}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-150 ${
                      isSelected
                        ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                        : 'bg-secondary/30 text-muted-foreground/30 border-primary/10 opacity-60'
                    } ${onToggleTool ? 'cursor-pointer hover:opacity-80' : ''}`}
                    onClick={() => onToggleTool?.(i)}
                  >
                    {hasSelection && (
                      <SelectionCheckbox
                        checked={isSelected}
                        onChange={() => onToggleTool?.(i)}
                      />
                    )}
                    <span className="text-[10px] font-mono">{tool}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Triggers */}
        {parsedResult.suggested_triggers.length > 0 && (
          <div className="p-4">
            <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Zap className="w-3 h-3" />
              Triggers ({parsedResult.suggested_triggers.length})
            </h4>
            <div className="space-y-2">
              {parsedResult.suggested_triggers.map((trigger, i) => {
                const isSelected = selectedTriggerIndices?.has(i) ?? true;
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border transition-all duration-150 ${
                      isSelected
                        ? 'bg-amber-500/5 border-amber-500/15'
                        : 'bg-secondary/20 border-primary/10 opacity-50'
                    } ${onToggleTrigger ? 'cursor-pointer hover:opacity-80' : ''}`}
                    onClick={() => onToggleTrigger?.(i)}
                  >
                    {hasSelection && (
                      <SelectionCheckbox
                        checked={isSelected}
                        onChange={() => onToggleTrigger?.(i)}
                      />
                    )}
                    <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded border ${
                      isSelected
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-secondary/30 text-muted-foreground/30 border-primary/10'
                    }`}>
                      {trigger.trigger_type}
                    </span>
                    <span className={`text-xs truncate ${isSelected ? 'text-foreground/60' : 'text-muted-foreground/30'}`}>
                      {trigger.description}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Connectors */}
        {parsedResult.suggested_connectors && parsedResult.suggested_connectors.length > 0 && (
          <div className="p-4">
            <h4 className="text-[11px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2.5 flex items-center gap-1">
              <Link className="w-3 h-3" />
              Connectors ({parsedResult.suggested_connectors.length})
            </h4>
            <div className="flex flex-wrap gap-2">
              {parsedResult.suggested_connectors.map((conn) => {
                const isSelected = selectedConnectorNames?.has(conn.name) ?? true;
                return (
                  <div
                    key={conn.name}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition-all duration-150 ${
                      isSelected
                        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                        : 'bg-secondary/30 text-muted-foreground/30 border-primary/10 opacity-60'
                    } ${onToggleConnector ? 'cursor-pointer hover:opacity-80' : ''}`}
                    onClick={() => onToggleConnector?.(conn.name)}
                  >
                    {hasSelection && (
                      <SelectionCheckbox
                        checked={isSelected}
                        onChange={() => onToggleConnector?.(conn.name)}
                      />
                    )}
                    <span className="text-[10px] font-medium">{conn.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
