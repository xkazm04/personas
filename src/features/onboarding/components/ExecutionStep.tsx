import { useState, useEffect, useRef } from 'react';
import { tokenLabel } from '@/i18n/tokenMaps';
import {
  Play,
  Terminal,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import Button from '@/features/shared/components/buttons/Button';
import { useAgentStore } from "@/stores/agentStore";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { getExecution } from '@/api/agents/executions';
import { isTerminalState } from '@/lib/execution/executionState';

export function ExecutionStep({
  personaId,
  personaName,
  onComplete,
}: {
  personaId: string;
  personaName: string;
  onComplete: () => void;
}) {
  const { t, tx } = useTranslation();
  const executePersona = useAgentStore((s) => s.executePersona);
  const executionOutput = useAgentStore((s) => s.executionOutput);
  // The execution THIS step started. We must NOT key completion off the global
  // activeExecutionId — if an unrelated execution was already running when the
  // step mounted, its terminal event would auto-complete onboarding.
  const [startedExecId, setStartedExecId] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  // Terminal status of a run that ended without completing. Held as the raw
  // token and worded at render, so a language switch re-words it.
  const [endedStatus, setEndedStatus] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [executionOutput]);

  // Listen for execution completion.
  // Cleanup runs synchronously, but `listen()` resolves asynchronously — so
  // on rapid dismiss/reopen the listener can register *after* cleanup ran
  // and would then leak. Use a cancelled flag to immediately unlisten any
  // late-arriving registration, and guard the handler against firing into
  // an unmounted/stale component.
  useEffect(() => {
    if (!startedExecId) return;

    let cancelled = false;
    let settled = false;
    let unlisten: UnlistenFn | null = null;

    // First terminal state wins, whether it arrives as an event or from the
    // reconcile read below.
    const settle = (status: string) => {
      if (cancelled || settled || !isTerminalState(status)) return;
      settled = true;
      setFinished(true);
      if (status === 'completed') {
        onComplete();
      } else {
        setEndedStatus(status);
      }
    };

    // `execution-complete` was never emitted by anything in the tree — this
    // step waited forever on a first run. The engine's status stream is
    // `execution-status` (every transition), so completion is the first
    // TERMINAL state seen for this execution id.
    listen<{ execution_id: string; status: string }>(
      EventName.EXECUTION_STATUS,
      (event) => {
        if (event.payload.execution_id === startedExecId) settle(event.payload.status);
      },
    )
      .then((fn) => {
        if (cancelled) {
          // Effect was torn down before listen() resolved — detach now.
          fn();
          return;
        }
        unlisten = fn;
        unlistenRef.current = fn;
        // The listener attaches only after executePersona resolved AND this
        // effect ran, so a run that reached its terminal state in between
        // (a fast failure, a missing credential) emitted into nothing and the
        // step spun forever. Read the row once now that we are listening.
        getExecution(startedExecId, personaId)
          .then((row) => settle(row.status))
          .catch(silentCatch('onboarding/ExecutionStep:reconcileStatus'));
      })
      .catch(silentCatch('onboarding/ExecutionStep:listenExecutionComplete'));

    return () => {
      cancelled = true;
      unlisten?.();
      unlisten = null;
      unlistenRef.current = null;
    };
  }, [startedExecId, personaId, onComplete]);

  const handleRun = async () => {
    setStarted(true);
    setFinished(false);
    setStartedExecId(null);
    setExecutionError(null);
    setEndedStatus(null);
    const execId = await executePersona(personaId);
    if (!execId) {
      setExecutionError(t.onboarding.execution_failed);
      setStarted(false);
    } else {
      setStartedExecId(execId);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="typo-heading-lg text-foreground/90 mb-1">{t.onboarding.run_first_agent}</h3>
        <p className="typo-body text-foreground">
          {t.onboarding.execute_description.split('{name}')[0]}
          <span className="font-medium text-foreground">{personaName}</span>
          {t.onboarding.execute_description.split('{name}')[1]}
        </p>
      </div>

      {!started ? (
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-16 h-16 rounded-modal bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Play className="w-8 h-8 text-emerald-400" />
          </div>
          <p className="typo-body text-foreground text-center max-w-sm">
            {t.onboarding.agent_ready_hint}
          </p>
          <button
            type="button"
            onClick={handleRun}
            className="px-6 py-2.5 typo-heading rounded-modal bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            {t.onboarding.run_agent}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Status indicator — a live region so the executing→completed/error
              transition is announced to screen readers (UAT P6 F-A11Y-BUILD-PETALS). */}
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            {finished ? (
              executionError || endedStatus ? (
                <>
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="typo-body text-red-400">{executionError ?? tx(t.onboarding.execution_ended, { status: tokenLabel(t, 'execution', endedStatus ?? 'unknown') })}</span>
                  {/* A failed first run used to leave no control at all: Run was
                      gone and Finish only appears on success, so the only way
                      out was closing onboarding. */}
                  <Button
                    variant="accent"
                    tone="success"
                    size="sm"
                    onClick={() => void handleRun()}
                    icon={<Play className="w-3.5 h-3.5" />}
                    data-testid="onboarding-execution-retry"
                    className="ml-auto"
                  >
                    {t.onboarding.run_agent}
                  </Button>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="typo-body text-emerald-400">{t.onboarding.execution_completed}</span>
                </>
              )
            ) : (
              <>
                <LoadingSpinner className="text-violet-400" />
                <span className="typo-body text-violet-300">{t.onboarding.executing}</span>
              </>
            )}
          </div>

          {/* Terminal output */}
          <div
            ref={terminalRef}
            className="bg-black/40 rounded-modal border border-primary/10 p-4 typo-code h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent"
          >
            <div className="flex items-center gap-2 mb-2 text-foreground border-b border-primary/10 pb-2">
              <Terminal className="w-3.5 h-3.5" />
              <span className="typo-body">{t.onboarding.agent_output}</span>
            </div>
            {executionOutput.length === 0 && !finished && (
              <p className="text-foreground typo-body">{t.onboarding.waiting_for_output}</p>
            )}
            {executionOutput.map((line, i) => (
              <div key={i} className="text-foreground whitespace-pre-wrap break-all leading-relaxed">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
