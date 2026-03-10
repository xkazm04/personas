import { useState } from 'react';
import {
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronRight,
  Wrench,
  Terminal,
  Globe,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PersonaToolDefinition } from '@/lib/bindings/PersonaToolDefinition';
import type { ToolInvocationResult } from '@/api/agents/tools';

interface ToolInvocationCardProps {
  tool: PersonaToolDefinition;
  isRunning: boolean;
  result: ToolInvocationResult | null;
  error: string | null;
  onRun: (inputJson: string) => void;
}

export function ToolInvocationCard({ tool, isRunning, result, error, onRun }: ToolInvocationCardProps) {
  const [inputJson, setInputJson] = useState(() => buildDefaultInput(tool));
  const [expanded, setExpanded] = useState(false);

  const toolType = !tool.script_path ? 'api' : 'script';
  const TypeIcon = toolType === 'api' ? Globe : Terminal;

  const handleRun = () => {
    onRun(inputJson.trim() || '{}');
  };

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
        )}
        <Wrench className="w-3.5 h-3.5 text-muted-foreground/80" />
        <span className="text-sm font-medium text-foreground/80 truncate">{tool.name}</span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-sm rounded border border-primary/10 bg-secondary/30 text-muted-foreground/60">
          <TypeIcon className="w-2.5 h-2.5" />
          {toolType}
        </span>
        {result && (
          <span className={`ml-auto inline-flex items-center gap-1 text-sm ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
            {result.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            {result.duration_ms}ms
          </span>
        )}
      </button>

      {/* Expanded body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="border-t border-primary/10 px-3.5 py-3 space-y-3">
              {tool.description && (
                <p className="text-sm text-muted-foreground/60">{tool.description}</p>
              )}

              {/* Input */}
              <div>
                <label className="text-sm font-semibold text-muted-foreground/50 uppercase tracking-wider mb-1 block">
                  Input JSON
                </label>
                <textarea
                  value={inputJson}
                  onChange={(e) => setInputJson(e.target.value)}
                  rows={4}
                  className="w-full rounded-xl border border-primary/15 bg-background/60 px-3 py-2 text-sm font-mono text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:ring-1 focus:ring-violet-500/30 resize-y"
                  placeholder='{ "key": "value" }'
                />
              </div>

              {/* Run button */}
              <button
                onClick={handleRun}
                disabled={isRunning}
                className="flex items-center gap-1.5 px-4 py-1.5 text-sm font-medium rounded-xl border border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20 transition-colors disabled:opacity-40"
              >
                {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                {isRunning ? 'Running...' : 'Run'}
              </button>

              {/* Result */}
              <ResultDisplay result={result} error={error} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResultDisplay({ result, error }: { result: ToolInvocationResult | null; error: string | null }) {
  if (error) {
    return (
      <div className="rounded-xl border border-red-500/15 bg-red-500/5 px-3 py-2 text-sm text-red-400">
        <div className="flex items-center gap-1.5 mb-1">
          <XCircle className="w-3 h-3 flex-shrink-0" />
          <span className="font-medium">Error</span>
        </div>
        <pre className="text-sm font-mono whitespace-pre-wrap break-all opacity-80">{error}</pre>
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className={`rounded-xl border px-3 py-2 text-sm ${
      result.success
        ? 'border-emerald-500/15 bg-emerald-500/5'
        : 'border-red-500/15 bg-red-500/5'
    }`}>
      <div className="flex items-center gap-2 mb-1.5">
        {result.success ? (
          <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
        ) : (
          <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
        )}
        <span className={`font-medium ${result.success ? 'text-emerald-400' : 'text-red-400'}`}>
          {result.success ? 'Success' : 'Failed'}
        </span>
        <span className="ml-auto flex items-center gap-1 text-muted-foreground/50 text-sm">
          <Clock className="w-2.5 h-2.5" />
          {result.duration_ms}ms
        </span>
      </div>

      {result.output && (
        <pre className="text-sm font-mono text-foreground/70 whitespace-pre-wrap break-all max-h-64 overflow-y-auto">
          {formatOutput(result.output)}
        </pre>
      )}
      {result.error && (
        <pre className="text-sm font-mono text-red-400/80 whitespace-pre-wrap break-all mt-1">
          {result.error}
        </pre>
      )}
    </div>
  );
}

function buildDefaultInput(tool: PersonaToolDefinition): string {
  if (tool.input_schema) {
    try {
      const schema = JSON.parse(tool.input_schema);
      if (schema.properties) {
        const defaults: Record<string, string> = {};
        for (const key of Object.keys(schema.properties)) {
          defaults[key] = '';
        }
        return JSON.stringify(defaults, null, 2);
      }
    } catch { /* intentional: non-critical -- JSON parse fallback */ }
  }
  return '{}';
}

function formatOutput(output: string): string {
  try {
    return JSON.stringify(JSON.parse(output), null, 2);
  } catch {
    // intentional: non-critical -- JSON parse fallback
    return output;
  }
}
