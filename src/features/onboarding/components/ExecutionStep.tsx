import { useState, useEffect, useRef } from 'react';
import {
  Play,
  Loader2,
  Terminal,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useAgentStore } from "@/stores/agentStore";
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export function ExecutionStep({
  personaId,
  personaName,
  onComplete,
}: {
  personaId: string;
  personaName: string;
  onComplete: () => void;
}) {
  const executePersona = useAgentStore((s) => s.executePersona);
  const executionOutput = useAgentStore((s) => s.executionOutput);
  const activeExecutionId = useAgentStore((s) => s.activeExecutionId);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [executionOutput]);

  // Listen for execution completion
  useEffect(() => {
    if (!activeExecutionId) return;

    let unlisten: UnlistenFn | null = null;
    listen<{ execution_id: string; status: string }>(
      'execution-complete',
      (event) => {
        if (event.payload.execution_id === activeExecutionId) {
          setFinished(true);
          if (event.payload.status === 'completed') {
            onComplete();
          } else {
            setExecutionError(`Execution ${event.payload.status}`);
          }
        }
      },
    ).then((fn) => {
      unlisten = fn;
      unlistenRef.current = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [activeExecutionId, onComplete]);

  const handleRun = async () => {
    setStarted(true);
    setExecutionError(null);
    const execId = await executePersona(personaId);
    if (!execId) {
      setExecutionError('Failed to start execution');
      setStarted(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold text-foreground/90 mb-1">Run your first agent</h3>
        <p className="text-sm text-muted-foreground/70">
          Execute <span className="font-medium text-foreground/80">{personaName}</span> and see real-time output.
        </p>
      </div>

      {!started ? (
        <div className="flex flex-col items-center py-8 gap-4">
          <div className="w-16 h-16 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
            <Play className="w-8 h-8 text-emerald-400" />
          </div>
          <p className="text-sm text-muted-foreground/70 text-center max-w-sm">
            Your agent is ready. Click below to start the first execution and see it in action.
          </p>
          <button
            onClick={handleRun}
            className="px-6 py-2.5 text-sm font-medium rounded-xl bg-emerald-500/15 text-emerald-300 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors flex items-center gap-2"
          >
            <Play className="w-4 h-4" />
            Run Agent
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Status indicator */}
          <div className="flex items-center gap-2">
            {finished ? (
              executionError ? (
                <>
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-sm text-red-400">{executionError}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-emerald-400">Execution completed successfully</span>
                </>
              )
            ) : (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-violet-400" />
                <span className="text-sm text-violet-300">Executing...</span>
              </>
            )}
          </div>

          {/* Terminal output */}
          <div
            ref={terminalRef}
            className="bg-black/40 rounded-xl border border-primary/10 p-4 font-mono text-sm h-64 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/15 scrollbar-track-transparent"
          >
            <div className="flex items-center gap-2 mb-2 text-muted-foreground/50 border-b border-primary/10 pb-2">
              <Terminal className="w-3.5 h-3.5" />
              <span className="text-sm">Agent Output</span>
            </div>
            {executionOutput.length === 0 && !finished && (
              <p className="text-muted-foreground/60 text-sm">Waiting for output...</p>
            )}
            {executionOutput.map((line, i) => (
              <div key={i} className="text-foreground/70 whitespace-pre-wrap break-all leading-relaxed">
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
