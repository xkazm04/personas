/**
 * commandCenterParts — shared test/promotion UI for the build flow.
 *
 * Extracted from the retired MatrixCommandCenterParts so the surviving
 * consumers (ChronologyCommandHub, GlyphFullLayout, GlyphPrototypeLayout)
 * don't reach into `gallery/matrix/`.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2, XCircle, AlertTriangle, FileText, RotateCcw, Trash2, Eye,
} from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import type { ToolTestResult } from '@/lib/types/buildTypes';
import { useAgentStore } from '@/stores/agentStore';
import { TestReportModal } from './TestReportModal';

export function BuildStatusIndicator({ phaseLabel, hint }: { phaseLabel: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-primary/20 animate-pulse" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-primary/15 via-primary/8 to-accent/10" />
        <LoadingSpinner size="lg" className="text-primary relative z-10" />
      </div>
      <span className="typo-body text-foreground font-medium">{phaseLabel}</span>
      {hint && <p className="typo-caption text-foreground text-center leading-relaxed">{hint}</p>}
    </div>
  );
}

export function CliOutputStream({ lines }: { lines: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length]);
  if (lines.length === 0) return null;
  return (
    <div ref={containerRef} className="w-full max-h-28 overflow-y-auto rounded-card bg-black/20 border border-primary/10 px-2 py-1.5 font-mono text-[11px] text-foreground leading-relaxed">
      {lines.slice(-30).map((line, i) => (
        <div key={i} className="truncate">{line}</div>
      ))}
    </div>
  );
}

export function TestRunningIndicator({ testOutputLines = [], onCancelTest }: { testOutputLines?: string[]; onCancelTest?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-3 py-2 w-full">
      <BuildStatusIndicator phaseLabel="Testing agent..." />
      <p className="typo-caption text-foreground text-center leading-relaxed max-w-xs">
        {t.templates.matrix_variants.testing_background_hint}
      </p>
      {testOutputLines.length > 0 && (
        <CliOutputStream lines={testOutputLines} />
      )}
      {onCancelTest && (
        <button
          type="button"
          onClick={onCancelTest}
          className="typo-caption text-foreground hover:text-muted-foreground/70 transition-colors"
        >
          {t.templates.matrix_variants.cancel_test}
        </button>
      )}
    </div>
  );
}

export function TestResultsPanel({
  passed, error, onApprove, onApproveAnyway, onReject, onRefine, onDeleteDraft, toolResults = [], summary,
}: {
  passed?: boolean | null;
  outputLines?: string[];
  error?: string | null;
  onApprove?: () => void;
  onApproveAnyway?: () => void;
  onReject?: () => void;
  onRefine?: (feedback: string) => void;
  onDeleteDraft?: () => void;
  toolResults?: ToolTestResult[];
  summary?: string | null;
}) {
  const { t } = useTranslation();
  const [showReport, setShowReport] = useState(false);
  const [refineText, setRefineText] = useState('');
  const testConnectors = useAgentStore((s) => s.buildTestConnectors);
  const missingConnectors = testConnectors.filter((c) => !c.has_credential);
  const hasConnectorGaps = missingConnectors.length > 0;
  const didPass = passed === true && !hasConnectorGaps;
  const passedCount = toolResults.filter((r) => r.status === 'passed').length;
  const failedCount = toolResults.filter((r) => r.status === 'failed' || r.status === 'credential_missing').length;
  const skippedCount = toolResults.filter((r) => r.status === 'skipped').length;

  return (
    <div className="relative flex flex-col gap-2 py-2 w-full h-full justify-center">
      <div className="absolute top-1 right-1 z-10">
        <div className={`w-7 h-7 rounded-full flex items-center justify-center border ${
          didPass ? 'border-status-success/30 bg-status-success/10' : failedCount > 0 ? 'border-status-error/30 bg-status-error/10' : 'border-status-warning/30 bg-status-warning/10'
        }`}>
          {didPass
            ? <CheckCircle2 className="w-4 h-4 text-status-success" />
            : failedCount > 0
            ? <XCircle className="w-4 h-4 text-status-error" />
            : <AlertTriangle className="w-4 h-4 text-status-warning" />}
        </div>
      </div>

      <div className="flex items-center gap-2 pr-8">
        <span className={`typo-heading font-medium ${didPass ? 'text-status-success' : failedCount > 0 ? 'text-status-error' : 'text-status-warning'}`}>
          {didPass ? 'Tests Passed' : failedCount > 0 ? 'Tests Failed' : 'Skipped'}
        </span>
        {toolResults.length > 0 && (
          <span className="typo-body text-foreground">
            {passedCount > 0 && <span className="text-status-success/70">{passedCount}</span>}
            {failedCount > 0 && <>{passedCount > 0 && '/'}<span className="text-status-error/70">{failedCount}</span></>}
            {skippedCount > 0 && <>{(passedCount > 0 || failedCount > 0) && '/'}<span className="text-foreground">{skippedCount}</span></>}
          </span>
        )}
      </div>

      {error && !toolResults.length && (
        <p className="typo-body text-status-error/80 leading-snug">{error}</p>
      )}

      {hasConnectorGaps && (
        <p className="typo-body text-status-warning/80 leading-snug">
          {t.templates.matrix_variants.missing_keys} <strong>{missingConnectors.map((c) => c.name).join(', ')}</strong>
        </p>
      )}

      {!didPass && onRefine && (
        <input
          type="text"
          value={refineText}
          onChange={(e) => setRefineText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && refineText.trim()) {
              e.preventDefault();
              onRefine(refineText.trim());
              setRefineText('');
            }
          }}
          placeholder={t.templates.matrix_variants.refine_placeholder}
          className="w-full px-3 py-1.5 typo-body rounded-card border border-primary/15 bg-foreground/[0.03] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-primary/30 transition-all"
        />
      )}

      <div className="flex gap-2 w-full">
        {didPass && onApprove && (
          <button
            type="button"
            onClick={onApprove}
            data-testid="agent-approve-btn"
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-modal typo-body font-medium cursor-pointer bg-gradient-to-r from-emerald-500 to-teal-500 text-foreground shadow-elevation-3 shadow-emerald-500/20 hover:shadow-emerald-500/30 transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Approve
          </button>
        )}
        {!didPass && onApproveAnyway && (
          <button
            type="button"
            onClick={onApproveAnyway}
            data-testid="agent-approve-anyway-btn"
            title={hasConnectorGaps
              ? `Promote without credentials for: ${missingConnectors.map((c) => c.name).join(', ')}`
              : 'Promote this agent despite skipped or failed tests'}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-modal typo-body font-medium cursor-pointer bg-gradient-to-r from-amber-500/80 to-orange-500/80 text-foreground shadow-elevation-2 shadow-amber-500/20 hover:shadow-amber-500/30 hover:from-amber-500 hover:to-orange-500 transition-all"
          >
            <AlertTriangle className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.approve_anyway}
          </button>
        )}
        {(toolResults.length > 0 || error) && (
          <button
            type="button"
            onClick={() => setShowReport(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-modal typo-body font-medium border border-primary/15 text-foreground hover:bg-primary/5 hover:text-foreground/80 transition-colors"
          >
            <FileText className="w-3.5 h-3.5" />
            Report
          </button>
        )}
        {onReject && (
          <button
            type="button"
            onClick={() => {
              if (refineText.trim() && onRefine) {
                onRefine(refineText.trim());
                setRefineText('');
              } else {
                onReject();
              }
            }}
            data-testid="agent-reject-btn"
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-modal typo-body font-medium border border-primary/15 text-foreground hover:bg-primary/5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.retry_with_changes}
          </button>
        )}
        {!didPass && onDeleteDraft && (
          <button
            type="button"
            onClick={onDeleteDraft}
            data-testid="agent-delete-draft-btn"
            title={t.templates.matrix_variants.delete_draft_title}
            className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-modal typo-body font-medium border border-status-error/25 text-status-error/80 hover:bg-status-error/10 hover:text-status-error transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.templates.matrix_variants.delete_draft}
          </button>
        )}
      </div>

      {showReport && createPortal(
        <TestReportModal results={toolResults} summary={summary} onClose={() => setShowReport(false)} onCredentialAdded={onReject} />,
        document.body,
      )}
    </div>
  );
}

export function PromotionSuccessIndicator({ onViewAgent }: { onViewAgent?: () => void }) {
  const { t } = useTranslation();
  return (
    <div data-testid="promotion-success" className="flex flex-col items-center gap-3 py-2">
      <div className="relative w-12 h-12 flex items-center justify-center">
        <span className="absolute inset-0 rounded-full border-2 border-status-success/35 shadow-elevation-2 animate-emerald-flash" />
        <span className="absolute inset-[3px] rounded-full bg-gradient-to-br from-emerald-500/20 via-emerald-500/10 to-teal-400/15" />
        <CheckCircle2 className="w-5 h-5 text-status-success relative z-10" />
      </div>
      <span className="typo-body text-foreground font-medium">{t.templates.matrix_variants.agent_promoted}</span>
      {onViewAgent && (
        <button
          type="button"
          onClick={onViewAgent}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-modal border border-primary/15 typo-body text-foreground hover:bg-primary/5 transition-colors"
        >
          <Eye className="w-3.5 h-3.5" />
          {t.templates.matrix_variants.view_agent}
        </button>
      )}
    </div>
  );
}
