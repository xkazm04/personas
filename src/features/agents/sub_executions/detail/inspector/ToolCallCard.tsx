import { useState } from 'react';
import { Wrench, Clock, ChevronDown, ChevronRight, Hash } from 'lucide-react';
import { formatDuration } from '@/lib/utils/formatters';
import type { ToolCallStep } from './inspectorTypes';
import { durationColor } from './inspectorTypes';
import { useTranslation } from '@/i18n/useTranslation';

export function ToolCallCard({ step }: { step: ToolCallStep }) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const [showInput, setShowInput] = useState(false);
  const [showOutput, setShowOutput] = useState(false);

  return (
    <div className="rounded-modal border border-primary/20 bg-secondary/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="w-7 h-7 rounded-card bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
          <Hash className="w-3.5 h-3.5 text-primary/70" />
        </div>
        <span className="typo-code text-muted-foreground/90">{step.step_index + 1}</span>

        <div className="flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-muted-foreground/90" />
          <span className="typo-code font-medium text-foreground/90">{step.tool_name}</span>
        </div>

        <div className="ml-auto">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-card typo-code border ${durationColor(step.duration_ms)}`}>
            <Clock className="w-3 h-3" />
            {step.duration_ms != null ? formatDuration(step.duration_ms) : e.pending}
          </span>
        </div>
      </div>

      {/* Collapsible Input */}
      {step.input_preview && (
        <div className="border-t border-primary/10">
          <button
            onClick={() => setShowInput(!showInput)}
            className="flex items-center gap-2 w-full px-4 py-2 typo-body text-muted-foreground/90 hover:text-foreground/95 transition-colors"
          >
            {showInput ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {e.input}
          </button>
          {showInput && (
              <div className="animate-fade-slide-in"
              >
                <pre className="px-4 pb-3 typo-code text-foreground/90 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {step.input_preview}
                </pre>
              </div>
            )}
        </div>
      )}

      {/* Collapsible Output */}
      {step.output_preview && (
        <div className="border-t border-primary/10">
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="flex items-center gap-2 w-full px-4 py-2 typo-body text-muted-foreground/90 hover:text-foreground/95 transition-colors"
          >
            {showOutput ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            {e.output}
          </button>
          {showOutput && (
              <div className="animate-fade-slide-in"
              >
                <pre className="px-4 pb-3 typo-code text-foreground/90 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                  {step.output_preview}
                </pre>
              </div>
            )}
        </div>
      )}
    </div>
  );
}
