import { RotateCw, Copy, Check, ArrowLeftRight } from 'lucide-react';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { formatTimestamp } from '@/lib/utils/formatters';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import { maskSensitiveJson } from '@/lib/utils/sanitizers/maskSensitive';
import { sanitizeErrorForDisplay } from '@/lib/utils/sanitizers/sanitizeErrorForDisplay';

interface ExecutionExpandedDetailProps {
  execution: PersonaExecution;
  isExpanded: boolean;
  showRaw: boolean;
  hasCopied: boolean;
  copiedId: string | null;
  copyToClipboard: (text: string) => void;
  setCopiedId: (id: string | null) => void;
  setRerunInputData: (data: string) => void;
  handleAutoCompareRetry: (executionId: string) => void;
}

export function ExecutionExpandedDetail({
  execution,
  isExpanded,
  showRaw,
  hasCopied,
  copiedId,
  copyToClipboard,
  setCopiedId,
  setRerunInputData,
  handleAutoCompareRetry,
}: ExecutionExpandedDetailProps) {
  const { t } = useTranslation();

  return (
    <>
      {isExpanded && (
        <div
          className="animate-fade-slide-in border-b border-primary/10 bg-secondary/20"
        >
          <div className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-4 typo-body">
              <div>
                <span className="text-muted-foreground/90 typo-code uppercase">{t.agents.executions.execution_id}</span>
                <Tooltip content={execution.id} placement="bottom">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      copyToClipboard(execution.id);
                      setCopiedId(execution.id);
                    }}
                    className="flex items-center gap-1.5 mt-0.5 text-foreground/90 hover:text-foreground/95 transition-colors group"
                  >
                    <span className="typo-code">#{execution.id.slice(0, 8)}</span>
                    {hasCopied && copiedId === execution.id ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity" />
                    )}
                  </button>
                </Tooltip>
              </div>
              <div>
                <span className="text-muted-foreground/90 typo-code uppercase">{t.agents.executions.model}</span>
                <p className="text-foreground/90 typo-body mt-0.5">{execution.model_used || t.agents.executions.model_default}</p>
              </div>
              <div>
                <span className="text-muted-foreground/90 typo-code uppercase">{t.agents.executions.input_tokens}</span>
                <p className="text-foreground/90 typo-code mt-0.5">{execution.input_tokens.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground/90 typo-code uppercase">{t.agents.executions.output_tokens}</span>
                <p className="text-foreground/90 typo-code mt-0.5">{execution.output_tokens.toLocaleString()}</p>
              </div>
              <div>
                <span className="text-muted-foreground/90 typo-code uppercase">{t.agents.executions.cost}</span>
                <p className="text-foreground/90 typo-code mt-0.5">${execution.cost_usd.toFixed(4)}</p>
              </div>
              <div>
                <span className="text-muted-foreground/90 typo-code uppercase">{t.agents.executions.completed}</span>
                <p className="text-foreground/90 typo-body mt-0.5">{formatTimestamp(execution.completed_at)}</p>
              </div>
            </div>
            {execution.input_data && (
              <div>
                <span className="text-muted-foreground/90 typo-code uppercase">{t.agents.executions.input_data}</span>
                <pre className="mt-1 p-2 bg-background/50 border border-primary/10 rounded-lg typo-code text-foreground/80 overflow-x-auto">
                  {showRaw ? execution.input_data : maskSensitiveJson(execution.input_data)}
                </pre>
              </div>
            )}
            {execution.error_message && (
              <div>
                <span className="text-red-400/70 typo-code uppercase">{t.agents.executions.error}</span>
                <p className="mt-1 typo-body text-red-400/80">{showRaw ? execution.error_message : sanitizeErrorForDisplay(execution.error_message, 'execution-expanded')}</p>
              </div>
            )}
            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRerunInputData(execution.input_data || '{}');
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-xl bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 hover:text-primary transition-colors"
              >
                <RotateCw className="w-3 h-3" />
                {t.agents.executions.rerun_with_same_input}
              </button>
              {execution.retry_count > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleAutoCompareRetry(execution.id);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 typo-heading rounded-xl bg-cyan-500/10 text-cyan-400/80 border border-cyan-500/15 hover:bg-cyan-500/20 hover:text-cyan-400 transition-colors"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  {t.agents.executions.compare_with_original}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
