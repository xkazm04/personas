import { useState, useEffect } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { useCloudStore } from '@/stores/cloudStore';
import { usePersonaExecution } from '@/hooks/usePersonaExecution';
import { Play, Square, ChevronDown, ChevronRight, Cloud } from 'lucide-react';
import { TerminalHeader } from '@/features/shared/components/TerminalHeader';
import { classifyLine, TERMINAL_STYLE_MAP } from '@/lib/utils/terminalColors';
import { motion, AnimatePresence } from 'framer-motion';

export function PersonaRunner() {
  const selectedPersona = usePersonaStore((state) => state.selectedPersona);
  const executePersona = usePersonaStore((state) => state.executePersona);
  const cancelExecution = usePersonaStore((state) => state.cancelExecution);
  const isExecuting = usePersonaStore((state) => state.isExecuting);
  const activeExecutionId = usePersonaStore((state) => state.activeExecutionId);
  const executionOutput = usePersonaStore((state) => state.executionOutput);

  const cloudConfig = useCloudStore((s) => s.config);
  const cloudExecute = useCloudStore((s) => s.cloudExecute);

  const { disconnect } = usePersonaExecution();

  const [inputData, setInputData] = useState('{}');
  const [showInputEditor, setShowInputEditor] = useState(false);
  const [outputLines, setOutputLines] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const personaId = selectedPersona?.id || '';

  // Sync store output to local lines
  useEffect(() => {
    if (executionOutput.length > 0) {
      setOutputLines(executionOutput);
    }
  }, [executionOutput]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

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

    let executionId: string | null = null;
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
      disconnect();
      cancelExecution(activeExecutionId);
      setOutputLines((prev) => [...prev, '', '=== Execution cancelled ===']);
    }
  };

  const handleCopyLog = () => {
    navigator.clipboard.writeText(outputLines.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-5">
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

            {/* Terminal body */}
            <div className="p-4 max-h-[400px] overflow-y-auto font-mono text-xs space-y-0.5">
              {outputLines.map((line, i) => {
                if (!line.trim()) return <div key={i} className="h-2" />;
                const style = classifyLine(line);
                return (
                  <div key={i} className={`leading-5 whitespace-pre-wrap break-all ${TERMINAL_STYLE_MAP[style]}`}>
                    {line}
                  </div>
                );
              })}
              {isExecuting && (
                <div className="text-muted-foreground/30 animate-pulse">{'>'} _</div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
