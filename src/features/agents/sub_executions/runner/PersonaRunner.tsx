import { useState, useEffect, useRef, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useElapsedTimer } from '@/hooks';
import { useAgentStore } from "@/stores/agentStore";
import { useSystemStore } from "@/stores/systemStore";
import { useAiHealingStream } from '@/hooks/execution/useAiHealingStream';
import { useExecutionStream } from '@/hooks/execution/useExecutionStream';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { Play, Clock } from 'lucide-react';
import { classifyLine, parseSummaryLine } from '@/lib/utils/terminalColors';
import { ExecutionTerminal } from '@/features/agents/sub_executions/runner/ExecutionTerminal';
import type { TerminalEmptyState } from '@/features/shared/components/terminal/TerminalBody';
import { useExecutionList } from '../libs/useExecutionList';
import { useActivityMonitor } from '@/hooks/execution/useActivityMonitor';
import { useFileChanges } from '@/hooks/execution/useFileChanges';
import { FileChangesPanel } from './FileChangesPanel';

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
  const rerunInputData = useSystemStore((state) => state.rerunInputData);
  const setRerunInputData = useSystemStore((state) => state.setRerunInputData);
  const queuePosition = useAgentStore((s) => s.queuePosition);
  const queueDepth = useAgentStore((s) => s.queueDepth);
  const cloudConfig = useSystemStore((s) => s.cloudConfig);

  const personaId = selectedPersona?.id || '';

  // Shared execution stream — ownership check + output subscription
  const { lines: executionLines, isOwner: isThisPersonasExecution } = useExecutionStream(personaId);

  const runnerRef = useRef<HTMLDivElement>(null);
  // Shared execution list — provides typicalDurationMs derived from store data
  const { typicalDurationMs } = useExecutionList(personaId);

  const [inputData, setInputData] = useState('{}');
  const [showInputEditor, setShowInputEditor] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const elapsedMs = useElapsedTimer(isExecuting, 500);

  const [healingNotification, setHealingNotification] = useState<HealingEventPayload | null>(null);
  const aiHealing = useAiHealingStream(personaId);
  const [showHealingLog, setShowHealingLog] = useState(false);

  const { phases, showPhases, setShowPhases } = usePhaseTracker(outputLines, elapsedMs, isExecuting, personaId);
  const { terminalHeight, isTerminalFullscreen, handleTerminalResizeStart, toggleTerminalFullscreen } = useTerminalResize();
  const { staleLevel } = useActivityMonitor(activeExecutionId, isExecuting && isThisPersonasExecution);
  const { changes, editedCount, createdCount, readCount } = useFileChanges(activeExecutionId);

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

  const { handleExecute, handleStop, handleResume } = useRunnerActions({
    personaId, inputData, outputLines, setOutputLines, setJsonError, elapsedMs, executionSummary, fetchTypicalDuration: () => {},
  });

  // Pre-warm budget data when persona is selected so it's fresh before user clicks Run
  const fetchBudgetSpend = useAgentStore((s) => s.fetchBudgetSpend);
  useEffect(() => {
    if (personaId) void fetchBudgetSpend();
  }, [personaId, fetchBudgetSpend]);

  // Sync shared execution stream to local lines (local state needed for useRunnerActions mutations)
  useEffect(() => {
    if (executionLines.length > 0) setOutputLines(executionLines);
    else if (!isThisPersonasExecution) setOutputLines([]);
  }, [executionLines, isThisPersonasExecution]);

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
      <h4 className="flex items-center gap-2.5 typo-heading text-foreground/90 tracking-wide">
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

      {healingNotification && !isExecuting && isThisPersonasExecution && (
          <HealingCard notification={healingNotification} onDismiss={() => setHealingNotification(null)} />
        )}

      {import.meta.env.DEV && aiHealing.phase !== 'idle' && (
        <TerminalStrip
          lastLine={aiHealing.lastLine} lines={aiHealing.lines}
          isRunning={aiHealing.phase === 'started' || aiHealing.phase === 'diagnosing' || aiHealing.phase === 'applying'}
          isExpanded={showHealingLog} onToggle={() => setShowHealingLog((v) => !v)} operation="healing_analysis"
          counters={<AiHealingCounters phase={aiHealing.phase} fixCount={aiHealing.fixesApplied.length} shouldRetry={aiHealing.shouldRetry} />}
        />
      )}

      {!(isThisPersonasExecution && (isExecuting || outputLines.length > 0)) && (
          <RunnerEmptyState persona={selectedPersona} />
        )}

      {isThisPersonasExecution && (isExecuting || outputLines.length > 0) && (
        <div className="animate-fade-slide-in">
          <ExecutionTerminal
            lines={outputLines} isRunning={isExecuting} onStop={handleStop}
            label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined}
            isFullscreen={isTerminalFullscreen} onToggleFullscreen={toggleTerminalFullscreen}
            terminalHeight={terminalHeight} onResizeStart={handleTerminalResizeStart} emptyState={terminalEmptyState}
            staleLevel={staleLevel}
          >
            <FileChangesPanel
              changes={changes}
              editedCount={editedCount}
              createdCount={createdCount}
              readCount={readCount}
            />
            {queuePosition != null && isThisPersonasExecution && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 bg-amber-500/5">
                <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                <span className="typo-heading text-amber-300/90">
                  Queued -- position {queuePosition + 1}{queueDepth != null ? ` of ${queueDepth}` : ''}
                </span>
              </div>
            )}
            <PhaseTimeline phases={phases} isExecuting={isExecuting} elapsedMs={elapsedMs}
              showPhases={showPhases} onTogglePhases={() => setShowPhases(!showPhases)} />
          </ExecutionTerminal>
        </div>
      )}
    </div>
  );
}
