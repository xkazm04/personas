import { AlertCircle, ChevronRight } from 'lucide-react';
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
              ? 'border-primary/10 bg-zinc-900/50 py-2 cursor-pointer hover:bg-zinc-800/60 transition-colors'
              : 'border-red-400/40 bg-red-500/5 h-12'
          }`}
        >
          {preview.kind === 'valid' ? (
            <>
              <FileIcon className="w-4 h-4 text-violet-400 flex-shrink-0" />
              {preview.platform && (
                <span className="typo-code font-mono uppercase px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400/80 border border-violet-500/20 flex-shrink-0">
                  {preview.platform}
                </span>
              )}
              <span className="typo-body font-medium text-foreground/90 truncate">{preview.workflowName}</span>
              <span className="typo-body text-foreground flex-shrink-0">
                {preview.nodeCount > 0 && <>{preview.nodeCount} element{preview.nodeCount !== 1 ? 's' : ''} &middot; </>}
                {preview.fileSize}
              </span>
              <ChevronRight className="w-4 h-4 text-foreground flex-shrink-0 ml-auto" />
            </>
          ) : (
            <>
              <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
              <span className="typo-body text-red-400 truncate">{preview.message}</span>
            </>
          )}
        </div>
      )}
    </>
  );
}
