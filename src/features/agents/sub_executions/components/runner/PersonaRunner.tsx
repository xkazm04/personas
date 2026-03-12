import { usePersonaStore } from '@/stores/personaStore';
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { Play, Square, ChevronDown, ChevronRight, Cloud, Clock, Timer, DollarSign, RotateCw, Wrench, ShieldAlert, Monitor } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { formatElapsed, getStatusEntry } from '@/lib/utils/formatters';
import { motion, AnimatePresence } from 'framer-motion';
import { KeyValueEditor } from '@/features/shared/components/forms/KeyValueEditor';
import { ExecutionTerminal } from './ExecutionTerminal';
import { useRunnerState } from '../../libs/useRunnerState';
import { useRunnerExecution } from '../../libs/useRunnerExecution';
import { MiniPlayerPinButton, StatusIcon } from './RunnerHeader';
import { HealingCard, AiHealingCounters } from './RunnerToolCalls';
import { RunnerPhaseTimeline } from './RunnerStreamView';

export function PersonaRunner() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const activeExecutionId = usePersonaStore((state) => state.activeExecutionId);
  const cloudConfig = usePersonaStore((s) => s.cloudConfig);
  const queuePosition = usePersonaStore((s) => s.queuePosition);
  const queueDepth = usePersonaStore((s) => s.queueDepth);
  const budgetStatus = usePersonaStore((s) => s.getBudgetStatus(selectedPersona?.id ?? ''));
  const isBudgetBlocked = usePersonaStore((s) => s.isBudgetBlocked(selectedPersona?.id ?? ''));
  const overrideBudgetPause = usePersonaStore((s) => s.overrideBudgetPause);
  const overrideStaleBudget = usePersonaStore((s) => s.overrideStaleBudget);
  const budgetEntry = usePersonaStore((s) => s.budgetSpendMap.get(selectedPersona?.id ?? ''));
  const personaId = selectedPersona?.id || '';

  const state = useRunnerState(personaId);
  const exec = useRunnerExecution({
    personaId,
    inputData: state.inputData,
    setJsonError: state.setJsonError,
    setOutputLines: state.setOutputLines as (fn: (prev: string[]) => string[]) => void,
    fetchTypicalDuration: state.fetchTypicalDuration,
    disconnect: state.disconnect,
    elapsedMs: state.elapsedMs,
    executionSummary: state.executionSummary,
    outputLines: state.outputLines,
    terminalHeight: state.terminalHeight,
    setTerminalHeight: state.setTerminalHeight,
    isTerminalFullscreen: state.isTerminalFullscreen,
    setIsTerminalFullscreen: state.setIsTerminalFullscreen as (fn: (prev: boolean) => boolean) => void,
  });

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-muted-foreground/80">No persona selected</div>;
  }

  const summaryPresentation = getStatusEntry(state.executionSummary?.status ?? 'failed');

  return (
    <div ref={state.runnerRef} className="space-y-4">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Play className="w-3.5 h-3.5" />Run Persona
      </h4>

      {/* Input & Execute Card */}
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-xl p-4 space-y-4">
        <div className="space-y-2">
          <button onClick={() => state.setShowInputEditor(!state.showInputEditor)} className="flex items-center gap-2 text-sm text-foreground/90 hover:text-foreground transition-colors">
            {state.showInputEditor ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            Input Data (Optional)
          </button>
          <AnimatePresence>
            {state.showInputEditor && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
                <KeyValueEditor value={state.inputData} onChange={(v) => { state.setInputData(v); if (state.jsonError) state.setJsonError(null); }} placeholder='{"key": "value"}' />
                {state.jsonError && <p className="text-red-400/80 text-sm mt-1">{state.jsonError}</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* Budget enforcement banner */}
        {budgetStatus === 'exceeded' && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-red-500/20 bg-red-500/5">
            <ShieldAlert className="w-4 h-4 text-red-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-400/90 font-medium">Monthly budget exceeded</p>
              {budgetEntry && (
                <p className="text-sm text-red-400/60">${budgetEntry.spend.toFixed(2)} / ${budgetEntry.maxBudget?.toFixed(2)} ({Math.round(budgetEntry.ratio * 100)}%)</p>
              )}
            </div>
            {isBudgetBlocked && (
              <button
                onClick={() => overrideBudgetPause(personaId)}
                className="flex-shrink-0 px-2.5 py-1 text-sm rounded-lg border border-red-500/20 text-red-400/80 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                Override
              </button>
            )}
          </div>
        )}
        {budgetStatus === 'warning' && (
          <div className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-amber-500/15 bg-amber-500/5">
            <ShieldAlert className="w-3.5 h-3.5 text-amber-400/80 flex-shrink-0" />
            <p className="text-sm text-amber-400/80">
              Approaching budget limit
              {budgetEntry && <span className="text-amber-400/60"> -- ${budgetEntry.spend.toFixed(2)} / ${budgetEntry.maxBudget?.toFixed(2)} ({Math.round(budgetEntry.ratio * 100)}%)</span>}
            </p>
          </div>
        )}
        {budgetStatus === 'stale' && (
          <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5">
            <ShieldAlert className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-amber-400/90 font-medium">Budget data unavailable</p>
              <p className="text-sm text-amber-400/60">Execution blocked as a safety precaution</p>
            </div>
            {isBudgetBlocked && (
              <button
                onClick={() => overrideStaleBudget(personaId)}
                className="flex-shrink-0 px-2.5 py-1 text-sm rounded-lg border border-amber-500/20 text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/10 transition-colors"
              >
                Run Anyway
              </button>
            )}
          </div>
        )}
        {IS_MOBILE ? (
          <button
            onClick={() => { try { window.open('https://claude.ai/code', '_blank'); } catch { /* intentional no-op */ } }}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-medium text-sm transition-all bg-gradient-to-r from-cyan-500/80 to-blue-500/80 hover:from-cyan-500 hover:to-blue-500 text-foreground shadow-lg shadow-cyan-500/20"
          >
            <Monitor className="w-5 h-5" />
            Connect via Remote Control
          </button>
        ) : (
          <button data-testid="execute-persona-btn" onClick={isExecuting ? exec.handleStop : exec.handleExecute}
            disabled={isBudgetBlocked}
            className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-xl font-medium text-sm transition-all ${isBudgetBlocked ? 'bg-secondary/40 text-muted-foreground/50 cursor-not-allowed' : isExecuting ? 'bg-red-500/80 hover:bg-red-500 text-foreground shadow-lg shadow-red-500/20' : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-lg shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'}`}>
            {isExecuting ? (<><Square className="w-5 h-5" />Stop Execution</>) : (<>{cloudConfig?.is_connected ? <Cloud className="w-5 h-5" /> : <Play className="w-5 h-5" />}{cloudConfig?.is_connected ? 'Execute on Cloud' : 'Execute Persona'}</>)}
          </button>
        )}
      </div>

      {/* Progress Indicator */}
      {isExecuting && state.isThisPersonasExecution && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-xl">
          <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
          <MiniPlayerPinButton />
          <div className="flex-1 min-w-0">
            {state.typicalDurationMs ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground/80">{formatElapsed(state.elapsedMs)} elapsed</span>
                  <span className="text-muted-foreground/80">{state.elapsedMs < state.typicalDurationMs ? `Typically completes in ~${formatElapsed(state.typicalDurationMs)}` : 'Taking longer than usual...'}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                  <motion.div className="h-full rounded-full bg-primary/40" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (state.elapsedMs / state.typicalDurationMs) * 100)}%` }} transition={{ duration: 0.4, ease: 'easeOut' }} />
                </div>
              </div>
            ) : <span className="text-sm text-muted-foreground/90">{formatElapsed(state.elapsedMs)} elapsed</span>}
          </div>
        </motion.div>
      )}

      {/* Summary Card */}
      {!isExecuting && state.isThisPersonasExecution && state.executionSummary && (
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }} className={`rounded-xl border p-4 ${summaryPresentation.border} ${summaryPresentation.bg}`}>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2"><StatusIcon status={state.executionSummary.status} className="w-5 h-5" /><span className={`text-sm font-semibold capitalize ${summaryPresentation.text}`}>{state.executionSummary.status}</span></div>
            {state.executionSummary.duration_ms != null && <div className="flex items-center gap-1.5 text-muted-foreground/80"><Timer className="w-3.5 h-3.5" /><span className="text-sm font-mono">{(state.executionSummary.duration_ms / 1000).toFixed(1)}s</span></div>}
            {state.executionSummary.cost_usd != null && <div className="flex items-center gap-1.5 text-muted-foreground/80"><DollarSign className="w-3.5 h-3.5" /><span className="text-sm font-mono">${state.executionSummary.cost_usd.toFixed(4)}</span></div>}
          </div>
          {state.executionSummary.status === 'cancelled' && (
            <div className="mt-3 pt-3 border-t border-amber-500/15 space-y-3">
              {state.executionSummary.last_tool && <div className="flex items-center gap-2 text-sm text-muted-foreground/90"><Wrench className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" /><span>Stopped while running</span><code className="px-1.5 py-0.5 rounded-lg bg-amber-500/10 text-amber-300/80 font-mono text-sm">{state.executionSummary.last_tool}</code></div>}
              <button onClick={exec.handleResume} className="flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-xl bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"><RotateCw className="w-3.5 h-3.5" />Resume from here</button>
            </div>
          )}
        </motion.div>
      )}

      {/* Healing Notification */}
      <AnimatePresence>
        {state.healingNotification && !isExecuting && state.isThisPersonasExecution && (
          <HealingCard notification={state.healingNotification} onDismiss={() => state.setHealingNotification(null)} />
        )}
      </AnimatePresence>

      {/* AI Self-Healing Strip */}
      {import.meta.env.DEV && state.aiHealing.phase !== 'idle' && (
        <TerminalStrip lastLine={state.aiHealing.lastLine} lines={state.aiHealing.lines} isRunning={state.aiHealing.phase === 'started' || state.aiHealing.phase === 'diagnosing' || state.aiHealing.phase === 'applying'} isExpanded={state.showHealingLog} onToggle={() => state.setShowHealingLog((v: boolean) => !v)} operation="healing_analysis" counters={<AiHealingCounters phase={state.aiHealing.phase} fixCount={state.aiHealing.fixesApplied.length} shouldRetry={state.aiHealing.shouldRetry} />} />
      )}

      {/* Empty state */}
      <AnimatePresence>
        {!(state.isThisPersonasExecution && (isExecuting || state.outputLines.length > 0)) && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="flex flex-col items-center justify-center py-16 gap-4" data-testid="runner-empty-state">
            {selectedPersona.icon ? (sanitizeIconUrl(selectedPersona.icon) ? <img src={sanitizeIconUrl(selectedPersona.icon)!} alt="" className="w-12 h-12 rounded-xl opacity-60" referrerPolicy="no-referrer" crossOrigin="anonymous" /> : isIconUrl(selectedPersona.icon) ? null : <span className="text-4xl leading-none opacity-60">{selectedPersona.icon}</span>) : (
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-lg font-bold opacity-50" style={{ backgroundColor: `${selectedPersona.color || '#6B7280'}20`, border: `1px solid ${selectedPersona.color || '#6B7280'}40`, color: selectedPersona.color || '#6B7280' }}>{selectedPersona.name.charAt(0).toUpperCase()}</div>
            )}
            <div className="text-center space-y-1.5">
              <p className="text-sm font-medium text-foreground/70">{selectedPersona.name}</p>
              <p className="text-sm text-zinc-500">Ready to execute &mdash; click Run or press{' '}<kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800/60 text-zinc-400 text-sm font-mono">Enter</kbd></p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Terminal Output */}
      {state.isThisPersonasExecution && (isExecuting || state.outputLines.length > 0) && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <ExecutionTerminal lines={state.outputLines} isRunning={isExecuting} onStop={exec.handleStop} label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined} isFullscreen={state.isTerminalFullscreen} onToggleFullscreen={exec.toggleTerminalFullscreen} terminalHeight={state.terminalHeight} onResizeStart={exec.handleTerminalResizeStart} emptyState={state.terminalEmptyState}>
            {queuePosition != null && state.isThisPersonasExecution && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 bg-amber-500/5"><Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" /><span className="text-sm text-amber-300/90 font-medium">Queued -- position {queuePosition + 1}{queueDepth != null ? ` of ${queueDepth}` : ''}</span></div>
            )}
            <RunnerPhaseTimeline phases={state.phases} showPhases={state.showPhases} setShowPhases={state.setShowPhases} isExecuting={isExecuting} elapsedMs={state.elapsedMs} />
          </ExecutionTerminal>
        </motion.div>
      )}
    </div>
  );
}
