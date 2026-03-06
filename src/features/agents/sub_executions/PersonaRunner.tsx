import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizeUrl';
import { useElapsedTimer } from '@/hooks';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaExecution } from '@/hooks/execution/usePersonaExecution';
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { TerminalStrip } from '@/features/shared/components/TerminalStrip';
import { Play, Square, ChevronDown, ChevronRight, Cloud, Clock, Timer, DollarSign, RotateCw, Wrench, Zap, Brain, Cpu, CheckCheck, AlertTriangle, ShieldAlert, ExternalLink, Pin, PinOff } from 'lucide-react';
import { classifyLine, parseSummaryLine } from '@/lib/utils/terminalColors';
import { Tooltip } from '@/features/shared/components/Tooltip';
import { formatElapsed, getStatusEntry } from '@/lib/utils/formatters';
import { motion, AnimatePresence } from 'framer-motion';
import { JsonEditor } from '@/features/shared/components/JsonEditor';
import { ExecutionTerminal } from '@/features/agents/sub_executions/ExecutionTerminal';
import type { TerminalEmptyState } from '@/features/shared/components/TerminalBody';
import * as api from '@/api/tauriApi';
import { useToastStore } from '@/stores/toastStore';


/** Healing event payload from Tauri backend */
interface HealingEventPayload {
  issue_id: string;
  persona_id: string;
  execution_id: string;
  title: string;
  action: string; // "auto_retry" | "issue_created" | "circuit_breaker"
  auto_fixed: boolean;
  severity: string;
  suggested_fix: string | null;
  persona_name: string;
  description?: string;
  strategy?: string;
  backoff_seconds?: number;
  retry_number?: number;
  max_retries?: number;
}

interface ToolCallDot {
  toolName: string;
  startMs: number;
  endMs?: number;
}

interface PhaseEntry {
  id: string;
  label: string;
  startMs: number;
  endMs?: number;
  toolCalls: ToolCallDot[];
}

/** Duration color for tool-call dots — mirrors ExecutionInspector's durationColor. */
function dotColor(ms: number | undefined): string {
  if (ms === undefined) return 'bg-blue-400/70'; // still running
  if (ms < 2000) return 'bg-emerald-400';
  if (ms < 10000) return 'bg-amber-400';
  return 'bg-red-400';
}

const PHASE_META: Record<string, { label: string; icon: typeof Zap }> = {
  initializing: { label: 'Initializing', icon: Zap },
  thinking: { label: 'Thinking', icon: Brain },
  calling_tools: { label: 'Running tools', icon: Cpu },
  delegating: { label: 'Delegating to workflow', icon: Zap },
  responding: { label: 'Responding', icon: Brain },
  finalizing: { label: 'Finalizing', icon: CheckCheck },
  error: { label: 'Error', icon: AlertTriangle },
};

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const entry = getStatusEntry(status);
  return <entry.icon className={`${entry.text} ${className ?? ''}`} />;
}

function detectPhaseFromLine(line: string, hasSeenTools: boolean): string | null {
  if (!line.trim()) return null;

  // Use classifyLine as single source of truth for prefix matching
  const style = classifyLine(line);
  switch (style) {
    case 'error':  return 'error';
    case 'tool':   return 'calling_tools';
    case 'summary': return 'finalizing';
    case 'meta':   return 'finalizing';
    case 'status':
      // 'status' covers both initialization and finalization lines
      return line.startsWith('Session started') ? 'initializing' : 'finalizing';
    case 'text':
      // Lines classifyLine doesn't distinguish but are execution-start markers
      if (line.startsWith('Execution started') || line.startsWith('Cloud execution started')) return 'initializing';
      return hasSeenTools ? 'responding' : 'thinking';
  }

  return null;
}

