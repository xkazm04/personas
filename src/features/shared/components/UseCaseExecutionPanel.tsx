import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Play, Square, Clock, Timer } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaExecution } from '@/hooks/execution/usePersonaExecution';
import { useElapsedTimer } from '@/hooks/utility/useElapsedTimer';
import { ExecutionTerminal } from '@/features/agents/sub_executions/ExecutionTerminal';
import { JsonEditor } from '@/features/shared/components/JsonEditor';
import { formatElapsed } from '@/lib/utils/formatters';
import type { UseCaseItem, UseCaseInputField } from './UseCasesList';

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
  const executePersona = usePersonaStore((s) => s.executePersona);
  const cancelExecution = usePersonaStore((s) => s.cancelExecution);
  const isExecuting = usePersonaStore((s) => s.isExecuting);
  const activeExecutionId = usePersonaStore((s) => s.activeExecutionId);
  const executionOutput = usePersonaStore((s) => s.executionOutput);
  const executionPersonaId = usePersonaStore((s) => s.executionPersonaId);

  const { disconnect } = usePersonaExecution();

  const mode = useCase.execution_mode ?? 'e2e';
  const modeBadge = (MODE_BADGE[mode] ?? MODE_BADGE.e2e)!;

  const hasSchema = (useCase.input_schema?.length ?? 0) > 0;

  // Build initial field values from input_schema defaults or sample_input
  const buildFieldValues = useCallback((uc: UseCaseItem): Record<string, unknown> => {
    const vals: Record<string, unknown> = {};
    if (uc.input_schema) {
      for (const field of uc.input_schema) {
        vals[field.key] = uc.sample_input?.[field.key] ?? field.default ?? '';
      }
    }
    return vals;
  }, []);

  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>(() => buildFieldValues(useCase));
  const [inputData, setInputData] = useState(() =>
    useCase.sample_input ? JSON.stringify(useCase.sample_input, null, 2) : '{}'
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [terminalHeight, setTerminalHeight] = useState(300);
  const isDraggingTerminal = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  const activeUseCaseId = usePersonaStore((s) => s.activeUseCaseId);

  const isThisPersonasExecution = executionPersonaId === personaId && personaId !== '';
  const isThisUseCaseExecution = isThisPersonasExecution && activeUseCaseId === useCase.id;
  const elapsedMs = useElapsedTimer(isExecuting && isThisUseCaseExecution, 500);
  const prevIsExecutingRef = useRef(isExecuting);
  const wasOurExecutionRef = useRef(false);

  // Reset input when use case changes
  useEffect(() => {
    setFieldValues(buildFieldValues(useCase));
    setInputData(useCase.sample_input ? JSON.stringify(useCase.sample_input, null, 2) : '{}');
    setJsonError(null);
    setOutputLines([]);
  }, [useCase.id, buildFieldValues]);

  // Sync store output — scoped to use case, not just persona
  useEffect(() => {
    if (isThisUseCaseExecution && executionOutput.length > 0) {
      setOutputLines(executionOutput);
    } else if (!isThisUseCaseExecution) {
      setOutputLines([]);
    }
  }, [executionOutput, isThisUseCaseExecution]);

  // Latch ownership while executing so completion fires even if the store
  // clears executionPersonaId/activeUseCaseId before flipping isExecuting.
  useEffect(() => {
    if (isExecuting && isThisUseCaseExecution) {
      wasOurExecutionRef.current = true;
    }
  }, [isExecuting, isThisUseCaseExecution]);

  // Detect execution completion — checks isExecuting independently of ownership
  useEffect(() => {
    if (prevIsExecutingRef.current && !isExecuting && wasOurExecutionRef.current) {
      wasOurExecutionRef.current = false;
      onExecutionFinished?.();
    }
    prevIsExecutingRef.current = isExecuting;
  }, [isExecuting, onExecutionFinished]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  const handleExecute = async () => {
    if (mode === 'mock') return; // mock mode doesn't execute

    let parsedInput: Record<string, unknown> = {};
    if (hasSchema) {
      // Use structured field values
      parsedInput = { ...fieldValues };
    } else if (inputData.trim()) {
      try {
        parsedInput = JSON.parse(inputData);
      } catch (e) {
        setJsonError(e instanceof SyntaxError ? e.message : 'Invalid JSON input');
        return;
      }
    }

    // Inject time_filter into input so the agent knows date bounds
    if (useCase.time_filter) {
      parsedInput._time_filter = useCase.time_filter;
    }

    // Inject use case context
    parsedInput._use_case = { title: useCase.title, description: useCase.description };

    setJsonError(null);
    setOutputLines([]);
    await executePersona(personaId, parsedInput, useCase.id);
  };

  const handleStop = () => {
    if (activeExecutionId) {
      disconnect();
      cancelExecution(activeExecutionId);
    }
  };

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingTerminal.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalHeight;

    const onMove = (moveEvent: MouseEvent) => {
      if (!isDraggingTerminal.current) return;
      const delta = moveEvent.clientY - dragStartY.current;
      setTerminalHeight(Math.max(120, Math.min(700, dragStartHeight.current + delta)));
    };

    const onUp = () => {
      isDraggingTerminal.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [terminalHeight]);

  // Mock mode: show sample_input as styled JSON viewer
  if (mode === 'mock') {
    return (
      <div className="border border-amber-500/20 rounded-xl bg-amber-500/5 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-amber-500/15">
          <div className="flex items-center gap-2">
            <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${modeBadge.bg} ${modeBadge.text} uppercase tracking-wider`}>
              {modeBadge.label}
            </span>
            <span className="text-xs text-amber-400/70">Example output</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Mock output */}
        <div className="p-3">
          <pre className="text-sm font-mono text-foreground/70 bg-background/40 rounded-lg p-3 overflow-auto max-h-64 border border-amber-500/10">
            {useCase.sample_input
              ? JSON.stringify(useCase.sample_input, null, 2)
              : '// No sample data provided'}
          </pre>
        </div>
      </div>
    );
  }

  // E2E mode: full execution panel
  return (
    <div className="border border-primary/15 rounded-xl bg-secondary/20 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${modeBadge.bg} ${modeBadge.text} uppercase tracking-wider`}>
            {modeBadge.label}
          </span>
          {isExecuting && isThisUseCaseExecution && (
            <div className="flex items-center gap-1.5 text-muted-foreground/60">
              <Clock className="w-3 h-3" />
              <span className="text-xs font-mono">{formatElapsed(elapsedMs)}</span>
            </div>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-secondary/60 text-muted-foreground/60 hover:text-foreground/80 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Input editor */}
      <div className="p-3 border-b border-primary/10 space-y-2">
        {/* Time filter indicator */}
        {useCase.time_filter && (
          <div className="flex items-center gap-1.5 text-xs text-cyan-400/70">
            <Timer className="w-3 h-3" />
            <span>{useCase.time_filter.description} (window: {useCase.time_filter.default_window})</span>
          </div>
        )}

        {hasSchema ? (
          /* Structured input fields */
          <div className="space-y-2">
            {useCase.input_schema!.map((field) => (
              <StructuredField
                key={field.key}
                field={field}
                value={fieldValues[field.key]}
                onChange={(v) => setFieldValues((prev) => ({ ...prev, [field.key]: v }))}
              />
            ))}
          </div>
        ) : (
          /* Free-text JSON fallback */
          <>
            <p className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wider">Input Data</p>
            <JsonEditor
              value={inputData}
              onChange={(v) => {
                setInputData(v);
                if (jsonError) setJsonError(null);
              }}
              placeholder='{"key": "value"}'
            />
          </>
        )}
        {jsonError && (
          <p className="text-red-400/80 text-sm mt-1">{jsonError}</p>
        )}
      </div>

      {/* Execute/Stop button */}
      <div className="p-3 border-b border-primary/10">
        <button
          onClick={isExecuting && isThisUseCaseExecution ? handleStop : handleExecute}
          className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all ${
            isExecuting && isThisUseCaseExecution
              ? 'bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/10'
              : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/10'
          }`}
          disabled={isExecuting && !isThisUseCaseExecution}
        >
          {isExecuting && isThisUseCaseExecution ? (
            <>
              <Square className="w-4 h-4" />
              Stop Execution
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Execute Use Case
            </>
          )}
        </button>
      </div>

      {/* Terminal */}
      {((isExecuting && isThisUseCaseExecution) || outputLines.length > 0) && (
        <ExecutionTerminal
          lines={outputLines}
          isRunning={isExecuting}
          onStop={handleStop}
          label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined}
          terminalHeight={terminalHeight}
          onResizeStart={handleTerminalResizeStart}
        />
      )}
    </div>
  );
}

// ── Structured Input Field ─────────────────────────────────────────

function StructuredField({ field, value, onChange }: { field: UseCaseInputField; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'select':
      return (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
          <select
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 px-2 py-1 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          >
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        </div>
      );
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
          <input
            type="number"
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            className="flex-1 px-2 py-1 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      );
    case 'boolean':
      return (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
          <button
            onClick={() => onChange(!value)}
            className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
              value
                ? 'bg-primary/10 border-primary/25 text-primary'
                : 'bg-secondary/40 border-primary/10 text-muted-foreground/80'
            }`}
          >
            {value ? 'Yes' : 'No'}
          </button>
        </div>
      );
    default: // text
      return (
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground/70 w-24 flex-shrink-0">{field.label}</label>
          <input
            type="text"
            value={String(value ?? field.default ?? '')}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 px-2 py-1 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      );
  }
}
