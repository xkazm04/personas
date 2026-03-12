import { useState } from 'react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { RotateCw, Copy, Check, ArrowLeftRight } from 'lucide-react';
import { formatTimestamp } from '@/lib/utils/formatters';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { maskSensitiveJson, sanitizeErrorMessage } from '@/lib/utils/sanitizers/maskSensitive';

interface ExecutionRowExpandedProps {
  execution: PersonaExecution;
  showRaw: boolean;
  onRerun: (inputData: string) => void;
  onAutoCompareRetry: (id: string) => void;
}

export function ExecutionRowExpanded({
  execution,
  showRaw,
  onRerun,
  onAutoCompareRetry,
}: ExecutionRowExpandedProps) {
  const { copied: hasCopied, copy: copyToClipboard } = useCopyToClipboard();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground/90 text-sm font-mono uppercase">Execution ID</span>
          <Tooltip content={execution.id} placement="bottom">
            <button
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(execution.id);
                setCopiedId(execution.id);
              }}
              className="flex items-center gap-1.5 mt-0.5 text-foreground/90 hover:text-foreground/95 transition-colors group"
            >
              <span className="font-mono text-sm">#{execution.id.slice(0, 8)}</span>
              {hasCopied && copiedId === execution.id ? (
                <Check className="w-3 h-3 text-emerald-400" />
              ) : (
                <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
              )}
            </button>
          </Tooltip>
        </div>
        <div>
          <span className="text-muted-foreground/90 text-sm font-mono uppercase">Model</span>
          <p className="text-foreground/90 text-sm mt-0.5">{execution.model_used || 'default'}</p>
        </div>
        <div>
          <span className="text-muted-foreground/90 text-sm font-mono uppercase">Input Tokens</span>
          <p className="text-foreground/90 font-mono text-sm mt-0.5">{execution.input_tokens.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-muted-foreground/90 text-sm font-mono uppercase">Output Tokens</span>
          <p className="text-foreground/90 font-mono text-sm mt-0.5">{execution.output_tokens.toLocaleString()}</p>
        </div>
        <div>
          <span className="text-muted-foreground/90 text-sm font-mono uppercase">Cost</span>
          <p className="text-foreground/90 font-mono text-sm mt-0.5">${execution.cost_usd.toFixed(4)}</p>
        </div>
        <div>
          <span className="text-muted-foreground/90 text-sm font-mono uppercase">Completed</span>
          <p className="text-foreground/90 text-sm mt-0.5">{formatTimestamp(execution.completed_at)}</p>
        </div>
      </div>
      {execution.input_data && (
        <div>
          <span className="text-muted-foreground/90 text-sm font-mono uppercase">Input Data</span>
          <pre className="mt-1 p-2 bg-background/50 border border-primary/10 rounded-lg text-sm text-foreground/80 font-mono overflow-x-auto">
            {showRaw ? execution.input_data : maskSensitiveJson(execution.input_data)}
          </pre>
        </div>
      )}
      {execution.error_message && (
        <div>
          <span className="text-red-400/70 text-sm font-mono uppercase">Error</span>
          <p className="mt-1 text-sm text-red-400/80">{showRaw ? execution.error_message : sanitizeErrorMessage(execution.error_message)}</p>
        </div>
      )}
      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRerun(execution.input_data || '{}');
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors"
        >
          <RotateCw className="w-3 h-3" />
          Re-run with same input
        </button>
        {execution.retry_count > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAutoCompareRetry(execution.id);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors"
          >
            <ArrowLeftRight className="w-3 h-3" />
            Compare with original
          </button>
        )}
      </div>
    </div>
  );
}
