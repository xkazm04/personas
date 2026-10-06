import { ImageOff } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * What an attachment shows when its file is gone or cannot be loaded: a quiet
 * dashed tile, never the browser's broken-image icon. Fills its parent, so the
 * thumbnail grid and the enlarged view share one shape. `framed={false}` when the
 * parent already draws the frame.
 */
export function AttachmentMissing({ framed = true }: { framed?: boolean }) {
  const { t } = useTranslation();
  return (
    <div
      data-testid="report-attachment-missing"
      role="img"
      aria-label={t.overview.reports_view.attachment_missing}
      className={`flex h-full w-full flex-col items-center justify-center gap-1 px-3 py-6 text-center ${framed ? 'rounded-card border border-dashed border-primary/15 bg-secondary/20' : ''}`}
    >
      <ImageOff className="h-4 w-4 text-foreground" aria-hidden="true" />
      <span className="typo-caption">{t.overview.reports_view.attachment_missing}</span>
    </div>
  );
}
