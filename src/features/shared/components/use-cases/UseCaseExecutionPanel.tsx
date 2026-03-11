import { X, Play, Square, Clock, Timer } from 'lucide-react';
import { ExecutionTerminal } from '@/features/agents/sub_executions';
import { JsonEditor } from '@/features/shared/components/editors/JsonEditor';
import { Button } from '@/features/shared/components/buttons';
import { formatElapsed } from '@/lib/utils/formatters';
import type { UseCaseItem } from './UseCasesList';
import { StructuredField } from './StructuredField';
import { MockModePanel } from './MockModePanel';
import { useUseCaseExecution } from './useUseCaseExecution';

const MODE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  e2e:  { label: 'E2E',  bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400/80' },
  mock: { label: 'MOCK', bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400/80' },
};

interface UseCaseExecutionPanelProps {
  personaId: string;
  useCase: UseCaseItem;
  onClose: () => void;
  onExecutionFinished?: () => void;
}

export function UseCaseExecutionPanel({ personaId, useCase, onClose, onExecutionFinished }: UseCaseExecutionPanelProps) {
  const exec = useUseCaseExecution(personaId, useCase, onExecutionFinished);
  const modeBadge = (MODE_BADGE[exec.mode] ?? MODE_BADGE.e2e)!;

  if (exec.mode === 'mock') {
    return <MockModePanel useCase={useCase} modeBadge={modeBadge} onClose={onClose} />;
  }

  return (
    <div className="border border-primary/15 rounded-xl bg-secondary/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 text-sm font-medium rounded border ${modeBadge.bg} ${modeBadge.text} uppercase tracking-wider`}>
            {modeBadge.label}
          </span>
          {exec.isExecuting && exec.isThisUseCaseExecution && (
            <div className="flex items-center gap-1.5 text-muted-foreground/60">
              <Clock className="w-3 h-3" />
              <span className="text-sm font-mono">{formatElapsed(exec.elapsedMs)}</span>
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-muted-foreground/60 hover:text-foreground/80">
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Input editor */}
      <div className="p-3 border-b border-primary/10 space-y-2">
        {useCase.time_filter && (
          <div className="flex items-center gap-1.5 text-sm text-cyan-400/70">
            <Timer className="w-3 h-3" />
            <span>{useCase.time_filter.description} (window: {useCase.time_filter.default_window})</span>
          </div>
        )}
        {exec.hasSchema ? (
          <div className="space-y-2">
            {useCase.input_schema!.map((field) => (
              <StructuredField
                key={field.key} field={field} value={exec.fieldValues[field.key]}
                onChange={(v) => exec.setFieldValues((prev) => ({ ...prev, [field.key]: v }))}
              />
            ))}
          </div>
        ) : (
          <>
            <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">Input Data</p>
            <JsonEditor
              value={exec.inputData}
              onChange={(v) => { exec.setInputData(v); if (exec.jsonError) exec.setJsonError(null); }}
              placeholder='{"key": "value"}'
            />
          </>
        )}
        {exec.jsonError && <p className="text-red-400/80 text-sm mt-1">{exec.jsonError}</p>}
      </div>

      {/* Execute/Stop button */}
      <div className="p-3 border-b border-primary/10">
        <Button
          variant={exec.isExecuting && exec.isThisUseCaseExecution ? 'danger' : 'accent'}
          size="md"
          block
          icon={exec.isExecuting && exec.isThisUseCaseExecution ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          onClick={exec.isExecuting && exec.isThisUseCaseExecution ? exec.handleStop : exec.handleExecute}
          disabled={exec.isExecuting && !exec.isThisUseCaseExecution}
          className={exec.isExecuting && exec.isThisUseCaseExecution
            ? 'shadow-lg shadow-red-500/10'
            : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 shadow-lg shadow-primary/10'
          }
        >
          {exec.isExecuting && exec.isThisUseCaseExecution ? 'Stop Execution' : 'Execute Use Case'}
        </Button>
      </div>

      {/* Terminal */}
      {((exec.isExecuting && exec.isThisUseCaseExecution) || exec.outputLines.length > 0) && (
        <ExecutionTerminal
          lines={exec.outputLines} isRunning={exec.isExecuting} onStop={exec.handleStop}
          label={exec.activeExecutionId ? `exec:${exec.activeExecutionId.slice(0, 8)}` : undefined}
          terminalHeight={exec.terminalHeight} onResizeStart={exec.handleTerminalResizeStart}
        />
      )}
    </div>
  );
}
