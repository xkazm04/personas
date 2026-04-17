import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { Play, Square, ChevronDown, ChevronRight, Cloud, Clock, Timer, DollarSign, RotateCw, Wrench, Monitor, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { BudgetRecoveryCard } from './BudgetRecoveryCard';
import { useTranslation } from '@/i18n/useTranslation';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { formatElapsed, getStatusEntry } from '@/lib/utils/formatters';
import { KeyValueEditor } from '@/features/shared/components/forms/KeyValueEditor';
import { ExecutionTerminal } from './ExecutionTerminal';
import { useRunnerState } from '../../libs/useRunnerState';
import { useRunnerExecution } from '../../libs/useRunnerExecution';
import { MiniPlayerPinButton, StatusIcon } from './RunnerHeader';
import { HealingCard, AiHealingCounters } from './RunnerToolCalls';
import { RunnerPhaseTimeline } from './RunnerStreamView';
import { StuckExecutionGuidance } from './StuckExecutionGuidance';

export function PersonaRunner() {
  const selectedPersona = useAgentStore((state) => state.selectedPersona);
  const isExecuting = useAgentStore((state) => state.isExecuting);
  const activeExecutionId = useAgentStore((state) => state.activeExecutionId);
  const cloudConfig = useSystemStore((s) => s.cloudConfig);
  const queuePosition = useAgentStore((s) => s.queuePosition);
  const queueDepth = useAgentStore((s) => s.queueDepth);
  const budgetStatus = useAgentStore((s) => s.getBudgetStatus(selectedPersona?.id ?? ''));
  const isBudgetBlocked = useAgentStore((s) => s.isBudgetBlocked(selectedPersona?.id ?? ''));
  const overrideBudgetPause = useAgentStore((s) => s.overrideBudgetPause);
  const overrideStaleBudget = useAgentStore((s) => s.overrideStaleBudget);
  const budgetEntry = useAgentStore((s) => s.budgetSpendMap.get(selectedPersona?.id ?? ''));
  const executionVerificationFailed = useAgentStore((s) => s.executionVerificationFailed);
  const retryExecutionVerification = useAgentStore((s) => s.retryExecutionVerification);
  const dismissVerificationFailure = useAgentStore((s) => s.dismissVerificationFailure);
  const personaId = selectedPersona?.id || '';

  const state = useRunnerState(personaId);
  const exec = useRunnerExecution({
    personaId,
    inputData: state.inputData,
    setJsonError: state.setJsonError,
    disconnect: state.disconnect,
    elapsedMs: state.elapsedMs,
    executionSummary: state.executionSummary,
    outputLines: state.outputLines,
    terminalHeight: state.terminalHeight,
    setTerminalHeight: state.setTerminalHeight,
    isTerminalFullscreen: state.isTerminalFullscreen,
    setIsTerminalFullscreen: state.setIsTerminalFullscreen as (fn: (prev: boolean) => boolean) => void,
  });

  const { t, tx } = useTranslation();

  if (!selectedPersona) {
    return <div className="flex items-center justify-center py-8 text-foreground">{t.agents.executions.no_persona_selected}</div>;
  }

  const summaryPresentation = getStatusEntry(state.executionSummary?.status ?? 'failed');

  return (
    <div ref={state.runnerRef} className="space-y-4">
      <h4 className="flex items-center gap-2.5 typo-heading text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Play className="w-3.5 h-3.5" />{t.agents.executions.run_persona}
      </h4>

      {/* Input & Execute Card */}
      <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-4 space-y-4">
        <div className="space-y-2">
          <button data-testid="runner-toggle-input" onClick={() => state.setShowInputEditor(!state.showInputEditor)} className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors">
            {state.showInputEditor ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {t.agents.executions.input_data_optional}
          </button>
          {state.showInputEditor && (
              <div className="animate-fade-slide-in">
                <KeyValueEditor value={state.inputData} onChange={(v) => { state.setInputData(v); if (state.jsonError) state.setJsonError(null); }} placeholder='{"key": "value"}' />
                {state.jsonError && <p className="text-red-400/80 typo-body mt-1">{state.jsonError}</p>}
              </div>
            )}
        </div>
        {/* Budget enforcement banner with recovery guidance */}
        {budgetStatus !== 'ok' && (
          <BudgetRecoveryCard
            budgetStatus={budgetStatus}
            budgetEntry={budgetEntry}
            isBudgetBlocked={isBudgetBlocked}
            onOverrideBudget={() => overrideBudgetPause(personaId)}
            onOverrideStale={() => overrideStaleBudget(personaId)}
          />
        )}
        {IS_MOBILE ? (
          <button
            onClick={() => { try { window.open('https://claude.ai/code', '_blank'); } catch { /* intentional no-op */ } }}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-modal typo-heading transition-all bg-gradient-to-r from-cyan-500/80 to-blue-500/80 hover:from-cyan-500 hover:to-blue-500 text-foreground shadow-elevation-3 shadow-cyan-500/20"
          >
            <Monitor className="w-5 h-5" />
            {t.agents.executions.connect_remote}
          </button>
        ) : (
          <button data-testid="execute-persona-btn" onClick={isExecuting ? exec.handleStop : exec.handleExecute}
            disabled={isBudgetBlocked}
            className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-modal typo-heading transition-all ${isBudgetBlocked ? 'bg-secondary/40 text-foreground cursor-not-allowed' : isExecuting ? 'bg-red-500/80 hover:bg-red-500 text-foreground shadow-elevation-3 shadow-red-500/20' : 'bg-gradient-to-r from-primary to-accent hover:from-primary/90 hover:to-accent/90 text-foreground shadow-elevation-3 shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'}`}>
            {isExecuting ? (<><Square className="w-5 h-5" />{t.agents.executions.stop_execution}</>) : (<>{cloudConfig?.is_connected ? <Cloud className="w-5 h-5" /> : <Play className="w-5 h-5" />}{cloudConfig?.is_connected ? t.agents.executions.execute_on_cloud : t.agents.executions.execute_persona}</>)}
          </button>
        )}
      </div>

      {/* Execution verification failure banner */}
      {executionVerificationFailed && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-modal border border-amber-500/30 bg-amber-500/10">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-sm text-amber-200/90 flex-1">
            {t.agents.executions.verification_failed}
          </span>
          <button onClick={() => void retryExecutionVerification()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-card text-xs font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 transition-colors">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
          <button onClick={dismissVerificationFailure} className="p-1 rounded hover:bg-amber-500/20 text-amber-400/60 hover:text-amber-400 transition-colors" title={t.agents.executions.dismiss_abandon}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Progress Indicator */}
      {isExecuting && state.isThisPersonasExecution && (
        <div className="animate-fade-slide-in flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-modal">
          <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
          <MiniPlayerPinButton />
          <div className="flex-1 min-w-0">
            {state.typicalDurationMs ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between typo-body">
                  <span className="text-foreground">{tx(t.agents.executions.elapsed, { elapsed: formatElapsed(state.elapsedMs) })}</span>
                  <span className="text-foreground">{state.elapsedMs < state.typicalDurationMs ? tx(t.agents.executions.typically_completes, { elapsed: formatElapsed(state.typicalDurationMs) }) : t.agents.executions.taking_longer}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                  <div className="animate-fade-in h-full rounded-full bg-primary/40" style={{ width: `${Math.min(100, (state.elapsedMs / state.typicalDurationMs) * 100)}%` }} />
                </div>
              </div>
            ) : <span className="typo-body text-foreground">{tx(t.agents.executions.elapsed, { elapsed: formatElapsed(state.elapsedMs) })}</span>}
          </div>
        </div>
      )}

      {/* Stuck Execution Guidance */}
      {isExecuting && state.isThisPersonasExecution && state.silenceLevel !== 'active' && (
        <StuckExecutionGuidance
          silenceLevel={state.silenceLevel}
          onCancel={exec.handleStop}
          executionId={activeExecutionId}
        />
      )}

      {/* Summary Card */}
      {!isExecuting && state.isThisPersonasExecution && state.executionSummary && (
        <div className={`animate-fade-slide-in rounded-modal border p-4 ${summaryPresentation.border} ${summaryPresentation.bg}`}>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2"><StatusIcon status={state.executionSummary.status} className="w-5 h-5" /><span className={`typo-heading capitalize ${summaryPresentation.text}`}>{state.executionSummary.status}</span></div>
            {state.executionSummary.duration_ms != null && <div className="flex items-center gap-1.5 text-foreground"><Timer className="w-3.5 h-3.5" /><span className="typo-code">{(state.executionSummary.duration_ms / 1000).toFixed(1)}s</span></div>}
            {state.executionSummary.cost_usd != null && <div className="flex items-center gap-1.5 text-foreground"><DollarSign className="w-3.5 h-3.5" /><span className="typo-code">${state.executionSummary.cost_usd.toFixed(4)}</span></div>}
          </div>
          {state.executionSummary.status === 'cancelled' && (
            <div className="mt-3 pt-3 border-t border-amber-500/15 space-y-3">
              {state.executionSummary.last_tool && <div className="flex items-center gap-2 typo-body text-foreground"><Wrench className="w-3.5 h-3.5 text-amber-400/60 flex-shrink-0" /><span>{t.agents.executions.stopped_while_running}</span><code className="px-1.5 py-0.5 rounded-card bg-amber-500/10 text-amber-300/80 typo-code">{state.executionSummary.last_tool}</code></div>}
              <button onClick={exec.handleResume} className="flex items-center gap-2 px-3.5 py-2 typo-heading rounded-modal bg-amber-500/10 text-amber-300 border border-amber-500/20 hover:bg-amber-500/20 hover:text-amber-200 transition-colors"><RotateCw className="w-3.5 h-3.5" />{t.agents.executions.resume_from_here}</button>
            </div>
          )}
        </div>
      )}

      {/* Healing Notification */}
      {state.healingNotification && !isExecuting && state.isThisPersonasExecution && (
          <HealingCard notification={state.healingNotification} onDismiss={() => state.setHealingNotification(null)} />
        )}

      {/* AI Self-Healing Strip */}
      {import.meta.env.DEV && state.aiHealing.phase !== 'idle' && (
        <TerminalStrip lastLine={state.aiHealing.lastLine} lines={state.aiHealing.lines} isRunning={state.aiHealing.phase === 'started' || state.aiHealing.phase === 'diagnosing' || state.aiHealing.phase === 'applying'} isExpanded={state.showHealingLog} onToggle={() => state.setShowHealingLog((v: boolean) => !v)} operation="healing_analysis" counters={<AiHealingCounters phase={state.aiHealing.phase} fixCount={state.aiHealing.fixesApplied.length} shouldRetry={state.aiHealing.shouldRetry} />} />
      )}

      {/* Empty state */}
      {!(state.isThisPersonasExecution && (isExecuting || state.outputLines.length > 0)) && (
          <div className="animate-fade-slide-in flex flex-col items-center justify-center py-16 gap-4" data-testid="runner-empty-state">
            {selectedPersona.icon ? (sanitizeIconUrl(selectedPersona.icon) ? <img src={sanitizeIconUrl(selectedPersona.icon)!} alt="" className="w-12 h-12 rounded-modal opacity-60" referrerPolicy="no-referrer" crossOrigin="anonymous" /> : isIconUrl(selectedPersona.icon) ? null : <span className="text-4xl leading-none opacity-60">{selectedPersona.icon}</span>) : (
              <div className="w-12 h-12 rounded-modal flex items-center justify-center typo-heading-lg opacity-50" style={{ backgroundColor: `${selectedPersona.color || '#6B7280'}20`, border: `1px solid ${selectedPersona.color || '#6B7280'}40`, color: selectedPersona.color || '#6B7280' }}>{selectedPersona.name.charAt(0).toUpperCase()}</div>
            )}
            <div className="text-center space-y-1.5">
              <p className="typo-heading text-foreground">{selectedPersona.name}</p>
              <p className="typo-body text-zinc-500">Ready to execute &mdash; click Run or press{' '}<kbd className="inline-flex items-center px-1.5 py-0.5 rounded border border-zinc-700 bg-zinc-800/60 text-zinc-400 typo-code">Enter</kbd></p>
            </div>
          </div>
        )}

      {/* Terminal Output */}
      {state.isThisPersonasExecution && (isExecuting || state.outputLines.length > 0) && (
        <div className="animate-fade-slide-in">
          <ExecutionTerminal lines={state.outputLines} isRunning={isExecuting} onStop={exec.handleStop} label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined} isFullscreen={state.isTerminalFullscreen} onToggleFullscreen={exec.toggleTerminalFullscreen} terminalHeight={state.terminalHeight} onResizeStart={exec.handleTerminalResizeStart} emptyState={state.terminalEmptyState}>
            {queuePosition != null && state.isThisPersonasExecution && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border/20 bg-amber-500/5"><Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" /><span className="typo-heading text-amber-300/90">Queued -- position {queuePosition + 1}{queueDepth != null ? ` of ${queueDepth}` : ''}</span></div>
            )}
            <RunnerPhaseTimeline phases={state.phases} showPhases={state.showPhases} setShowPhases={state.setShowPhases} isExecuting={isExecuting} elapsedMs={state.elapsedMs} />
          </ExecutionTerminal>
        </div>
      )}
    </div>
  );
}
