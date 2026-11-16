import { useState, useCallback } from 'react';
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { FileDown, ClipboardCopy, Check, Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { LIST_ITEM_GAP } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';
import {
  generateHtmlReport,
  generateMarkdownReport,
  downloadHtmlReport,
  type ReportMode,
  type LabRunAny,
  type LabResultAny,
} from '../../libs/reportGenerator';
import Button from '@/features/shared/components/buttons/Button';

interface ExportReportButtonProps {
  mode: ReportMode;
  run: LabRunAny;
  results: LabResultAny[];
}

type CopyState = 'idle' | 'copied';

export function ExportReportButton({ mode, run, results }: ExportReportButtonProps) {
  const personaName = useAgentStore((s) => s.selectedPersona?.name) ?? 'Agent';
  const { t } = useTranslation();
  const lab = t.agent_lab;
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
    // copyText resolves false when the clipboard refused the write (already
    // reported through silentCatch); only a write that landed says "Copied".
    if (!(await copyText(md))) return;
    setCopyState('copied');
    setTimeout(() => setCopyState('idle'), 2000);
  }, [mode, run, results, personaName]);

  if (results.length === 0) return null;

  return (
    <div className={`flex items-center ${LIST_ITEM_GAP.dense}`}>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDownloadHtml}
        disabled={downloading}
        data-testid="export-report-html"
      >
        {downloading
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <FileDown className="w-3.5 h-3.5" />}
        {lab.export_download_html}
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleCopyMarkdown}
        data-testid="export-report-md"
      >
        {copyState === 'copied'
          ? <Check className="w-3.5 h-3.5 text-status-success" />
          : <ClipboardCopy className="w-3.5 h-3.5" />}
        {copyState === 'copied' ? lab.export_copied : lab.export_copy_markdown}
      </Button>
    </div>
  );
}
