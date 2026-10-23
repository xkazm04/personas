import { useTranslation } from '@/i18n/useTranslation';
import { Upload, FileText, X, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import ScenarioEmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Button } from '@/features/shared/components/buttons';
import type { TestProgress } from '../useApiTestRunner';

// -- Empty state --------------------------------------------------

export function EmptyState({ onUpload, onPaste }: { onUpload: () => void; onPaste: () => void }) {
  const { t } = useTranslation();
  const vt = t.vault.playground_extra;
  const sh = t.vault.shared;
  return (
    <ScenarioEmptyState
      art="link"
      title={vt.no_endpoints}
      description={vt.no_endpoints_hint}
    >
        <div className="flex items-center gap-2 mt-4">
          <Button
            variant="accent"
            size="sm"
            icon={<Upload className="w-3.5 h-3.5" />}
            onClick={onUpload}
            className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
          >
            {sh.upload_spec}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<FileText className="w-3.5 h-3.5" />}
            onClick={onPaste}
          >
            {sh.paste_openapi}
          </Button>
        </div>
    </ScenarioEmptyState>
  );
}

// -- Test-run counters (passed into TerminalStrip.counters) ------

export function TestRunCounters({ progress }: { progress: TestProgress }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0 typo-body">
      <span className="text-foreground">
        {progress.current}/{progress.total}
      </span>
      {progress.passed > 0 && (
        <span className="flex items-center gap-0.5 text-emerald-400">
          <CheckCircle2 className="w-3 h-3" />
          {progress.passed}
        </span>
      )}
      {progress.failed > 0 && (
        <span className="flex items-center gap-0.5 text-red-400">
          <XCircle className="w-3 h-3" />
          {progress.failed}
        </span>
      )}
      {progress.skipped > 0 && (
        <span className="flex items-center gap-0.5 text-foreground">
          <MinusCircle className="w-3 h-3" />
          {progress.skipped}
        </span>
      )}
    </div>
  );
}

// -- Paste modal -------------------------------------------------

interface PasteSpecModalProps {
  pasteContent: string;
  setPasteContent: (v: string) => void;
  isParsing: boolean;
  onClose: () => void;
  onSubmit: () => void;
}

export function PasteSpecModal({ pasteContent, setPasteContent, isParsing, onClose, onSubmit }: PasteSpecModalProps) {
  const { t } = useTranslation();
  const vt = t.vault.playground_extra;
  const sh = t.vault.shared;
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-modal">
      <div className="w-full max-w-2xl mx-4 bg-background border border-primary/15 rounded-modal shadow-elevation-3 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="typo-heading text-foreground">{vt.paste_spec_title}</h3>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="text-foreground"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <textarea
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          placeholder={vt.paste_placeholder}
          className="w-full h-[300px] p-3 rounded-card typo-code bg-secondary/20 border border-primary/10 text-foreground placeholder:text-foreground resize-none focus-visible:outline-none focus-visible:border-primary/25"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-foreground"
          >
            {t.common.cancel}
          </Button>
          <Button
            variant="accent"
            size="sm"
            icon={<FileText className="w-3 h-3" />}
            onClick={onSubmit}
            disabled={isParsing || !pasteContent.trim()}
            loading={isParsing}
            className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
          >
            {isParsing ? sh.parsing : sh.parse_and_load}
          </Button>
        </div>
      </div>
    </div>
  );
}
