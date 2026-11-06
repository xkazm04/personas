import { EngineCapabilityBadge } from '@/features/settings/sub_engine/components/EngineCapabilityBadge';
import { useSystemStore } from "@/stores/systemStore";
import { useAgentStore } from "@/stores/agentStore";
import { sanitizeIconUrl, isIconUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import { Play, Square, ChevronDown, ChevronRight, Cloud, Clock, Timer, DollarSign, Monitor, AlertTriangle, RefreshCw, X, FlaskConical } from 'lucide-react';
import { BudgetRecoveryCard } from './BudgetRecoveryCard';
import { useTranslation } from '@/i18n/useTranslation';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { formatElapsed, getStatusEntry } from '@/lib/utils/formatters';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { KeyValueEditor } from '@/features/shared/components/forms/KeyValueEditor';
import { ExecutionTerminal } from './ExecutionTerminal';
import { useRunnerState } from '../../libs/useRunnerState';
import { useRunnerExecution } from '../../libs/useRunnerExecution';
import { useDryRun } from '../../libs/useDryRun';
import { DryRunModal } from './DryRunModal';
import { MiniPlayerPinButton, StatusIcon } from './RunnerHeader';
import { HealingCard, AiHealingCounters } from './HealingCard';
import { RunnerPhaseTimeline } from './RunnerPhaseTimeline';
import { StuckExecutionGuidance } from './StuckExecutionGuidance';
import { CancelledResumeFooter } from '../CancelledResumeFooter';
import { silentCatch } from '@/lib/silentCatch';
import { debtText } from '@/i18n/DebtText';
import { Kbd } from '@/features/shared/components/display/Kbd';



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
  const dryRun = useDryRun({
    personaId,
    getInputData: () => state.inputData,
  });
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
    return <div className="flex items-center justify-center py-8 text-ink-1">{t.agents.executions.no_persona_selected}</div>;
  }

  const summaryPresentation = getStatusEntry(state.executionSummary?.status ?? 'failed');
  // Once elapsed crosses the typical (median) duration the determinate fill is
  // pinned at 100% and stops conveying anything — switch to an amber indeterminate
  // sweep so "running long" is felt, not just read.
  const isOverBudget = state.typicalDurationMs != null && state.elapsedMs >= state.typicalDurationMs;

  return (
    <div ref={state.runnerRef} className="space-y-4">
      <h4 className="flex items-center gap-2.5 typo-heading text-ink-1">
        <span className="w-6 h-[2px] bg-surface-1 rounded-full" />
        <Play className="w-3.5 h-3.5" />{t.agents.executions.run_persona}
      </h4>

      {/* Input & Execute Card */}
      <div className="bg-surface-2 backdrop-blur-sm border border-hair rounded-modal p-4 space-y-4">
        <div className="space-y-2">
          <button type="button" data-testid="runner-toggle-input" onClick={() => state.setShowInputEditor(!state.showInputEditor)} className="flex items-center gap-2 typo-body text-ink-1 hover:text-ink-1 transition-colors">
            {state.showInputEditor ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            {t.agents.executions.input_data_optional}
          </button>
          {state.showInputEditor && (
              <div className="animate-fade-slide-in">
                <KeyValueEditor value={state.inputData} onChange={(v) => { state.setInputData(v); if (state.jsonError) state.setJsonError(null); }} placeholder={debtText("auto_key_value_e735dd8e")} />
                {state.jsonError && <p className="text-status-error typo-body mt-1">{state.jsonError}</p>}
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
            type="button"
            onClick={() => { try { window.open('https://claude.ai/code', '_blank'); } catch (err) { silentCatch("features/agents/sub_executions/components/runner/PersonaRunner:catch1")(err); } }}
            className="w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-modal typo-heading transition-all bg-surface-1 hover:from-cyan-500 hover:to-blue-500 text-ink-1 shadow-elevation-3 shadow-cyan-500/20"
          >
            <Monitor className="w-5 h-5" />
            {t.agents.executions.connect_remote}
          </button>
        ) : (
          <button type="button" data-testid="execute-persona-btn" onClick={isExecuting ? exec.handleStop : exec.handleExecute}
            disabled={isBudgetBlocked}
            className={`w-full flex items-center justify-center gap-2.5 px-6 py-3.5 rounded-modal typo-heading transition-all ${isBudgetBlocked ? 'bg-surface-2 text-ink-1 cursor-not-allowed' : isExecuting ? 'bg-status-error/80 hover:bg-status-error text-ink-1 shadow-elevation-3 shadow-red-500/20' : 'bg-surface-1 hover:from-primary/90 hover:to-accent/90 text-ink-1 shadow-elevation-3 shadow-primary/20 hover:shadow-primary/30 hover:scale-[1.01] active:scale-[0.99]'}`}>
            {isExecuting ? (<><Square className="w-5 h-5" />{t.agents.executions.stop_execution}</>) : (<>{cloudConfig?.is_connected ? <Cloud className="w-5 h-5" /> : <Play className="w-5 h-5" />}{cloudConfig?.is_connected ? t.agents.executions.execute_on_cloud : t.agents.executions.execute_persona}</>)}
          </button>
        )}
        {!IS_MOBILE && (
          <button
            type="button"
            data-testid="dry-run-persona-btn"
            onClick={dryRun.run}
            disabled={isExecuting || dryRun.loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-modal typo-body transition-colors border border-hair bg-surface-1 text-ink-1 hover:bg-surface-2 hover:text-ink-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title={t.agents.executions.dry_run.button_hint}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            {dryRun.loading ? t.agents.executions.dry_run.button_running : t.agents.executions.dry_run.button_label}
          </button>
        )}
      </div>
      <DryRunModal open={dryRun.open} loading={dryRun.loading} report={dryRun.report} errorMessage={dryRun.errorMessage} onClose={dryRun.close} />

      {/* Execution verification failure banner */}
      {executionVerificationFailed && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-modal border border-status-warning/30 bg-status-warning/10">
          <AlertTriangle className="w-4 h-4 text-status-warning shrink-0" />
          <span className="typo-body text-status-warning flex-1">
            {t.agents.executions.verification_failed}
          </span>
          <button type="button" onClick={() => void retryExecutionVerification()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption bg-status-warning/20 hover:bg-status-warning/30 text-status-warning transition-colors">
            <RefreshCw className="w-3 h-3" /> Retry
          </button>
          <button type="button" onClick={dismissVerificationFailure} className="p-1 rounded-interactive hover:bg-status-warning/20 text-status-warning hover:text-status-warning transition-colors" title={t.agents.executions.dismiss_abandon}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Progress Indicator */}
      {isExecuting && state.isThisPersonasExecution && (
        <div className="animate-fade-slide-in flex items-center gap-3 px-4 py-2.5 bg-surface-1 border border-hair rounded-modal">
          <Clock className="w-3.5 h-3.5 text-primary/50 flex-shrink-0" />
          <MiniPlayerPinButton />
          <div className="flex-1 min-w-0">
            {state.typicalDurationMs ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between typo-body">
                  <span className={isOverBudget ? 'text-status-warning' : 'text-ink-1'}>{tx(t.agents.executions.elapsed, { elapsed: formatElapsed(state.elapsedMs) })}</span>
                  <span className={isOverBudget ? 'text-status-warning' : 'text-ink-1'}>{state.elapsedMs < state.typicalDurationMs ? tx(t.agents.executions.typically_completes, { elapsed: formatElapsed(state.typicalDurationMs) }) : t.agents.executions.taking_longer}</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-surface-2 overflow-hidden">
                  {isOverBudget ? (
                    <div className="relative h-full w-full overflow-hidden rounded-full bg-status-warning/50">
                      <span className="animate-stage-shimmer pointer-events-none absolute inset-0 bg-surface-1" />
                    </div>
                  ) : (
                    <div className="animate-fade-in h-full rounded-full bg-primary/40" style={{ width: `${Math.min(100, (state.elapsedMs / state.typicalDurationMs) * 100)}%` }} />
                  )}
                </div>
              </div>
            ) : <span className="typo-body text-ink-1">{tx(t.agents.executions.elapsed, { elapsed: formatElapsed(state.elapsedMs) })}</span>}
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
            {state.executionSummary.duration_ms != null && <div className="flex items-center gap-1.5 text-ink-1"><Timer className="w-3.5 h-3.5" /><span className="typo-code"><Numeric value={state.executionSummary.duration_ms / 1000} precision={1} />s</span></div>}
            {state.executionSummary.cost_usd != null && <div className="flex items-center gap-1.5 text-ink-1"><DollarSign className="w-3.5 h-3.5" /><span className="typo-code">$<Numeric value={state.executionSummary.cost_usd} precision={4} /></span></div>}
          </div>
          {state.executionSummary.status === 'cancelled' && (
            <CancelledResumeFooter lastTool={state.executionSummary.last_tool} onResume={exec.handleResume} />
          )}
        </div>
      )}

      {/* Healing Notification */}
      {state.healingNotification && !isExecuting && state.isThisPersonasExecution && (
          <HealingCard notification={state.healingNotification} onDismiss={() => state.setHealingNotification(null)} />
        )}

      {/* AI Self-Healing Strip */}
      {import.meta.env.DEV && state.aiHealing.phase !== 'idle' && (
        <TerminalStrip lastLine={state.aiHealing.lastLine} lines={state.aiHealing.lines} isRunning={state.aiHealing.phase === 'started' || state.aiHealing.phase === 'diagnosing' || state.aiHealing.phase === 'applying'} isExpanded={state.showHealingLog} onToggle={() => state.setShowHealingLog((v: boolean) => !v)} capabilityBadge={<EngineCapabilityBadge operation="healing_analysis" compact />} counters={<AiHealingCounters phase={state.aiHealing.phase} fixCount={state.aiHealing.fixesApplied.length} shouldRetry={state.aiHealing.shouldRetry} />} />
      )}

      {/* Empty state */}
      {!(state.isThisPersonasExecution && (isExecuting || state.outputLines.length > 0)) && (
          <div className="animate-fade-slide-in flex flex-col items-center justify-center py-16 gap-4" data-testid="runner-empty-state">
            {selectedPersona.icon ? (sanitizeIconUrl(selectedPersona.icon) ? <img src={sanitizeIconUrl(selectedPersona.icon)!} alt="" className="w-12 h-12 rounded-modal opacity-60" referrerPolicy="no-referrer" crossOrigin="anonymous" /> : isIconUrl(selectedPersona.icon) ? null : <span className="typo-hero opacity-60">{selectedPersona.icon}</span>) : (
              <div className="w-12 h-12 rounded-modal flex items-center justify-center typo-heading-lg opacity-50" style={{ backgroundColor: `${selectedPersona.color || '#6B7280'}20`, border: `1px solid ${selectedPersona.color || '#6B7280'}40`, color: selectedPersona.color || '#6B7280' }}>{selectedPersona.name.charAt(0).toUpperCase()}</div>
            )}
            <div className="text-center space-y-1.5">
              <p className="typo-heading text-ink-1">{selectedPersona.name}</p>
              <p className="typo-body text-ink-3">{t.agents.executions.ready_to_execute}{' '}<Kbd>Enter</Kbd></p>
            </div>
          </div>
        )}

      {/* Terminal Output */}
      {state.isThisPersonasExecution && (isExecuting || state.outputLines.length > 0) && (
        <div className="animate-fade-slide-in">
          <ExecutionTerminal lines={state.outputLines} isRunning={isExecuting} onStop={exec.handleStop} label={activeExecutionId ? `exec:${activeExecutionId.slice(0, 8)}` : undefined} isFullscreen={state.isTerminalFullscreen} onToggleFullscreen={exec.toggleTerminalFullscreen} terminalHeight={state.terminalHeight} onResizeStart={exec.handleTerminalResizeStart} emptyState={state.terminalEmptyState}>
            {queuePosition != null && state.isThisPersonasExecution && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-hair bg-status-warning/5"><Clock className="w-3.5 h-3.5 text-status-warning" /><span className="typo-heading text-status-warning">{queueDepth != null ? tx(t.agents.executions.queued_position_of, { position: String(queuePosition + 1), depth: String(queueDepth) }) : tx(t.agents.executions.queued_position, { position: String(queuePosition + 1) })}</span></div>
            )}
            <RunnerPhaseTimeline phases={state.phases} showPhases={state.showPhases} setShowPhases={state.setShowPhases} isExecuting={isExecuting} elapsedMs={state.elapsedMs} />
          </ExecutionTerminal>
        </div>
      )}
    </div>
  );
}
