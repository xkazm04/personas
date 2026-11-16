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
import { DropZoneGlow } from '@/features/shared/components/feedback/DropZoneGlow';
import Button from '@/features/shared/components/buttons/Button';

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
      <div className="flex items-center gap-1 mb-4 p-1 rounded-card bg-surface-1 border border-primary/8">
        {modes.map((m) => (
          <Button
            key={m.id}
            type="button"
            onClick={() => setMode(m.id)}
            variant={mode === m.id ? 'accent' : 'ghost'}
            tone={mode === m.id ? 'agent' : undefined}
            size="md"
            className="flex-1"
            icon={m.icon}
          >
            {m.label}
          </Button>
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
        aria-label={t.templates.n8n.dropzone_aria}
        data-testid="n8n-upload-dropzone"
        className={`animate-fade-in relative flex flex-col items-center justify-center gap-4 p-12 rounded-modal border-2 border-dashed cursor-pointer transition-colors duration-200 ${
          isDragging
            ? 'border-role-agent/60 bg-role-agent/10'
            : 'border-hair bg-surface-1 hover:border-primary/30 hover:bg-surface-1'
        } focus-visible:ring-2 focus-visible:ring-role-agent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
      >
        <DropZoneGlow active={isDragging} radius={12} label={t.templates.n8n.drop_file_here} />
        <div
          className={`animate-fade-in w-16 h-16 rounded-modal border flex items-center justify-center transition-colors duration-200 ${
            isDragging ? 'bg-role-agent/25 border-role-agent/40' : 'bg-role-agent/15 border-role-agent/25'
          }`}
        >
          <Upload className={`w-8 h-8 transition-colors duration-200 ${isDragging ? 'text-role-agent' : 'text-role-agent'}`} />
        </div>
        <div className="text-center">
          <p className="typo-body text-foreground">
            {isDragging ? t.templates.n8n.drop_file_here : t.templates.n8n.import_from_any_platform}
          </p>
          <p className="typo-body text-foreground mt-1">
            {t.templates.n8n.click_to_browse}
          </p>
        </div>
        <PlatformLabels />
        <input ref={fileInputRef} type="file" accept={getAcceptedExtensions()} onChange={handleFileInputChange} className="hidden" data-testid="n8n-file-input" />
      </div>
      <PreviewCard preview={preview} FileIcon={FileIcon} onClick={preview?.kind === 'valid' ? handleManualProceed : undefined} />
      {preview?.kind === 'valid' && (
        <div className="animate-fade-slide-in mt-4 flex flex-col items-start gap-1.5">
          <Button type="button" onClick={handleManualProceed} variant="accent" tone="agent" size="md">
            {t.templates.n8n.continue_btn}
          </Button>
          <p className="typo-body text-foreground">{t.templates.n8n.press_enter_or_click}</p>
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
      <div className="animate-fade-slide-in rounded-modal border border-hair bg-surface-1 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-primary/8 flex items-center gap-2">
          <ClipboardPaste className="w-4 h-4 text-role-agent" />
          <span className="typo-body text-foreground">{t.templates.n8n.paste_workflow_json}</span>
          <span className="typo-body text-foreground ml-auto">
            {pasteText.length > 0 && formatFileSize(pasteText.length)}
          </span>
        </div>
        <textarea
          value={pasteText}
          onChange={(e) => { setPasteText(e.target.value); validatePastedContent(e.target.value); }}
          aria-label={t.templates.n8n.paste_aria}
          placeholder={t.templates.n8n.paste_placeholder}
          className="w-full h-48 px-4 py-3 bg-transparent typo-code text-foreground placeholder:text-foreground resize-none outline-none"
          spellCheck={false}
          data-testid="paste-json-textarea"
        />
        <div className="px-4 py-2.5 border-t border-primary/8 flex items-center justify-between">
          <PlatformLabels />
          <Button
            type="button"
            onClick={handlePasteImport}
            disabled={pastePreview?.kind !== 'valid'}
            variant={pastePreview?.kind === 'valid' ? 'accent' : 'secondary'}
            tone={pastePreview?.kind === 'valid' ? 'agent' : undefined}
            size="md"
            icon={<ChevronRight className="w-3.5 h-3.5" />}
          >
            {t.templates.n8n.import_btn}
          </Button>
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
      <div className="animate-fade-slide-in rounded-modal border border-hair bg-surface-1 p-4 space-y-4">
        <div className="flex items-center gap-2">
          <Link2 className="w-4 h-4 text-role-agent flex-shrink-0" />
          <span className="typo-body text-foreground">{t.templates.n8n.import_from_url}</span>
        </div>
        <p className="typo-body text-foreground">
          {t.templates.n8n.url_description}
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={urlValue}
            onChange={(e) => { setUrlValue(e.target.value); setUrlPreview(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !urlFetching) void handleUrlFetch(); }}
            aria-label={t.templates.n8n.url_aria}
            placeholder={t.templates.n8n.url_placeholder}
            className="flex-1 px-3 py-2 rounded-modal bg-background/50 border border-hair typo-body text-foreground placeholder:text-foreground outline-none focus-visible:border-role-agent/40 transition-colors"
            data-testid="url-input"
          />
          <Button
            type="button"
            onClick={() => void handleUrlFetch()}
            disabled={urlFetching || !urlValue.trim()}
            variant={urlFetching || !urlValue.trim() ? 'secondary' : 'accent'}
            tone={urlFetching || !urlValue.trim() ? undefined : 'agent'}
            size="md"
          >
            {urlFetching ? (
              <><LoadingSpinner size="sm" /> {t.templates.n8n.fetching}</>
            ) : (
              <><ChevronRight className="w-3.5 h-3.5" /> {t.templates.n8n.fetch}</>
            )}
          </Button>
        </div>
        <div className="flex items-center gap-3 typo-body text-foreground">
          <span>{t.templates.n8n.accepts_label}</span>
          <span className="typo-code">{t.templates.n8n.url_format_github}</span>
          <span className="text-primary/20">|</span>
          <span className="typo-code">{t.templates.n8n.url_format_gist}</span>
          <span className="text-primary/20">|</span>
          <span className="typo-code">{t.templates.n8n.url_format_raw}</span>
        </div>
      </div>
      <PreviewCard preview={urlPreview} FileIcon={FileJson} onClick={urlPreview?.kind === 'valid' ? handleUrlImport : undefined} />
      {urlPreview?.kind === 'valid' && (
        <div className="animate-fade-slide-in mt-4 flex flex-col items-start gap-1.5">
          <Button type="button" onClick={handleUrlImport} variant="accent" tone="agent" size="md">
            {t.templates.n8n.continue_btn}
          </Button>
          <p className="typo-body text-foreground">{t.templates.n8n.press_enter_or_click}</p>
        </div>
      )}
    </div>
  );
}
