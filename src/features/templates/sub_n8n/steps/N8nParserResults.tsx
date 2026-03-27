import { useState, useEffect } from 'react';
import { FileJson, FileCode2, Sparkles, AlertTriangle } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import type { AgentIR } from '@/lib/types/designTypes';
import type { WorkflowPlatform } from '@/lib/personas/parsers/workflowDetector';
import { PLATFORM_LABELS } from '@/lib/personas/parsers/workflowDetector';
import { PLATFORM_COLORS, TAG_COLORS } from '../colorTokens';
import { ToolsSection, TriggersSection, ConnectorsSection } from './N8nParserResultsSections';

interface N8nParserResultsProps {
  parsedResult: AgentIR;
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
  /** True when platform was guessed and needs user confirmation */
  platformNeedsConfirmation?: boolean;
  /** Callback when user confirms the detected platform */
  onConfirmPlatform?: () => void;
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
  platformNeedsConfirmation,
  onConfirmPlatform,
}: N8nParserResultsProps) {
  const hasSelection = !!selectedToolIndices;

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
      {isAnalyzing && (
          <div
            className="animate-fade-slide-in absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-[2px] rounded-xl"
          >
            <div className="flex flex-col items-center gap-4 p-6">
              <div className="relative">
                <div
                  className="animate-fade-in absolute inset-0 w-14 h-14 rounded-xl bg-violet-500/20"
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
          </div>
        )}

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
                <span className={`text-sm font-mono uppercase px-1.5 py-0.5 rounded border flex-shrink-0 ${PLATFORM_COLORS[platform]}`}>
                  {PLATFORM_LABELS[platform]}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground/90">{parsedResult.summary}</p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={onReset}
          className="rounded-xl border-primary/15 text-muted-foreground/80"
        >
          Import Another
        </Button>
      </div>

      {/* Platform confirmation banner */}
      {platformNeedsConfirmation && platform && platform !== 'unknown' && (
        <div
          className="animate-fade-slide-in flex items-center gap-3 px-3.5 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5"
        >
          <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          <p className="flex-1 text-sm text-amber-300/90">
            This looks like a <strong>{PLATFORM_LABELS[platform]}</strong> workflow, but we're not 100% sure. Is that correct?
          </p>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={onConfirmPlatform}
              className="rounded-lg border border-amber-500/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
            >
              Yes, that's right
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              className="rounded-lg border border-primary/15 text-muted-foreground/70 hover:bg-secondary/50"
            >
              No, re-upload
            </Button>
          </div>
        </div>
      )}

      {/* Selection summary */}
      {hasSelection && (
        <div className="flex items-center gap-2 text-sm font-mono uppercase tracking-wider text-muted-foreground/45">
          <span className={`px-2.5 py-1 rounded-xl border ${TAG_COLORS.blue}`}>
            {toolCount} tools
          </span>
          <span className={`px-2.5 py-1 rounded-xl border ${TAG_COLORS.amber}`}>
            {triggerCount} triggers
          </span>
          <span className={`px-2.5 py-1 rounded-xl border ${TAG_COLORS.emerald}`}>
            {connectorCount} connectors
          </span>
          <span className="text-muted-foreground/80 ml-1">selected for import</span>
        </div>
      )}

      {/* Sections */}
      <div className="rounded-xl border border-primary/10 bg-secondary/20 divide-y divide-primary/10">
        <ToolsSection
          tools={parsedResult.suggested_tools}
          selectedToolIndices={selectedToolIndices}
          hasSelection={hasSelection}
          onToggleTool={onToggleTool}
        />
        <TriggersSection
          triggers={parsedResult.suggested_triggers}
          selectedTriggerIndices={selectedTriggerIndices}
          hasSelection={hasSelection}
          onToggleTrigger={onToggleTrigger}
        />
        {parsedResult.suggested_connectors && parsedResult.suggested_connectors.length > 0 && (
          <ConnectorsSection
            connectors={parsedResult.suggested_connectors}
            selectedConnectorNames={selectedConnectorNames}
            hasSelection={hasSelection}
            onToggleConnector={onToggleConnector}
          />
        )}
      </div>
    </div>
  );
}