function MiniPlayerPinButton() {
  const pinned = usePersonaStore((s) => s.miniPlayerPinned);
  const pin = usePersonaStore((s) => s.pinMiniPlayer);
  const unpin = usePersonaStore((s) => s.unpinMiniPlayer);

  return (
    <Tooltip content={pinned ? 'Unpin mini-player' : 'Pin to mini-player'}>
      <button
        onClick={pinned ? unpin : pin}
        className={`p-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
          pinned
            ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 hover:bg-violet-500/25'
            : 'hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/80'
        }`}
      >
        {pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
        <span className="text-sm">{pinned ? 'Pinned' : 'Pin'}</span>
      </button>
    </Tooltip>
  );
}

export function PersonaRunner() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const executePersona = usePersonaStore((state) => state.executePersona);
  const cancelExecution = usePersonaStore((state) => state.cancelExecution);
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const activeExecutionId = usePersonaStore((state) => state.activeExecutionId);
  const executionOutput = usePersonaStore((state) => state.executionOutput);

  const executionPersonaId = usePersonaStore((state) => state.executionPersonaId);
  const rerunInputData = usePersonaStore((state) => state.rerunInputData);
  const setRerunInputData = usePersonaStore((state) => state.setRerunInputData);

  const queuePosition = usePersonaStore((s) => s.queuePosition);
  const queueDepth = usePersonaStore((s) => s.queueDepth);

  const cloudConfig = usePersonaStore((s) => s.cloudConfig);
  const cloudExecute = usePersonaStore((s) => s.cloudExecute);

  const { disconnect } = usePersonaExecution();

  const runnerRef = useRef<HTMLDivElement>(null);
  const [inputData, setInputData] = useState('{}');
  const [showInputEditor, setShowInputEditor] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [typicalDurationMs, setTypicalDurationMs] = useState<number | null>(null);
  const elapsedMs = useElapsedTimer(isExecuting, 500);

  const personaId = selectedPersona?.id || '';
  const isThisPersonasExecution = executionPersonaId === personaId && personaId !== '';

  // Phase tracking for breadcrumb strip
  const [phases, setPhases] = useState<PhaseEntry[]>([]);
  const [showPhases, setShowPhases] = useState(true);
  const phaseLineCount = useRef(0);
  const hasSeenToolsRef = useRef(false);

  // Healing notification state — inline cards between output and retry
  const [healingNotification, setHealingNotification] = useState<HealingEventPayload | null>(null);

  // AI self-healing (dev-mode only)
  const aiHealing = useAiHealingStream(personaId);
  const [showHealingLog, setShowHealingLog] = useState(false);

  // Resizable + fullscreen terminal state
  const [terminalHeight, setTerminalHeight] = useState(400);
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false);
  const isDraggingTerminal = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const dragListenersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);

  // Extract summary from terminal output for the persistent card
  const executionSummary = useMemo(() => {
    for (let i = outputLines.length - 1; i >= 0; i--) {
      const line = outputLines[i]!;
      if (classifyLine(line) === 'summary') {
        const parsed = parseSummaryLine(line);
        if (parsed) return parsed;
      }
    }
    return null;
  }, [outputLines]);

  // Derive terminal empty state from execution context
  const terminalEmptyState = useMemo((): TerminalEmptyState => {
    if (!isExecuting) return 'idle';
    if (queuePosition != null) return { kind: 'queued', position: queuePosition + 1, depth: queueDepth ?? undefined };
    return 'connecting';
  }, [isExecuting, queuePosition, queueDepth]);

  const fetchTypicalDuration = useCallback(async (pId: string) => {
    try {
      const execs = await api.listExecutions(pId, 20);
      const durations: number[] = execs
        .filter((e): e is typeof e & { duration_ms: number } =>
          e.status === 'completed' && typeof e.duration_ms === 'number' && e.duration_ms > 0)
        .map((e) => e.duration_ms);
      if (durations.length > 0) {
        durations.sort((a, b) => a - b);
        setTypicalDurationMs(durations[Math.floor(durations.length / 2)] ?? null);
      } else {
        setTypicalDurationMs(null);
      }
    } catch { // intentional: non-critical
      setTypicalDurationMs(null);
    }
  }, []);

  // Sync store output to local lines (only for this persona's execution)
  useEffect(() => {
    if (isThisPersonasExecution && executionOutput.length > 0) {
      setOutputLines(executionOutput);
    } else if (!isThisPersonasExecution) {
      setOutputLines([]);
    }
  }, [executionOutput, isThisPersonasExecution]);

  // Derive phases from new output lines
  useEffect(() => {
    if (outputLines.length <= phaseLineCount.current) return;
    const now = elapsedMs;

    setPhases((prev) => {
      const updated = [...prev];
      for (let i = phaseLineCount.current; i < outputLines.length; i++) {
        const line = outputLines[i]!;

        // Track tool calls within the current phase
        if (line.startsWith('> Using tool:')) {
          const toolName = line.replace('> Using tool:', '').trim();
          const currentPhase = updated[updated.length - 1];
          if (currentPhase) {
            // Close the previous open tool call in this phase
            const lastTool = currentPhase.toolCalls[currentPhase.toolCalls.length - 1];
            if (lastTool && lastTool.endMs === undefined) {
              lastTool.endMs = now;
            }
            currentPhase.toolCalls.push({ toolName, startMs: now });
          }
        }

        const detected = detectPhaseFromLine(line, hasSeenToolsRef.current);
        if (!detected) continue;
        if (detected === 'calling_tools') hasSeenToolsRef.current = true;

        const currentPhase = updated[updated.length - 1];
        if (currentPhase?.id === detected) continue;

        if (currentPhase && !currentPhase.endMs) {
          // Close any open tool call
          const lastTool = currentPhase.toolCalls[currentPhase.toolCalls.length - 1];
          if (lastTool && lastTool.endMs === undefined) {
            lastTool.endMs = now;
          }
          currentPhase.endMs = now;
        }
        updated.push({ id: detected, label: PHASE_META[detected]?.label ?? detected, startMs: now, toolCalls: [] });
      }
      return updated;
    });

    phaseLineCount.current = outputLines.length;
  }, [outputLines, elapsedMs]);

  // Reset phase tracking when a new execution starts
  useEffect(() => {
    if (isExecuting) {
      setPhases([]);
      phaseLineCount.current = 0;
      hasSeenToolsRef.current = false;
    }
  }, [isExecuting]);

  // Reset phase tracking when persona changes (prevents stale index on switch)
  useEffect(() => {
    setPhases([]);
    phaseLineCount.current = 0;
    hasSeenToolsRef.current = false;
  }, [personaId]);

  // Listen for healing events scoped to the current persona.
  // Uses a cancelled flag to prevent leaked listeners when the component
  // unmounts before the async listen() Promise resolves.
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<HealingEventPayload>('healing-event', (event) => {
      if (cancelled) return;
      const payload = event.payload;
      if (payload.persona_id !== personaId) return;
      setHealingNotification(payload);
    }).then((fn) => {
      if (cancelled) {
        fn();
      } else {
        unlistenFn = fn;
      }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [personaId]);

  // Clear healing notification when a new execution starts
  useEffect(() => {
    if (isExecuting) setHealingNotification(null);
  }, [isExecuting]);

  // Drag-to-resize handler for terminal bottom edge
  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingTerminal.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalHeight;

    const onMove = (moveEvent: MouseEvent) => {
      if (!isDraggingTerminal.current) return;
      const delta = moveEvent.clientY - dragStartY.current;
      setTerminalHeight(Math.max(120, Math.min(900, dragStartHeight.current + delta)));
    };

    const onUp = () => {
      isDraggingTerminal.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragListenersRef.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    dragListenersRef.current = { onMove, onUp };
  }, [terminalHeight]);

  // Clean up drag listeners on unmount to prevent leaked document listeners
  useEffect(() => {
    return () => {
      if (dragListenersRef.current) {
        document.removeEventListener('mousemove', dragListenersRef.current.onMove);
        document.removeEventListener('mouseup', dragListenersRef.current.onUp);
        dragListenersRef.current = null;
      }
    };
  }, []);

  const toggleTerminalFullscreen = useCallback(() => setIsTerminalFullscreen(prev => !prev), []);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isTerminalFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsTerminalFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTerminalFullscreen]);

  // Ref for Enter-key shortcut — populated after handleExecute is defined below
  const handleExecuteRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || isExecuting) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) return;
      handleExecuteRef.current?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isExecuting]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  // Pick up re-run input from store
  useEffect(() => {
    if (rerunInputData !== null) {
      try {
        const formatted = JSON.stringify(JSON.parse(rerunInputData), null, 2);
        setInputData(formatted);
      } catch { // intentional: non-critical
        setInputData(rerunInputData);
      }
      setShowInputEditor(true);
      setJsonError(null);
      setRerunInputData(null);
      runnerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [rerunInputData, setRerunInputData]);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  const handleExecute = async () => {
    let parsedInput = {};
    if (inputData.trim()) {
      try {
        parsedInput = JSON.parse(inputData);
      } catch (e) {
        setJsonError(e instanceof SyntaxError ? e.message : 'Invalid JSON input');
        return;
      }
    }

    setJsonError(null);
    setOutputLines([]);
    fetchTypicalDuration(personaId);

    let executionId: string | null;
    if (cloudConfig?.is_connected) {
      try {
        executionId = await cloudExecute(personaId, JSON.stringify(parsedInput));
        setOutputLines(['Cloud execution started: ' + executionId]);
      } catch {
        setOutputLines(['ERROR: Failed to start cloud execution']);
        useToastStore.getState().addToast('Failed to start cloud execution', 'error');
      }
    } else {
      executionId = await executePersona(personaId, parsedInput);
      if (executionId) {
        setOutputLines(['Execution started: ' + executionId]);
      } else {
        setOutputLines(['ERROR: Failed to start execution']);
      }
    }
  };

  // Keep ref in sync for Enter-key shortcut
  handleExecuteRef.current = handleExecute;

  const handleStop = async () => {
    if (activeExecutionId) {
      // Capture state before cancelling
      const lastToolLine = [...outputLines].reverse().find(l => l.startsWith('> Using tool:'));
      const lastTool = lastToolLine?.replace('> Using tool: ', '').trim() || null;

      const cancelSummary = JSON.stringify({
        status: 'cancelled',
        duration_ms: elapsedMs,
        cost_usd: null,
        last_tool: lastTool,
      });

      // Disconnect listeners first so no stale status events can race with
      // the state cleanup inside cancelExecution. cancelExecution
      // unconditionally resets isExecuting in its finally block.
      disconnect();
      await cancelExecution(activeExecutionId);
      setOutputLines((prev) => [...prev, '', `[SUMMARY]${cancelSummary}`]);
    }
  };

  const handleResume = async () => {
    if (!selectedPersona) return;
    const lastTool = executionSummary?.last_tool;

    // Build the resume hint text
    const hint = `Previous execution was cancelled${
      executionSummary?.duration_ms ? ` after ${formatElapsed(executionSummary.duration_ms)}` : ''
    }${lastTool ? ` while running tool "${lastTool}"` : ''}. Please continue from where the previous execution left off.`;

    // Check if we can do a native session resume via claude_session_id
    let sessionId: string | null = null;
    if (activeExecutionId) {
      try {
        const exec = await api.getExecution(activeExecutionId, selectedPersona.id);
        sessionId = exec.claude_session_id ?? null;
      } catch { // intentional: non-critical — fall back to prompt hint
      }
    }

    let parsedInput = {};
    if (inputData.trim()) {
      try { parsedInput = JSON.parse(inputData); } catch { /* intentional: non-critical */ }
    }

    setOutputLines([]);

    // Choose continuation strategy: prefer native session resume
    const continuation: import('@/lib/bindings/Continuation').Continuation = sessionId
      ? { type: 'SessionResume', value: sessionId }
      : { type: 'PromptHint', value: hint };

    await executePersona(personaId, parsedInput, undefined, continuation);
  };

  const summaryPresentation = getStatusEntry(executionSummary?.status ?? 'failed');

  return (
    <div ref={runnerRef} className="space-y-4">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Play className="w-3.5 h-3.5" />
        Run Persona
      </h4>

      {/* Input & Execute Card */}
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-4 space-y-4">
        {/* Input Data Section */}
        <div className="space-y-2">
          <button
            onClick={() => setShowInputEditor(!showInputEditor)}
            className="flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground transition-colors"
          >
            {showInputEditor ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
            Input Data (Optional)
          </button>

          <AnimatePresence>
            {showInputEditor && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
              >
                <JsonEditor
                  value={inputData}
                  onChange={(v) => {
                    setInputData(v);
                    if (jsonError) setJsonError(null);
                  }}
                  placeholder='{"key": "value"}'
                />
                {jsonError && (
                  <p className="text-red-400/80 text-sm mt-1">{jsonError}</p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Execute Button */}
        <button
          data-testid="execute-persona-btn"
          onClick={isExecuting ? handleStop : handleExecute}
          className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-medium text-sm transition-all ${
            isExecuting
              ? 'bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20'
              : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'
          }`}
        >
          {isExecuting ? (
            <>
              <Square className="w-5 h-5" />
              Stop Execution
            </>
          ) : (
            <>
              {cloudConfig?.is_connected ? <Cloud className="w-5 h-5" /> : <Play className="w-5 h-5" />}
              {cloudConfig?.is_connected ? 'Execute on Cloud' : 'Execute Persona'}
            </>
          )}
        </button>
      </div>

      {/* Progress Indicator */}
      {isExecuting && isThisPersonasExecution && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-xl"
        >
          <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
          {/* Mini-player pin toggle */}
          <MiniPlayerPinButton />
          <div className="flex-1 min-w-0">
            {typicalDurationMs ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/80">
                    {formatElapsed(elapsedMs)} elapsed
                  </span>
                  <span className="text-muted-foreground/80">
                    {elapsedMs < typicalDurationMs
                      ? `Typically completes in ~${formatElapsed(typicalDurationMs)}`
                      : 'Taking longer than usual...'}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-primary/40"
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (elapsedMs / typicalDurationMs) * 100)}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground/90">
                {formatElapsed(elapsedMs)} elapsed
              </span>
            )}
          </div>
        </motion.div>
      )}

      {/* Persistent Execution Summary Card */}
      {!isExecuting && isThisPersonasExecution && executionSummary && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className={`rounded-xl border p-4 ${summaryPresentation.border} ${summaryPresentation.bg}`}
        >
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <StatusIcon status={executionSummary.status} className="w-5 h-5" />
              <span className={`text-sm font-semibold capitalize ${summaryPresentation.text}`}>
                {executionSummary.status}
              </span>
            </div>

            {executionSummary.duration_ms != null && (
              <div className="flex items-center gap-1.5 text-muted-foreground/80">
                <Timer className="w-3.5 h-3.5" />
                <span className="text-sm font-mono">{(executionSummary.duration_ms / 1000).toFixed(1)}s</span>
              </div>
            )}

            {executionSummary.cost_usd != null && (
              <div className="flex items-center gap-1.5 text-muted-foreground/80">
                <DollarSign className="w-3.5 h-3.5" />
                <span className="text-sm font-mono">${executionSummary.cost_usd.toFixed(4)}</span>
              </div>
            )}
          </div>

          {/* Cancelled-specific: last tool + resume */}
          {executionSummary.status === 'cancelled' && (
            <div className="mt-3 pt-3 border-t border-amber-500/15 space-y-3">
              {executionSummary.last_tool && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground/90">
                  <Wrench className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
                  <span>Stopped while running</span>
                  <code className="px-1.5 py-0.5 rounded-lg bg-amber-500/10 text-amber-300/80 font-mono text-sm">
                    {executionSummary.last_tool}
                  </code>
                </div>
              )}
              <button
                onClick={handleResume}
                className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"
              >
                <RotateCw className="w-3.5 h-3.5" />
                Resume from here
              </button>
            </div>
          )}
        </motion.div>
      )}

      {/* Inline Healing Notification Card */}
      <AnimatePresence>
        {healingNotification && !isExecuting && isThisPersonasExecution && (
          <HealingCard
            notification={healingNotification}
            onDismiss={() => setHealingNotification(null)}
          />
        )}
      </AnimatePresence>

      {/* AI Self-Healing Strip (dev-mode only) */}
      {import.meta.env.VITE_DEVELOPMENT === 'true' && aiHealing.phase !== 'idle' && (
        <TerminalStrip
          lastLine={aiHealing.lastLine}
          lines={aiHealing.lines}
          isRunning={
            aiHealing.phase === 'started' ||
            aiHealing.phase === 'diagnosing' ||
            aiHealing.phase === 'applying'
          }
          isExpanded={showHealingLog}
          onToggle={() => setShowHealingLog((v) => !v)}
          counters={
            <AiHealingCounters
              phase={aiHealing.phase}
              fixCount={aiHealing.fixesApplied.length}
              shouldRetry={aiHealing.shouldRetry}
            />
          }
        />
      )}

      {/* Coached empty state — shown when no execution output is visible */}
      <AnimatePresence>
        {!(isThisPersonasExecution && (isExecuting || outputLines.length > 0)) && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="flex flex-col items-center justify-center py-16 gap-4"
            data-testid="runner-empty-state"
          >
            {selectedPersona.icon ? (
              sanitizeIconUrl(selectedPersona.icon) ? (
                <img src={sanitizeIconUrl(selectedPersona.icon)!} alt="" className="w-12 h-12 rounded-xl opacity-60" referrerPolicy="no-referrer" crossOrigin="anonymous" />
              ) : isIconUrl(selectedPersona.icon) ? null : (
                <span className="text-4xl leading-none opacity-60">{selectedPersona.icon}</span>
              )
            ) : (
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold opacity-50"
                style={{
                  backgroundColor: `${selectedPersona.color || '#6B7280'}20`,
                  border: `1px solid ${selectedPersona.color || '#6B7280'}40`,
                  color: selectedPersona.color || '#6B7280',
                }}
              >
                {selectedPersona.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium text-foreground/70">{selectedPersona.name}</p>
              <p className="text-sm text-zinc-500">
                Ready to execute &mdash; click Run or press{' '}
                <kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800/60 text-zinc-400 text-sm font-mono">
                  Enter
                </kbd>
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Terminal Output */}
      {isThisPersonasExecution && (isExecuting || outputLines.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <ExecutionTerminal
            lines={outputLines}
            isRunning={isExecuting}
            onStop={handleStop}
            label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined}
            isFullscreen={isTerminalFullscreen}
            onToggleFullscreen={toggleTerminalFullscreen}
            terminalHeight={terminalHeight}
            onResizeStart={handleTerminalResizeStart}
            emptyState={terminalEmptyState}
          >
            {/* Queue position banner */}
            {queuePosition != null && isThisPersonasExecution && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 bg-amber-500/5">
                <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="text-sm text-amber-300/90 font-medium">
                  Queued — position {queuePosition + 1}{queueDepth != null ? ` of ${queueDepth}` : ''}
                </span>
              </div>
            )}

            {/* Proportional phase timeline */}
            {phases.length > 0 && (
              <div className="border-b border-border/20">
                <button
                  onClick={() => setShowPhases(!showPhases)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm font-mono text-muted-foreground/80 hover:text-muted-foreground transition-colors uppercase tracking-wider"
                >
                  {showPhases ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Phases
                </button>
                <AnimatePresence>
                  {showPhases && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-2.5">
                        {(() => {
                          const durations = phases.map((p, j) => {
                            const active = j === phases.length - 1 && isExecuting;
                            return p.endMs != null ? p.endMs - p.startMs : active ? elapsedMs - p.startMs : 0;
                          });
                          const totalDur = durations.reduce((s, d) => s + d, 0);
                          const minGrow = totalDur > 0 ? totalDur * 0.06 : 1;

                          return (
                            <div className="flex w-full h-7 rounded-lg overflow-hidden gap-px" data-testid="phase-timeline-bar">
                              {phases.map((phase, i) => {
                                const isActive = i === phases.length - 1 && isExecuting;
                                const meta = PHASE_META[phase.id];
                                const PhaseIcon = meta?.icon ?? Zap;
                                const duration = durations[i]!;

                                return (
                                  <Tooltip content={`${phase.label}: ${formatElapsed(duration)}${phase.toolCalls.length > 0 ? ` — ${phase.toolCalls.length} tool call${phase.toolCalls.length > 1 ? 's' : ''}` : ''}`} placement="bottom">
                                  <motion.div
                                    key={`${phase.id}-${i}`}
                                    layout
                                    className={`relative flex items-center justify-center gap-1.5 px-2 overflow-hidden transition-colors ${
                                      isActive
                                        ? 'bg-primary/20 text-primary/90'
                                        : phase.id === 'error'
                                          ? 'bg-red-500/15 text-red-400/80'
                                          : 'bg-secondary/40 text-muted-foreground/80'
                                    }`}
                                    style={{ flexGrow: Math.max(duration, minGrow) }}
                                  >
                                    {isActive && (
                                      <motion.div
                                        className="absolute inset-0 pointer-events-none"
                                        style={{
                                          background: 'linear-gradient(90deg, transparent, hsl(var(--primary) / 0.12), transparent)',
                                          width: '60%',
                                        }}
                                        animate={{ left: ['-60%', '100%'] }}
                                        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                                      />
                                    )}
                                    {/* Tool-call activity dots */}
                                    {phase.toolCalls.length > 0 && duration > 0 && (
                                      <div className="absolute inset-0 pointer-events-none z-[1]">
                                        {phase.toolCalls.map((tc, j) => {
                                          const offset = tc.startMs - phase.startMs;
                                          const pct = Math.min(100, Math.max(0, (offset / duration) * 100));
                                          const tcDuration = tc.endMs != null ? tc.endMs - tc.startMs : undefined;
                                          return (
                                            <Tooltip content={`${tc.toolName}${tcDuration != null ? `: ${formatElapsed(tcDuration)}` : ''}`} placement="bottom">
                                              <span
                                                key={j}
                                                className={`absolute top-1/2 -translate-y-1/2 w-[5px] h-[5px] rounded-full ${dotColor(tcDuration)} opacity-90`}
                                                style={{ left: `${pct}%` }}
                                                data-testid={`tool-dot-${i}-${j}`}
                                              />
                                            </Tooltip>
                                          );
                                        })}
                                      </div>
                                    )}
                                    <PhaseIcon className="w-3 h-3 flex-shrink-0 relative z-[2]" />
                                    <span className="truncate text-sm font-medium relative z-[2]">{phase.label}</span>
                                    {duration > 0 && (
                                      <span className="font-mono text-sm opacity-60 relative z-[2] flex-shrink-0">
                                        {formatElapsed(duration)}
                                      </span>
                                    )}
                                  </motion.div>
                                  </Tooltip>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </ExecutionTerminal>
        </motion.div>
      )}
    </div>
  );
}

// ── Inline Healing Notification Card ────────────────────────────────

function HealingCard({
  notification,
  onDismiss,
}: {
  notification: HealingEventPayload;
  onDismiss: () => void;
}) {
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const isRetry = notification.auto_fixed && notification.backoff_seconds != null;
  const isIssue = !notification.auto_fixed;

  // Countdown timer for retry backoff
  const [countdown, setCountdown] = useState(notification.backoff_seconds ?? 0);
  useEffect(() => {
    if (!isRetry || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isRetry, countdown]);

  // Reset countdown when notification changes
  useEffect(() => {
    setCountdown(notification.backoff_seconds ?? 0);
  }, [notification.backoff_seconds]);

  // Style based on action type
  const styles = isIssue
    ? { border: 'border-red-500/25', bg: 'bg-red-500/[0.04]', icon: 'text-red-400', accent: 'text-red-400' }
    : { border: 'border-amber-500/25', bg: 'bg-amber-500/[0.04]', icon: 'text-amber-400', accent: 'text-amber-300' };

  return (
    <motion.div
      initial={{ opacity: 0, y: -8, height: 0 }}
      animate={{ opacity: 1, y: 0, height: 'auto' }}
      exit={{ opacity: 0, y: -8, height: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`rounded-xl border ${styles.border} ${styles.bg} overflow-hidden`}
    >
      <div className="px-4 py-3.5 space-y-2.5">
        {/* Header row */}
        <div className="flex items-start gap-2.5">
          <ShieldAlert className={`w-4 h-4 mt-0.5 flex-shrink-0 ${styles.icon}`} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-semibold ${styles.accent}`}>
                {notification.title}
              </span>
              <span className="text-sm font-mono px-1.5 py-0.5 rounded bg-secondary/40 text-muted-foreground/60 border border-primary/8">
                {notification.severity}
              </span>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-muted-foreground/50 hover:text-foreground/80 transition-colors flex-shrink-0 p-0.5"
          >
            <span className="text-sm">dismiss</span>
          </button>
        </div>

        {/* Strategy & description */}
        {notification.strategy && (
          <div className="flex items-center gap-2 text-sm">
            <RotateCw className={`w-3.5 h-3.5 flex-shrink-0 ${styles.icon} opacity-60`} />
            <span className="text-foreground/80">{notification.strategy}</span>
          </div>
        )}

        {/* Retry countdown + progress */}
        {isRetry && notification.retry_number != null && notification.max_retries != null && (
          <div className="flex items-center gap-3 pt-1">
            {/* Countdown */}
            {countdown > 0 && (
              <div className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-400/60 animate-pulse" />
                <span className="text-sm font-mono text-amber-300/90">
                  Retrying in {countdown}s...
                </span>
              </div>
            )}
            {countdown === 0 && (
              <div className="flex items-center gap-1.5">
                <RotateCw className="w-3.5 h-3.5 text-blue-400/70 animate-spin" />
                <span className="text-sm font-mono text-blue-300/90">
                  Retrying now...
                </span>
              </div>
            )}
            {/* Attempt badge */}
            <span className="ml-auto text-sm font-mono text-muted-foreground/60 px-2 py-0.5 rounded bg-secondary/30 border border-primary/8">
              Attempt {notification.retry_number} of {notification.max_retries}
            </span>
          </div>
        )}

        {/* Backoff progress bar */}
        {isRetry && (notification.backoff_seconds ?? 0) > 0 && (
          <div className="w-full h-1 rounded-full bg-secondary/40 overflow-hidden">
            <motion.div
              className="h-full rounded-full bg-amber-500/40"
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: notification.backoff_seconds ?? 0, ease: 'linear' }}
            />
          </div>
        )}

        {/* Issue-created: link to healing panel */}
        {isIssue && (
          <button
            onClick={() => setSidebarSection('overview')}
            className="flex items-center gap-1.5 text-sm text-red-400/80 hover:text-red-300 transition-colors"
          >
            <ExternalLink className="w-3 h-3" />
            View in healing issues
          </button>
        )}

        {/* Suggested fix */}
        {notification.suggested_fix && (
          <p className="text-sm text-muted-foreground/60 leading-relaxed pl-6.5">
            {notification.suggested_fix}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// AI Healing Counters — phase badge + fix count for TerminalStrip
// ---------------------------------------------------------------------------

function AiHealingCounters({
  phase,
  fixCount,
  shouldRetry,
}: {
  phase: string;
  fixCount: number;
  shouldRetry: boolean;
}) {
  const label = (() => {
    switch (phase) {
      case 'started':
        return 'AI Healing started';
      case 'diagnosing':
        return 'Diagnosing...';
      case 'applying':
        return `Applying ${fixCount} fix${fixCount !== 1 ? 'es' : ''}...`;
      case 'completed':
        return fixCount > 0
          ? `${fixCount} fix${fixCount !== 1 ? 'es' : ''} applied${shouldRetry ? ' — retrying' : ''}`
          : 'No fixes needed';
      case 'failed':
        return 'Healing failed';
      default:
        return '';
    }
  })();

  const dotColor =
    phase === 'completed'
      ? 'bg-emerald-400'
      : phase === 'failed'
        ? 'bg-red-400'
        : 'bg-violet-400 animate-pulse';

  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {label}
    </span>
  );
}
