import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { usePersonaExecution } from '@/hooks/execution/usePersonaExecution';
import { Play, Square, ChevronDown, ChevronRight, Cloud, Clock, CheckCircle2, XCircle, Timer, DollarSign, ArrowDown, Pause, RotateCw, Wrench, Zap, Brain, Cpu, CheckCheck, AlertTriangle } from 'lucide-react';
import { TerminalHeader } from '@/features/shared/components/TerminalHeader';
import { TerminalSearchBar, useTerminalFilter } from '@/features/shared/components/TerminalSearchBar';
import { classifyLine, TERMINAL_STYLE_MAP, parseSummaryLine } from '@/lib/utils/terminalColors';
import { motion, AnimatePresence } from 'framer-motion';
import * as api from '@/api/tauriApi';

function formatElapsed(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const rem = secs % 60;
  return `${mins}m ${rem}s`;
}

interface PhaseEntry {
  id: string;
  label: string;
  startMs: number;
  endMs?: number;
}

const PHASE_META: Record<string, { label: string; icon: typeof Zap }> = {
  initializing: { label: 'Initializing', icon: Zap },
  thinking: { label: 'Thinking', icon: Brain },
  calling_tools: { label: 'Running tools', icon: Cpu },
  responding: { label: 'Responding', icon: Brain },
  finalizing: { label: 'Finalizing', icon: CheckCheck },
  error: { label: 'Error', icon: AlertTriangle },
};

function detectPhaseFromLine(line: string, hasSeenTools: boolean): string | null {
  if (!line.trim()) return null;
  if (line.startsWith('Execution started') || line.startsWith('Cloud execution started') || line.startsWith('Session started')) return 'initializing';
  if (line.startsWith('> Using tool:') || line.startsWith('  Tool result:')) return 'calling_tools';
  if (line.startsWith('[ERROR]') || line.startsWith('[TIMEOUT]') || line.startsWith('[WARN]')) return 'error';
  if (line.startsWith('[SUMMARY]') || line.startsWith('Completed in') || line.startsWith('Cost: $') || line.startsWith('Process exited')) return 'finalizing';
  if (line.startsWith('=== Execution cancelled ===')) return 'finalizing';
  const style = classifyLine(line);
  if (style === 'text') return hasSeenTools ? 'responding' : 'thinking';
  return null;
}

