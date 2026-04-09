import { useState, useCallback } from 'react';
import { FileDown, ClipboardCopy, Check, Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { LIST_ITEM_GAP, TOOLS_BTN_STANDARD } from '@/lib/utils/designTokens';
import { useLabTranslation } from '../../i18n/useLabTranslation';
import {
  generateHtmlReport,
  generateMarkdownReport,
  downloadHtmlReport,
  type ReportMode,
  type LabRunAny,
  type LabResultAny,
} from '../../libs/reportGenerator';

interface ExportReportButtonProps {
  mode: ReportMode;
  run: LabRunAny;
  results: LabResultAny[];
}

type CopyState = 'idle' | 'copied';

export function ExportReportButton({ mode, run, results }: ExportReportButtonProps) {
  const personaName = useAgentStore((s) => s.selectedPersona?.name) ?? 'Agent';
  const { t } = useLabTranslation();
  const [downloading, setDownloading] = useState(false);
  const [copyState, setCopyState] = useState<CopyState>('idle');

  const handleDownloadHtml = useCallback(() => {
    setDownloading(true);
    try {
      const html = generateHtmlReport(mode, run, results, personaName);
      const safe = personaName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
      downloadHtmlReport(html, `${safe}-${mode}-report.html`);
    } finally {
      setDownloading(false);
    }
  }, [mode, run, results, personaName]);

  const handleCopyMarkdown = useCallback(async () => {
    const md = generateMarkdownReport(mode, run, results, personaName);
    await navigator.clipboard.writeText(md);
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  }, [mode, run, results, personaName]);

  if (results.length === 0) return null;

  return (
    <div className={`flex items-center ${LIST_ITEM_GAP.dense}`}>
      <button
        onClick={handleDownloadHtml}
        disabled={downloading}
        data-testid="export-report-html"
        className={`inline-flex items-center ${LIST_ITEM_GAP.dense} ${TOOLS_BTN_STANDARD} rounded-interactive typo-caption font-medium text-foreground bg-secondary/60 hover:bg-secondary/80 border border-primary/10 transition-colors disabled:opacity-50`}
      >
        {downloading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <FileDown className="w-3.5 h-3.5" />}
        {t.export.downloadHtml}
      </button>
      <button
        onClick={handleCopyMarkdown}
        data-testid="export-report-md"
        className={`inline-flex items-center ${LIST_ITEM_GAP.dense} ${TOOLS_BTN_STANDARD} rounded-interactive typo-caption font-medium text-foreground bg-secondary/60 hover:bg-secondary/80 border border-primary/10 transition-colors`}
      >
        {copyState === 'copied'
          ? <Check className="w-3.5 h-3.5 text-status-success" />
          : <ClipboardCopy className="w-3.5 h-3.5" />}
        {copyState === 'copied' ? t.export.copied : t.export.copyMarkdown}
      </button>
    </div>
  );
}
