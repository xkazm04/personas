import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useElapsedTimer } from '@/hooks';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { Play, Clock } from 'lucide-react';
import { classifyLine, parseSummaryLine } from '@/lib/utils/terminalColors';
import { motion, AnimatePresence } from 'framer-motion';
import { ExecutionTerminal } from '@/features/agents/sub_executions/runner/ExecutionTerminal';
import type { TerminalEmptyState } from '@/features/shared/components/terminal/TerminalBody';
import { listExecutions } from "@/api/agents/executions";

import type { HealingEventPayload } from '../runnerTypes';
import { HealingCard } from '../detail/HealingCard';
import { AiHealingCounters } from '../detail/AiHealingCounters';
import { PhaseTimeline } from './PhaseTimeline';
import { ExecutionSummaryCard } from '../detail/views/ExecutionSummaryCard';
import { ProgressIndicator } from './ProgressIndicator';
import { RunnerEmptyState } from './RunnerEmptyState';
import { InputExecuteCard } from './InputExecuteCard';
import { usePhaseTracker } from './usePhaseTracker';
import { useTerminalResize } from './useTerminalResize';
import { useRunnerActions } from './useRunnerActions';


export function PersonaRunner() {
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const isExecuting = useAgentStore((state) => state.isExecuting);
  const activeExecutionId = useAgentStore((state) => state.activeExecutionId);
  const executionOutput = useAgentStore((state) => state.executionOutput);
  const executionPersonaId = useAgentStore((state) => state.executionPersonaId);
  const rerunInputData = useSystemStore((state) => state.rerunInputData);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);
  const queuePosition = useAgentStore((s) => s.queuePosition);
  const queueDepth = useAgentStore((s) => s.queueDepth);
  const cloudConfig = useSystemStore((s) => s.cloudConfig);

  const runnerRef = useRef<HTMLDivElement>(null);
  const [inputData, setInputData] = useState('{}');
  const [showInputEditor, setShowInputEditor] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [typicalDurationMs, setTypicalDurationMs] = useState<number | null>(null);
  const elapsedMs = useElapsedTimer(isExecuting, 500);

  const personaId = selectedPersona?.id || '';
  const isThisPersonasExecution = executionPersonaId === personaId && personaId !== '';

  const [healingNotification, setHealingNotification] = useState<HealingEventPayload | null>(null);
  const aiHealing = useAiHealingStream(personaId);
  const [showHealingLog, setShowHealingLog] = useState(false);

  const { phases, showPhases, setShowPhases } = usePhaseTracker(outputLines, elapsedMs, isExecuting, personaId);
  const { terminalHeight, isTerminalFullscreen, handleTerminalResizeStart, toggleTerminalFullscreen } = useTerminalResize();

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

  const terminalEmptyState = useMemo((): TerminalEmptyState => {
    if (!isExecuting) return 'idle';
    if (queuePosition != null) return { kind: 'queued', position: queuePosition + 1, depth: queueDepth ?? undefined };
    return 'connecting';
  }, [isExecuting, queuePosition, queueDepth]);

  const fetchTypicalDuration = useCallback(async (pId: string) => {
    try {
      const execs = await listExecutions(pId, 20);
      const durations: number[] = execs
        .filter((e): e is typeof e & { duration_ms: number } =>
          e.status === 'completed' && typeof e.duration_ms === 'number' && e.duration_ms > 0)
        .map((e) => e.duration_ms);
      if (durations.length > 0) {
        durations.sort((a, b) => a - b);
        setTypicalDurationMs(durations[Math.floor(durations.length / 2)] ?? null);
      } else { setTypicalDurationMs(null); }
    } catch (err) { console.warn('[PersonaRunner] Failed to fetch typical duration:', err); setTypicalDurationMs(null); }
  }, []);

  const { handleExecute, handleStop, handleResume } = useRunnerActions({
    personaId, inputData, outputLines, setOutputLines, setJsonError, elapsedMs, executionSummary, fetchTypicalDuration,
  });

  // Pre-warm budget data when persona is selected so it's fresh before user clicks Run
  const fetchBudgetSpend = useAgentStore((s) => s.fetchBudgetSpend);
  useEffect(() => {
    if (personaId) void fetchBudgetSpend();
  }, [personaId, fetchBudgetSpend]);

  // Sync store output to local lines
  useEffect(() => {
    if (isThisPersonasExecution && executionOutput.length > 0) setOutputLines(executionOutput);
    else if (!isThisPersonasExecution) setOutputLines([]);
  }, [executionOutput, isThisPersonasExecution]);

  // Listen for healing events
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<HealingEventPayload>('healing-event', (event) => {
      if (cancelled) return;
      if (event.payload.persona_id !== personaId) return;
      setHealingNotification(event.payload);
    }).then((fn) => { if (cancelled) fn(); else unlistenFn = fn; })
      .catch((err) => { console.warn('[PersonaRunner] Failed to listen for healing events:', err); });
    return () => { cancelled = true; unlistenFn?.(); };
  }, [personaId]);

  useEffect(() => { if (isExecuting) setHealingNotification(null); }, [isExecuting]);

  // Pick up re-run input from store
  useEffect(() => {
    if (rerunInputData !== null) {
      try { setInputData(JSON.stringify(JSON.parse(rerunInputData), null, 2)); }
      catch { setInputData(rerunInputData); }
      setShowInputEditor(true);
      setJsonError(null);
      setRerunInputData(null);
      runnerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [rerunInputData, setRerunInputData]);

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground/80">No persona selected</div>;
  }

  return (
    <div ref={runnerRef} className="space-y-4">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Play className="w-3.5 h-3.5" />
        Run Persona
      </h4>

      <InputExecuteCard
        inputData={inputData} onInputChange={setInputData} showInputEditor={showInputEditor}
        onToggleInputEditor={() => setShowInputEditor(!showInputEditor)} jsonError={jsonError}
        onClearJsonError={() => setJsonError(null)} isExecuting={isExecuting}
        isCloudConnected={!!cloudConfig?.is_connected} onExecute={handleExecute} onStop={handleStop}
      />

      {isExecuting && isThisPersonasExecution && (
        <ProgressIndicator elapsedMs={elapsedMs} typicalDurationMs={typicalDurationMs} />
      )}

      {!isExecuting && isThisPersonasExecution && executionSummary && (
        <ExecutionSummaryCard executionSummary={executionSummary} onResume={handleResume} />
      )}

      <AnimatePresence>
        {healingNotification && !isExecuting && isThisPersonasExecution && (
          <HealingCard notification={healingNotification} onDismiss={() => setHealingNotification(null)} />
        )}
      </AnimatePresence>

      {import.meta.env.DEV && aiHealing.phase !== 'idle' && (
        <TerminalStrip
          lastLine={aiHealing.lastLine} lines={aiHealing.lines}
          isRunning={aiHealing.phase === 'started' || aiHealing.phase === 'diagnosing' || aiHealing.phase === 'applying'}
          isExpanded={showHealingLog} onToggle={() => setShowHealingLog((v) => !v)} operation="healing_analysis"
          counters={<AiHealingCounters phase={aiHealing.phase} fixCount={aiHealing.fixesApplied.length} shouldRetry={aiHealing.shouldRetry} />}
        />
      )}

      <AnimatePresence>
        {!(isThisPersonasExecution && (isExecuting || outputLines.length > 0)) && (
          <RunnerEmptyState persona={selectedPersona} />
        )}
      </AnimatePresence>

      {isThisPersonasExecution && (isExecuting || outputLines.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <ExecutionTerminal
            lines={outputLines} isRunning={isExecuting} onStop={handleStop}
            label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined}
            isFullscreen={isTerminalFullscreen} onToggleFullscreen={toggleTerminalFullscreen}
            terminalHeight={terminalHeight} onResizeStart={handleTerminalResizeStart} emptyState={terminalEmptyState}
          >
            {queuePosition != null && isThisPersonasExecution && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 bg-amber-500/5">
                <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="text-sm text-amber-300/90 font-medium">
                  Queued -- position {queuePosition + 1}{queueDepth != null ? ` of ${queueDepth}` : ''}
                </span>
              </div>
            )}
            <PhaseTimeline phases={phases} isExecuting={isExecuting} elapsedMs={elapsedMs}
              showPhases={showPhases} onTogglePhases={() => setShowPhases(!showPhases)} />
          </ExecutionTerminal>
        </motion.div>
      )}
    </div>
  );
}