export function PersonaRunner() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const executePersona = usePersonaStore((state) => state.executePersona);
  const cancelExecution = usePersonaStore((state) => state.cancelExecution);
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const activeExecutionId = usePersonaStore((state) => state.activeExecutionId);
  const executionOutput = usePersonaStore((state) => state.executionOutput);

  const rerunInputData = usePersonaStore((state) => state.rerunInputData);
  const setRerunInputData = usePersonaStore((state) => state.setRerunInputData);

  const cloudConfig = usePersonaStore((s) => s.cloudConfig);
  const cloudExecute = usePersonaStore((s) => s.cloudExecute);

  const { disconnect } = usePersonaExecution();

  const { filter, setFilter, isLineVisible, isFiltering } = useTerminalFilter();

  const runnerRef = useRef<HTMLDivElement>(null);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);
  const lastSeenLineCount = useRef(0);
  const [unseenCount, setUnseenCount] = useState(0);
  const [inputData, setInputData] = useState('{}');
  const [showInputEditor, setShowInputEditor] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [typicalDurationMs, setTypicalDurationMs] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const personaId = selectedPersona?.id || '';

  // Phase tracking for breadcrumb strip
  const [phases, setPhases] = useState<PhaseEntry[]>([]);
  const [showPhases, setShowPhases] = useState(true);
  const phaseLineCount = useRef(0);
  const hasSeenToolsRef = useRef(false);

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
    } catch {
      setTypicalDurationMs(null);
    }
  }, []);

  // Start/stop elapsed timer when execution state changes
  useEffect(() => {
    if (isExecuting) {
      startTimeRef.current = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setElapsedMs(Date.now() - startTimeRef.current);
        }
      }, 500);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      startTimeRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isExecuting]);

  // Sync store output to local lines
  useEffect(() => {
    if (executionOutput.length > 0) {
      setOutputLines(executionOutput);
    }
  }, [executionOutput]);

  // Derive phases from new output lines
  useEffect(() => {
    if (outputLines.length <= phaseLineCount.current) return;
    const now = elapsedMs;

    setPhases((prev) => {
      const updated = [...prev];
      for (let i = phaseLineCount.current; i < outputLines.length; i++) {
        const line = outputLines[i]!;
        const detected = detectPhaseFromLine(line, hasSeenToolsRef.current);
        if (!detected) continue;
        if (detected === 'calling_tools') hasSeenToolsRef.current = true;

        const currentPhase = updated[updated.length - 1];
        if (currentPhase?.id === detected) continue;

        if (currentPhase && !currentPhase.endMs) {
          currentPhase.endMs = now;
        }
        updated.push({ id: detected, label: PHASE_META[detected]?.label ?? detected, startMs: now });
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

  // Auto-scroll terminal and track unseen lines
  useEffect(() => {
    if (terminalBodyRef.current && shouldAutoScroll.current) {
      terminalBodyRef.current.scrollTop = terminalBodyRef.current.scrollHeight;
      lastSeenLineCount.current = outputLines.length;
      setUnseenCount(0);
    } else if (!shouldAutoScroll.current && outputLines.length > lastSeenLineCount.current) {
      setUnseenCount(outputLines.length - lastSeenLineCount.current);
    }
  }, [outputLines.length]);

  const handleTerminalScroll = useCallback(() => {
    if (terminalBodyRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = terminalBodyRef.current;
      const atBottom = Math.abs(scrollHeight - clientHeight - scrollTop) < 10;
      shouldAutoScroll.current = atBottom;
      if (atBottom) {
        lastSeenLineCount.current = outputLines.length;
        setUnseenCount(0);
      }
    }
  }, [outputLines.length]);

  const scrollToBottom = useCallback(() => {
    if (terminalBodyRef.current) {
      terminalBodyRef.current.scrollTo({ top: terminalBodyRef.current.scrollHeight, behavior: 'smooth' });
      shouldAutoScroll.current = true;
      lastSeenLineCount.current = outputLines.length;
      setUnseenCount(0);
    }
  }, [outputLines.length]);

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
      } catch {
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
      <div className="flex items-center justify-center py-8 text-muted-foreground/40">
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

  const handleStop = () => {
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

      disconnect();
      cancelExecution(activeExecutionId);
      setOutputLines((prev) => [...prev, '', `[SUMMARY]${cancelSummary}`]);
    }
  };

  const handleResume = () => {
    if (!selectedPersona) return;
    const lastTool = executionSummary?.last_tool;
    let resumeInput: Record<string, unknown> = {};
    try {
      resumeInput = JSON.parse(inputData);
    } catch {
      // keep empty
    }
    resumeInput._resume_hint = `Previous execution was cancelled${
      executionSummary?.duration_ms ? ` after ${formatElapsed(executionSummary.duration_ms)}` : ''
    }${lastTool ? ` while running tool "${lastTool}"` : ''}. Please continue from where the previous execution left off.`;

    const formatted = JSON.stringify(resumeInput, null, 2);
    setInputData(formatted);
    setShowInputEditor(true);
    setOutputLines([]);
    // Trigger execution with resume context
    setTimeout(() => {
      handleExecute();
    }, 0);
  };

  const handleCopyLog = () => {
    navigator.clipboard.writeText(outputLines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div ref={runnerRef} className="space-y-5">
      <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">Run Persona</h3>

      {/* Input Data Section */}
      <div className="space-y-2">
        <button
          onClick={() => setShowInputEditor(!showInputEditor)}
          className="flex items-center gap-2 text-sm text-foreground/70 hover:text-foreground transition-colors"
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
              <textarea
                value={inputData}
                onChange={(e) => {
                  setInputData(e.target.value);
                  if (jsonError) setJsonError(null);
                }}
                placeholder='{"key": "value"}'
                className={`w-full h-32 px-4 py-3 bg-background/50 border rounded-2xl text-foreground font-mono text-sm resize-y focus:outline-none focus:ring-2 transition-all placeholder-muted-foreground/30 ${
                  jsonError
                    ? 'border-red-500/30 ring-1 ring-red-500/30 focus:ring-red-500/40 focus:border-red-500/40'
                    : 'border-border/50 focus:ring-primary/40 focus:border-primary/40'
                }`}
                spellCheck={false}
              />
              {jsonError && (
                <p className="text-red-400/80 text-xs mt-1">{jsonError}</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Execute Button */}
      <button
        onClick={isExecuting ? handleStop : handleExecute}
        className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-2xl font-medium text-sm transition-all ${
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

      {/* Progress Indicator */}
      {isExecuting && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-xl"
        >
          <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            {typicalDurationMs ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground/60">
                    {formatElapsed(elapsedMs)} elapsed
                  </span>
                  <span className="text-muted-foreground/40">
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
              <span className="text-xs text-muted-foreground/50">
                {formatElapsed(elapsedMs)} elapsed
              </span>
            )}
          </div>
        </motion.div>
      )}

      {/* Persistent Execution Summary Card */}
      {!isExecuting && executionSummary && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className={`rounded-xl border p-4 ${
            executionSummary.status === 'completed'
              ? 'border-emerald-500/20 bg-emerald-500/5'
              : executionSummary.status === 'cancelled'
                ? 'border-amber-500/20 bg-amber-500/5'
                : executionSummary.status === 'failed'
                  ? 'border-red-500/20 bg-red-500/5'
                  : 'border-amber-500/20 bg-amber-500/5'
          }`}
        >
          <div className="flex items-center gap-5 flex-wrap">
            <div className="flex items-center gap-2">
              {executionSummary.status === 'completed' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              ) : executionSummary.status === 'cancelled' ? (
                <Pause className="w-5 h-5 text-amber-400" />
              ) : executionSummary.status === 'failed' ? (
                <XCircle className="w-5 h-5 text-red-400" />
              ) : (
                <XCircle className="w-5 h-5 text-amber-400" />
              )}
              <span className={`text-sm font-semibold capitalize ${
                executionSummary.status === 'completed'
                  ? 'text-emerald-400'
                  : executionSummary.status === 'failed'
                    ? 'text-red-400'
                    : 'text-amber-400'
              }`}>
                {executionSummary.status}
              </span>
            </div>

            {executionSummary.duration_ms != null && (
              <div className="flex items-center gap-1.5 text-muted-foreground/60">
                <Timer className="w-3.5 h-3.5" />
                <span className="text-sm font-mono">{(executionSummary.duration_ms / 1000).toFixed(1)}s</span>
              </div>
            )}

            {executionSummary.cost_usd != null && (
              <div className="flex items-center gap-1.5 text-muted-foreground/60">
                <DollarSign className="w-3.5 h-3.5" />
                <span className="text-sm font-mono">${executionSummary.cost_usd.toFixed(4)}</span>
              </div>
            )}
          </div>

          {/* Cancelled-specific: last tool + resume */}
          {executionSummary.status === 'cancelled' && (
            <div className="mt-3 pt-3 border-t border-amber-500/15 space-y-3">
              {executionSummary.last_tool && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground/50">
                  <Wrench className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" />
                  <span>Stopped while running</span>
                  <code className="px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-300/80 font-mono text-[11px]">
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

      {/* Terminal Output */}
      {(isExecuting || outputLines.length > 0) && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="relative border border-border/30 rounded-2xl overflow-hidden bg-background shadow-[0_0_30px_rgba(0,0,0,0.3)]">
            <TerminalHeader
              isRunning={isExecuting}
              lineCount={outputLines.length}
              onCopy={handleCopyLog}
              copied={copied}
              label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined}
            />

            <TerminalSearchBar filter={filter} onChange={setFilter} />

            {/* Phase breadcrumb strip */}
            {phases.length > 0 && (
              <div className="border-b border-border/20">
                <button
                  onClick={() => setShowPhases(!showPhases)}
                  className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors uppercase tracking-wider"
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
                      <div className="flex items-center gap-1 px-3 pb-2 flex-wrap">
                        {phases.map((phase, i) => {
                          const isActive = i === phases.length - 1 && isExecuting;
                          const meta = PHASE_META[phase.id];
                          const PhaseIcon = meta?.icon ?? Zap;
                          const duration = phase.endMs != null
                            ? phase.endMs - phase.startMs
                            : isActive
                              ? elapsedMs - phase.startMs
                              : 0;

                          return (
                            <div key={`${phase.id}-${i}`} className="flex items-center gap-1">
                              {i > 0 && (
                                <div className="w-3 h-px bg-primary/15 mx-0.5" />
                              )}
                              <div
                                className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-colors ${
                                  isActive
                                    ? 'bg-primary/12 text-primary/80 border border-primary/20'
                                    : 'bg-secondary/30 text-muted-foreground/50 border border-transparent'
                                }`}
                              >
                                <PhaseIcon className={`w-3 h-3 flex-shrink-0 ${isActive ? 'animate-pulse' : ''}`} />
                                <span>{phase.label}</span>
                                {duration > 0 && (
                                  <span className={`font-mono text-[10px] ${isActive ? 'text-primary/50' : 'text-muted-foreground/30'}`}>
                                    {formatElapsed(duration)}
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

            {/* Terminal body */}
            <div className="relative">
            <div
              ref={terminalBodyRef}
              onScroll={handleTerminalScroll}
              className="p-4 max-h-[400px] overflow-y-auto font-mono text-xs space-y-0.5"
            >
              {outputLines.map((line, i) => {
                if (!line.trim()) return <div key={i} className="h-2" />;
                const style = classifyLine(line);
                const visible = isLineVisible(line, style);

                if (style === 'summary') {
                  const summary = parseSummaryLine(line);
                  if (summary) {
                    const isSuccess = summary.status === 'completed';
                    const isFailed = summary.status === 'failed';
                    const isCancelled = summary.status === 'cancelled';
                    return (
                      <div key={i} className={`border-t border-primary/15 pt-2 mt-2 transition-opacity ${isFiltering && !visible ? 'opacity-20' : ''}`}>
                        <div className="flex items-center gap-4 flex-wrap">
                          <div className="flex items-center gap-1.5">
                            {isSuccess ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                            ) : isCancelled ? (
                              <Pause className="w-3.5 h-3.5 text-amber-400" />
                            ) : isFailed ? (
                              <XCircle className="w-3.5 h-3.5 text-red-400" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-amber-400" />
                            )}
                            <span className={`font-semibold capitalize ${isSuccess ? 'text-emerald-400/90' : isFailed ? 'text-red-400/90' : 'text-amber-400/90'}`}>
                              {summary.status}
                            </span>
                          </div>
                          {summary.duration_ms != null && (
                            <div className="flex items-center gap-1.5 text-muted-foreground/60">
                              <Timer className="w-3 h-3" />
                              <span>{(summary.duration_ms / 1000).toFixed(1)}s</span>
                            </div>
                          )}
                          {summary.cost_usd != null && (
                            <div className="flex items-center gap-1.5 text-muted-foreground/60">
                              <DollarSign className="w-3 h-3" />
                              <span>${summary.cost_usd.toFixed(4)}</span>
                            </div>
                          )}
                          {isCancelled && summary.last_tool && (
                            <div className="flex items-center gap-1.5 text-muted-foreground/50">
                              <Wrench className="w-3 h-3 text-amber-400/60" />
                              <span className="text-amber-300/60">{summary.last_tool}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                }

                return (
                  <div key={i} className={`leading-5 whitespace-pre-wrap break-all ${TERMINAL_STYLE_MAP[style]} transition-opacity ${isFiltering && !visible ? 'opacity-20' : ''}`}>
                    {line}
                  </div>
                );
              })}
              {isExecuting && (
                <div className="text-muted-foreground/30 animate-pulse">{'>'} _</div>
              )}
            </div>

            {/* Jump-to-bottom FAB */}
            <AnimatePresence>
              {unseenCount > 0 && (
                <motion.button
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={{ duration: 0.15 }}
                  onClick={scrollToBottom}
                  className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/90 text-foreground text-[11px] font-medium shadow-lg shadow-primary/20 hover:bg-primary transition-colors backdrop-blur-sm"
                >
                  <ArrowDown className="w-3 h-3" />
                  {unseenCount} new line{unseenCount !== 1 ? 's' : ''} below
                </motion.button>
              )}
            </AnimatePresence>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
