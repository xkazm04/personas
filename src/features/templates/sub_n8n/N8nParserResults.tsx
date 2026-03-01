import { useState, useEffect } from 'react';
import { FileJson, FileCode2, Wrench, Zap, Link, Check, Sparkles } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { DesignAnalysisResult } from '@/lib/types/designTypes';
import type { WorkflowPlatform } from '@/lib/personas/workflowDetector';
import { PLATFORM_LABELS } from '@/lib/personas/workflowDetector';

const PLATFORM_COLORS: Record<WorkflowPlatform, string> = {
  'n8n': 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'zapier': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'make': 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'github-actions': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'unknown': 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
};

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
  isAnalyzing?: boolean;
  /** Detected source platform */
  platform?: WorkflowPlatform;
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
  isAnalyzing,
  platform,
}: N8nParserResultsProps) {
  const hasSelection = !!selectedToolIndices;

  // Elapsed timer for analyzing overlay
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isAnalyzing]);

  const toolCount = selectedToolIndices?.size ?? parsedResult.suggested_tools.length;
  const triggerCount = selectedTriggerIndices?.size ?? parsedResult.suggested_triggers.length;
  const connectorCount = selectedConnectorNames?.size ?? (parsedResult.suggested_connectors?.length ?? 0);

  return (
    <div className={`space-y-4 relative ${isAnalyzing ? 'min-h-[200px]' : ''}`}>
      {/* Analyzing overlay */}
      <AnimatePresence>
        {isAnalyzing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[2px] rounded-xl"
          >
            <div className="flex flex-col items-center gap-4 p-6">
              <div className="relative">
                <motion.div
                  className="absolute inset-0 w-14 h-14 rounded-xl bg-violet-500/20"
                  animate={{ scale: [1, 1.4, 1], opacity: [0.4, 0, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                />
                <div className="w-14 h-14 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
                  <Sparkles className="w-7 h-7 text-violet-400" />
                </div>
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground/80">
                  Analyzing workflow and preparing transformation...
                </p>
                <p className="text-sm text-muted-foreground/90 mt-1.5">
                  Usually takes about 1 minute
                </p>
                <p className="text-sm font-mono text-muted-foreground/80 mt-1">
                  {Math.floor(elapsedSeconds / 60)}:{(elapsedSeconds % 60).toString().padStart(2, '0')}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/25 flex items-center justify-center">
            {platform === 'github-actions'
              ? <FileCode2 className="w-5 h-5 text-cyan-400" />
              : <FileJson className="w-5 h-5 text-cyan-400" />
            }
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground/90">{workflowName}</h3>
              {platform && (
                <span className={`text-[11px] font-mono uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${PLATFORM_COLORS[platform]}`}>
                  {PLATFORM_LABELS[platform]}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground/90">{parsedResult.summary}</p>
          </div>
        </div>
        <button
          onClick={onReset}
          className="px-3 py-1.5 text-sm rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/80 transition-colors"
        >
          Import Another
        </button>
      </div>

      {/* Selection summary */}
      {hasSelection && (
        <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider text-muted-foreground/45">
          <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/15">
            {toolCount} tools
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/15">
            {triggerCount} triggers
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/15">
            {connectorCount} connectors
          </span>
          <span className="text-muted-foreground/80 ml-1">selected for import</span>
        </div>
      )}

      {/* Tools */}
      <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
        {parsedResult.suggested_tools.length > 0 && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
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
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10 opacity-60'
                    } ${onToggleTool ? 'cursor-pointer hover:opacity-80' : ''}`}
                    onClick={() => onToggleTool?.(i)}
                  >
                    {hasSelection && (
                      <SelectionCheckbox
                        checked={isSelected}
                        onChange={() => onToggleTool?.(i)}
                      />
                    )}
                    <span className="text-sm font-mono">{tool}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Triggers */}
        {parsedResult.suggested_triggers.length > 0 && (
          <div className="p-4">
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
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
                    <span className={`px-1.5 py-0.5 text-sm font-mono rounded border ${
                      isSelected
                        ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10'
                    }`}>
                      {trigger.trigger_type}
                    </span>
                    <span className={`text-sm truncate ${isSelected ? 'text-foreground/80' : 'text-muted-foreground/80'}`}>
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
            <h4 className="text-sm font-semibold text-muted-foreground/80 uppercase tracking-wider mb-2.5 flex items-center gap-1">
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
                        : 'bg-secondary/30 text-muted-foreground/80 border-primary/10 opacity-60'
                    } ${onToggleConnector ? 'cursor-pointer hover:opacity-80' : ''}`}
                    onClick={() => onToggleConnector?.(conn.name)}
                  >
                    {hasSelection && (
                      <SelectionCheckbox
                        checked={isSelected}
                        onChange={() => onToggleConnector?.(conn.name)}
                      />
                    )}
                    <span className="text-sm font-medium">{conn.name}</span>
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
