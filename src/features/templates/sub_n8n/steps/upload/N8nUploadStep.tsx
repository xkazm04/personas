import { useState } from 'react';
import {
  Upload, FileJson, ChevronRight, ClipboardPaste, Link2,
} from 'lucide-react';
import { getAcceptedExtensions } from '@/lib/personas/parsers/workflowDetector';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

import type { ImportMode } from './n8nUploadTypes';
import { formatFileSize, getFileIcon } from './n8nUploadTypes';
import { PlatformLabels } from './PlatformLabels';
import { PreviewCard } from './PreviewCard';
import { useFileUpload } from './useFileUpload';
import { usePasteImport } from './usePasteImport';
import { useUrlImport } from './useUrlImport';
import { useTranslation } from '@/i18n/useTranslation';

interface N8nUploadStepProps {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  onFileDrop?: (file: File) => void;
  onContentPaste?: (content: string, sourceName: string) => void;
}

export function N8nUploadStep({ fileInputRef, onContentPaste }: N8nUploadStepProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<ImportMode>('file');

  const {
    isDragging, preview,
    handleDragOver, handleDragEnter, handleDragLeave, handleDrop,
    handleFileInputChange, handleManualProceed, mountedRef,
  } = useFileUpload(onContentPaste);

  const {
    pasteText, setPasteText, pastePreview,
    validatePastedContent, handlePasteImport,
  } = usePasteImport(onContentPaste);

  const {
    urlValue, setUrlValue, urlFetching, urlPreview, setUrlPreview,
    handleUrlFetch, handleUrlImport,
  } = useUrlImport(onContentPaste, mountedRef);

  const FileIcon = preview?.kind === 'valid' ? getFileIcon(preview.fileName) : FileJson;

  const modes: { id: ImportMode; label: string; icon: React.ReactNode }[] = [
    { id: 'file', label: t.templates.n8n.upload_file, icon: <Upload className="w-3.5 h-3.5" /> },
    { id: 'paste', label: t.templates.n8n.paste_json, icon: <ClipboardPaste className="w-3.5 h-3.5" /> },
    { id: 'url', label: t.templates.n8n.from_url, icon: <Link2 className="w-3.5 h-3.5" /> },
  ];

  return (
    <div>
      {/* Mode tabs */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-card bg-secondary/30 border border-primary/8">
        {modes.map((m) => (
          <button
            key={m.id}
            onClick={() => setMode(m.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-modal text-sm font-medium transition-all ${
              mode === m.id
                ? 'bg-violet-500/15 text-violet-300 border border-violet-500/25 shadow-elevation-1'
                : 'text-foreground hover:text-foreground/80 hover:bg-secondary/40 border border-transparent'
            }`}
          >
            {m.icon}
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'file' && (
          <FileUploadTab
            fileInputRef={fileInputRef}
            isDragging={isDragging}
            preview={preview}
            FileIcon={FileIcon}
            handleDragOver={handleDragOver}
            handleDragEnter={handleDragEnter}
            handleDragLeave={handleDragLeave}
            handleDrop={handleDrop}
            handleFileInputChange={handleFileInputChange}
            handleManualProceed={handleManualProceed}
          />
        )}

        {mode === 'paste' && (
          <PasteTab
            pasteText={pasteText}
            setPasteText={setPasteText}
            pastePreview={pastePreview}
            validatePastedContent={validatePastedContent}
            handlePasteImport={handlePasteImport}
          />
        )}

        {mode === 'url' && (
          <UrlTab
            urlValue={urlValue}
            setUrlValue={setUrlValue}
            urlFetching={urlFetching}
            urlPreview={urlPreview}
            setUrlPreview={setUrlPreview}
            handleUrlFetch={handleUrlFetch}
            handleUrlImport={handleUrlImport}
          />
        )}
    </div>
  );
}

// -- Inline tab wrappers (thin, just JSX) --

function FileUploadTab({
  fileInputRef, isDragging, preview, FileIcon,
  handleDragOver, handleDragEnter, handleDragLeave, handleDrop,
  handleFileInputChange, handleManualProceed,
}: {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  preview: ReturnType<typeof useFileUpload>['preview'];
  FileIcon: React.ComponentType<{ className?: string }>;
  handleDragOver: (e: React.DragEvent) => void;
  handleDragEnter: (e: React.DragEvent) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleFileInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleManualProceed: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-slide-in" key="file">
      <div
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInputRef.current?.click(); } }}
        onDragOver={handleDragOver}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        role="button"
        tabIndex={0}
        aria-label="Drop workflow file or click to browse"
        data-testid="n8n-upload-dropzone"
        className={`animate-fade-in relative flex flex-col items-center justify-center gap-4 p-12 rounded-modal border-2 border-dashed cursor-pointer transition-all duration-200 ${
          isDragging
            ? 'border-violet-400/60 bg-violet-500/10 scale-[1.01]'
            : 'border-primary/15 bg-secondary/20 hover:border-primary/30 hover:bg-secondary/30'
        } focus-visible:ring-2 focus-visible:ring-violet-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
      >
        <div
          className={`animate-fade-in w-16 h-16 rounded-modal border flex items-center justify-center transition-colors duration-200 ${
            isDragging ? 'bg-violet-500/25 border-violet-400/40' : 'bg-violet-500/15 border-violet-500/25'
          }`}
        >
          <Upload className={`w-8 h-8 transition-colors duration-200 ${isDragging ? 'text-violet-300' : 'text-violet-400'}`} />
        </div>
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {isDragging ? t.templates.n8n.drop_file_here : t.templates.n8n.import_from_any_platform}
          </p>
          <p className="text-sm text-foreground mt-1">
            {t.templates.n8n.click_to_browse}
          </p>
        </div>
        <PlatformLabels />
        <input ref={fileInputRef} type="file" accept={getAcceptedExtensions()} onChange={handleFileInputChange} className="hidden" data-testid="n8n-file-input" />
      </div>
      <PreviewCard preview={preview} FileIcon={FileIcon} onClick={preview?.kind === 'valid' ? handleManualProceed : undefined} />
      {preview?.kind === 'valid' && (
        <div className="animate-fade-slide-in mt-4 flex flex-col items-start gap-1.5">
          <button onClick={handleManualProceed} className="px-4 py-2.5 text-sm font-semibold rounded-modal bg-violet-500 text-white hover:bg-violet-400 transition-colors">
            Continue
          </button>
          <p className="text-sm text-foreground">{t.templates.n8n.press_enter_or_click}</p>
        </div>
      )}
    </div>
  );
}

function PasteTab({
  pasteText, setPasteText, pastePreview, validatePastedContent, handlePasteImport,
}: {
  pasteText: string;
  setPasteText: (v: string) => void;
  pastePreview: ReturnType<typeof usePasteImport>['pastePreview'];
  validatePastedContent: (text: string) => void;
  handlePasteImport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div key="paste">
      <div className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/20 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-primary/8 flex items-center gap-2">
          <ClipboardPaste className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-medium text-foreground">{t.templates.n8n.paste_workflow_json}</span>
          <span className="text-sm text-foreground ml-auto">
            {pasteText.length > 0 && formatFileSize(pasteText.length)}
          </span>
        </div>
        <textarea
          value={pasteText}
          onChange={(e) => { setPasteText(e.target.value); validatePastedContent(e.target.value); }}
          aria-label="Workflow JSON content"
          placeholder='Paste your exported workflow JSON here...\n\nExample: {"nodes": [...], "connections": {...}}'
          className="w-full h-48 px-4 py-3 bg-transparent text-sm font-mono text-foreground placeholder:text-foreground resize-none outline-none"
          spellCheck={false}
          data-testid="paste-json-textarea"
        />
        <div className="px-4 py-2.5 border-t border-primary/8 flex items-center justify-between">
          <PlatformLabels />
          <button
            onClick={handlePasteImport}
            disabled={pastePreview?.kind !== 'valid'}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-modal text-sm font-medium transition-all ${
              pastePreview?.kind === 'valid'
                ? 'bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30'
                : 'bg-secondary/40 text-foreground border border-primary/10 disabled:cursor-not-allowed'
            }`}
          >
            <ChevronRight className="w-3.5 h-3.5" />
            Import
          </button>
        </div>
      </div>
      <PreviewCard preview={pastePreview} FileIcon={FileJson} onClick={pastePreview?.kind === 'valid' ? handlePasteImport : undefined} />
    </div>
  );
}

function UrlTab({
  urlValue, setUrlValue, urlFetching, urlPreview, setUrlPreview,
  handleUrlFetch, handleUrlImport,
}: {
  urlValue: string;
  setUrlValue: (v: string) => void;
  urlFetching: boolean;
  urlPreview: ReturnType<typeof useUrlImport>['urlPreview'];
  setUrlPreview: (v: null) => void;
  handleUrlFetch: () => Promise<void>;
  handleUrlImport: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div key="url">
      <div className="animate-fade-slide-in rounded-modal border border-primary/15 bg-secondary/20 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-violet-400 flex-shrink-0" />
          <span className="text-sm font-medium text-foreground">{t.templates.n8n.import_from_url}</span>
        </div>
        <p className="text-sm text-foreground">
          Paste a URL to a raw workflow JSON file. Supports GitHub raw URLs, Gist links, and direct JSON endpoints.
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={urlValue}
            onChange={(e) => { setUrlValue(e.target.value); setUrlPreview(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !urlFetching) void handleUrlFetch(); }}
            aria-label="Workflow URL"
            placeholder="https://raw.githubusercontent.com/.../workflow.json"
            className="flex-1 px-3 py-2 rounded-modal bg-background/50 border border-primary/15 text-sm text-foreground placeholder:text-foreground outline-none focus-visible:border-violet-500/40 transition-colors"
            data-testid="url-input"
          />
          <button
            onClick={() => void handleUrlFetch()}
            disabled={urlFetching || !urlValue.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-modal text-sm font-medium transition-all ${
              urlFetching || !urlValue.trim()
                ? 'bg-secondary/40 text-foreground border border-primary/10 disabled:cursor-not-allowed'
                : 'bg-violet-500/20 text-violet-300 border border-violet-500/30 hover:bg-violet-500/30'
            }`}
          >
            {urlFetching ? (
              <><LoadingSpinner size="sm" /> Fetching</>
            ) : (
              <><ChevronRight className="w-3.5 h-3.5" /> {t.templates.n8n.fetch}</>
            )}
          </button>
        </div>
        <div className="flex items-center gap-3 text-sm text-foreground">
          <span>{t.templates.n8n.accepts_label}</span>
          <span className="font-mono text-sm">github.com/*/blob/*</span>
          <span className="text-primary/20">|</span>
          <span className="font-mono text-sm">gist.github.com/*</span>
          <span className="text-primary/20">|</span>
          <span className="font-mono text-sm">raw JSON endpoint</span>
        </div>
      </div>
      <PreviewCard preview={urlPreview} FileIcon={FileJson} onClick={urlPreview?.kind === 'valid' ? handleUrlImport : undefined} />
      {urlPreview?.kind === 'valid' && (
        <div className="animate-fade-slide-in mt-4 flex flex-col items-start gap-1.5">
          <button onClick={handleUrlImport} className="px-4 py-2.5 text-sm font-semibold rounded-modal bg-violet-500 text-white hover:bg-violet-400 transition-colors">
            Continue
          </button>
          <p className="text-sm text-foreground">{t.templates.n8n.press_enter_or_click}</p>
        </div>
      )}
    </div>
  );
}
