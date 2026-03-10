import { motion } from 'framer-motion';
import { Bug, ChevronDown, X } from 'lucide-react';
import type { DryRunNodeData } from '../../libs/debuggerTypes';

interface DebuggerVariablesProps {
  inspectedData: DryRunNodeData;
  agentName: string;
  onCollapse: () => void;
  onClose: () => void;
}

export default function DebuggerVariables({
  inspectedData,
  agentName,
  onCollapse,
  onClose,
}: DebuggerVariablesProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className="mx-4 mb-2 rounded-xl bg-secondary/90 backdrop-blur-md border border-primary/15 shadow-2xl overflow-hidden max-h-[280px]"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <div className="flex items-center gap-2">
          <Bug className="w-3.5 h-3.5 text-amber-400" />
          <span className="text-sm font-semibold text-foreground/90">
            {agentName}
          </span>
          <span className={`px-1.5 py-0.5 text-sm font-mono rounded-lg ${
            inspectedData.status === 'completed' ? 'bg-emerald-500/15 text-emerald-400' :
            inspectedData.status === 'running' ? 'bg-blue-500/15 text-blue-400' :
            'bg-secondary/40 text-muted-foreground'
          }`}>
            {inspectedData.status}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onCollapse}
            className="p-1 rounded-lg hover:bg-primary/10 text-muted-foreground/80 hover:text-foreground/80 transition-colors"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-primary/10 text-muted-foreground/80 hover:text-foreground/80 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-0 divide-x divide-primary/10 overflow-y-auto max-h-[230px]">
        {/* Input */}
        <div className="p-3">
          <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5">Input</div>
          {inspectedData.input ? (
            <pre className="text-sm text-foreground/80 font-mono leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(inspectedData.input, null, 2)}
            </pre>
          ) : (
            <span className="text-sm text-muted-foreground/50 italic">No input data</span>
          )}
        </div>
        {/* Output */}
        <div className="p-3">
          <div className="text-sm font-mono uppercase tracking-wider text-muted-foreground/60 mb-1.5">Output</div>
          {inspectedData.output ? (
            <pre className="text-sm text-foreground/80 font-mono leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(inspectedData.output, null, 2)}
            </pre>
          ) : (
            <span className="text-sm text-muted-foreground/50 italic">Awaiting execution</span>
          )}
        </div>
      </div>
    </motion.div>
  );
}
