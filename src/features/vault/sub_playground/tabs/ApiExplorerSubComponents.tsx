import { Upload, FileText, Globe, X, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Button } from '@/features/shared/components/buttons';
import { RequestBuilder } from '../RequestBuilder';
import { ResponseViewer } from '../ResponseViewer';
import type { TestProgress } from '../useApiTestRunner';
import type { ApiEndpoint, ApiProxyResponse } from '@/api/system/apiProxy';

// -- Empty state --------------------------------------------------

export function EmptyState({ onUpload, onPaste }: { onUpload: () => void; onPaste: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <Globe className="w-10 h-10 text-muted-foreground/50" />
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground/70">No API endpoints loaded</p>
        <p className="text-sm text-muted-foreground/50">
          Upload an OpenAPI/Swagger spec to explore and test API endpoints.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="accent"
          size="sm"
          icon={<Upload className="w-3.5 h-3.5" />}
          onClick={onUpload}
          className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
        >
          Upload Spec File
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<FileText className="w-3.5 h-3.5" />}
          onClick={onPaste}
        >
          Paste OpenAPI
        </Button>
      </div>
    </div>
  );
}

// -- Test-run counters (passed into TerminalStrip.counters) ------

export function TestRunCounters({ progress }: { progress: TestProgress }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0 text-sm font-medium">
      <span className="text-muted-foreground/60">
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
        <span className="flex items-center gap-0.5 text-muted-foreground/50">
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

// -- Request / Response panel ------------------------------------

interface RequestResponsePanelProps {
  selectedEndpoint: ApiEndpoint;
  response: ApiProxyResponse | null;
  sendError: string | null;
  isSending: boolean;
  onSend: (method: string, path: string, headers: Record<string, string>, body?: string) => Promise<void>;
  onClose: () => void;
}

export function RequestResponsePanel({ selectedEndpoint, response, sendError, isSending, onSend, onClose }: RequestResponsePanelProps) {
  return (
    <div className="border-t border-primary/25 pt-4">
      <div className={`grid gap-0 ${response || sendError ? 'grid-cols-[1fr_1px_1fr]' : 'grid-cols-1'}`}>
        <div className="space-y-4 min-w-0 pr-4">
          <div className="flex items-center gap-2">
            <span className="text-sm uppercase tracking-wider text-blue-400/70 font-semibold">
              Request Builder
            </span>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="text-muted-foreground/60 hover:text-muted-foreground/80"
            >
              Close
            </Button>
          </div>
          <RequestBuilder
            endpoint={selectedEndpoint}
            onSend={onSend}
            isSending={isSending}
          />
        </div>

        {(response || sendError) && (
          <div className="bg-primary/25" />
        )}

        {(response || sendError) && (
          <div className="min-w-0 pl-4">
            <span className="text-sm uppercase tracking-wider text-emerald-400/70 font-semibold block mb-3">
              Response
            </span>
            {sendError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-mono whitespace-pre-wrap">
                {sendError}
              </div>
            )}
            {response && <ResponseViewer response={response} />}
          </div>
        )}
      </div>
    </div>
  );
}

export function PasteSpecModal({ pasteContent, setPasteContent, isParsing, onClose, onSubmit }: PasteSpecModalProps) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-xl">
      <div className="w-full max-w-2xl mx-4 bg-background border border-primary/15 rounded-xl shadow-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground/80">Paste OpenAPI / Swagger Spec</h3>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            className="text-muted-foreground/60"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>
        <textarea
          value={pasteContent}
          onChange={(e) => setPasteContent(e.target.value)}
          placeholder="Paste your OpenAPI JSON or YAML spec here..."
          className="w-full h-[300px] p-3 rounded-lg text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/80 placeholder:text-muted-foreground/40 resize-none focus-visible:outline-none focus-visible:border-primary/25"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-muted-foreground/60"
          >
            Cancel
          </Button>
          <Button
            variant="accent"
            size="sm"
            icon={isParsing ? <LoadingSpinner size="xs" /> : <FileText className="w-3 h-3" />}
            onClick={onSubmit}
            disabled={isParsing || !pasteContent.trim()}
            loading={isParsing}
            className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
          >
            {isParsing ? 'Parsing...' : 'Parse & Load'}
          </Button>
        </div>
      </div>
    </div>
  );
}
