import { useState } from 'react';
import { Timer, DollarSign, Wrench, FileText, ChevronDown, ChevronRight, Coins } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { getStatusEntry } from '@/lib/utils/formatters';
import { STATUS_PALETTE, STATUS_PALETTE_EXTENDED } from '@/lib/design/statusTokens';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { StatusIcon } from '../../runnerTypes';
import { CancelledResumeFooter } from '../../components/CancelledResumeFooter';

// Semantic marker colors for tool-call / file-change rows, sourced from the
// status token map rather than raw green/orange/blue literals.
const SUCCESS_TEXT = STATUS_PALETTE.success.text; // tool-call invoked
const INFO_TEXT = STATUS_PALETTE.info.text;       // file read
const CAUTION_TEXT = STATUS_PALETTE_EXTENDED.caution.text; // file modified
import type { ExecutionSummary, ToolCallSummary, FileChangeSummary } from '@/hooks/execution/useExecutionSummary';

interface ExecutionSummaryCardProps {
  summary: ExecutionSummary;
  compact?: boolean;
  onResume?: () => void;
}

function ToolCallList({ toolCalls, uniqueTools }: { toolCalls: ToolCallSummary[]; uniqueTools: string[] }) {
  const [expanded, setExpanded] = useState(false);
  const { t, tx } = useTranslation();
  const e = t.agents.executions;

  if (toolCalls.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Wrench className="w-3 h-3" />
        <span>{tx(toolCalls.length === 1 ? e.tool_calls_count : e.tool_calls_count_other, { count: toolCalls.length })}</span>
        <span className="text-foreground">
          {tx(e.unique_tools_count, { count: uniqueTools.length })}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 space-y-1 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/15">
          {toolCalls.map((tc, i) => (
            <div key={i} className="flex items-start gap-2 typo-caption">
              <span className={`${SUCCESS_TEXT} shrink-0`}>{'\u25B6'}</span>
              <span className="font-medium shrink-0">{tc.name}</span>
              <span className="text-foreground truncate">{tc.inputPreview}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FileChangeList({ fileChanges, writeCount, readCount }: { fileChanges: FileChangeSummary[]; writeCount: number; readCount: number }) {
  const [expanded, setExpanded] = useState(false);

  if (fileChanges.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 typo-caption text-foreground hover:text-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <FileText className="w-3 h-3" />
        <span>{fileChanges.length} file{fileChanges.length !== 1 ? 's' : ''}</span>
        {writeCount > 0 && (
          <span className={CAUTION_TEXT}>{writeCount} modified</span>
        )}
        {readCount > 0 && (
          <span className={INFO_TEXT}>{readCount} read</span>
        )}
      </button>
      {expanded && (
        <div className="mt-1.5 ml-4 space-y-0.5 max-h-24 overflow-y-auto scrollbar-thin scrollbar-thumb-primary/15">
          {fileChanges.map((fc, i) => (
            <div key={i} className="flex items-center gap-2 typo-caption">
              <span className={fc.changeType === 'read' ? INFO_TEXT : CAUTION_TEXT}>{'\u25CF'}</span>
              <span className="text-foreground truncate">{fc.path.split('/').pop()}</span>
              <span className="text-foreground capitalize typo-caption">{fc.changeType}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ExecutionSummaryCard({ summary, compact, onResume }: ExecutionSummaryCardProps) {
  const presentation = getStatusEntry(summary.status);

  return (
    <div
      className={`animate-fade-slide-in rounded-modal border ${compact ? 'p-2.5' : 'p-4'} ${presentation.border} ${presentation.bg}`}
    >
      {/* Status row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <StatusIcon status={summary.status} className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
          <span className={`${compact ? 'typo-body font-medium' : 'typo-heading'} capitalize ${presentation.text}`}>
            {summary.status}
          </span>
        </div>

        {summary.durationMs != null && (
          <div className="flex items-center gap-1 text-foreground">
            <Timer className="w-3 h-3" />
            <Numeric value={summary.durationMs} unit="ms" className="typo-code" />
          </div>
        )}

        {summary.costUsd != null && (
          <div className="flex items-center gap-1 text-foreground">
            <DollarSign className="w-3 h-3" />
            <Numeric value={summary.costUsd} unit="usd" precision={4} className="typo-code" />
          </div>
        )}

        {summary.totalTokens != null && (
          <div className="flex items-center gap-1 text-foreground">
            <Coins className="w-3 h-3" />
            <span className="typo-code"><Numeric value={summary.totalTokens} /> tokens</span>
          </div>
        )}
      </div>

      {/* Model badge */}
      {summary.model && (
        <div className="mt-1.5">
          <span className="inline-block px-2 py-0.5 rounded-input bg-secondary/40 typo-caption text-foreground">
            {summary.model}
          </span>
        </div>
      )}

      {/* Tool calls expandable section */}
      <ToolCallList toolCalls={summary.toolCalls} uniqueTools={summary.uniqueTools} />

      {/* File changes expandable section */}
      <FileChangeList fileChanges={summary.fileChanges} writeCount={summary.fileWriteCount} readCount={summary.fileReadCount} />

      {/* Cancelled-specific: last tool + resume */}
      {summary.status === 'cancelled' && onResume && (
        <CancelledResumeFooter
          lastTool={summary.toolCalls.length > 0 ? summary.toolCalls[summary.toolCalls.length - 1]?.name : undefined}
          onResume={onResume}
        />
      )}
    </div>
  );
}
