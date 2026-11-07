import { AlertCircle, ChevronRight } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FilePreview } from './n8nUploadTypes';

export function PreviewCard({
  preview,
  FileIcon,
  onClick,
}: {
  preview: FilePreview | null;
  FileIcon: React.ComponentType<{ className?: string }>;
  onClick?: () => void;
}) {
  const { t, tx } = useTranslation();
  return (
    <>
      {preview && (
        <div
          key={preview.kind}
          data-testid="file-validation-preview"
          data-status={preview.kind}
          onClick={onClick}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && onClick) {
              e.preventDefault();
              onClick();
            }
          }}
          role={onClick ? 'button' : undefined}
          tabIndex={onClick ? 0 : -1}
          className={`animate-fade-slide-in mt-3 flex items-center gap-3 px-4 rounded-modal border ${
            preview.kind === 'valid'
              ? 'border-hair bg-zinc-900/50 py-2 cursor-pointer hover:bg-zinc-800/60 transition-colors'
              : 'border-status-error/40 bg-status-error/5 h-12'
          }`}
        >
          {preview.kind === 'valid' ? (
            <>
              <FileIcon className="w-4 h-4 text-role-agent flex-shrink-0" />
              {preview.platform && (
                <span className="typo-eyebrow px-1.5 py-0.5 text-role-agent/80 flex-shrink-0">
                  {preview.platform}
                </span>
              )}
              <span className="typo-body text-ink-1 truncate">{preview.workflowName}</span>
              <span className="typo-body text-foreground flex-shrink-0">
                {preview.nodeCount > 0 && <>{tx(preview.nodeCount === 1 ? t.templates.n8n.preview_elements_one : t.templates.n8n.preview_elements_other, { count: preview.nodeCount })} &middot; </>}
                {preview.fileSize}
              </span>
              <ChevronRight className="w-4 h-4 text-foreground flex-shrink-0 ml-auto" />
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-status-error flex-shrink-0" />
              <span className="typo-body text-status-error truncate">{preview.message}</span>
            </>
          )}
        </div>
      )}
    </>
  );
}
