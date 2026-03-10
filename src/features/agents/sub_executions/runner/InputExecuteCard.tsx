import { Play, Square, ChevronDown, ChevronRight, Cloud } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { JsonEditor } from '@/features/shared/components/editors/JsonEditor';

interface InputExecuteCardProps {
  inputData: string;
  onInputChange: (v: string) => void;
  showInputEditor: boolean;
  onToggleInputEditor: () => void;
  jsonError: string | null;
  onClearJsonError: () => void;
  isExecuting: boolean;
  isCloudConnected: boolean;
  onExecute: () => void;
  onStop: () => void;
}

export function InputExecuteCard({
  inputData,
  onInputChange,
  showInputEditor,
  onToggleInputEditor,
  jsonError,
  onClearJsonError,
  isExecuting,
  isCloudConnected,
  onExecute,
  onStop,
}: InputExecuteCardProps) {
  return (
    <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-4 space-y-4">
      {/* Input Data Section */}
      <div className="space-y-2">
        <button
          onClick={onToggleInputEditor}
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
                  onInputChange(v);
                  if (jsonError) onClearJsonError();
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
        onClick={isExecuting ? onStop : onExecute}
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
            {isCloudConnected ? <Cloud className="w-5 h-5" /> : <Play className="w-5 h-5" />}
            {isCloudConnected ? 'Execute on Cloud' : 'Execute Persona'}
          </>
        )}
      </button>
    </div>
  );
}
