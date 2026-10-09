import { useMemo, useState } from 'react';
import { Paperclip } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { attachmentSrc } from '../libs/attachmentSrc';
import { parseReportAttachments, type ReportAttachment } from '../libs/reportAttachments';
import { AttachmentLightbox } from './AttachmentLightbox';
import { AttachmentMissing } from './AttachmentMissing';

/** One image attachment: a thumbnail that opens the larger view, caption under it. */
function AttachmentThumb({
  attachment,
  onOpen,
}: {
  attachment: ReportAttachment;
  onOpen: (attachment: ReportAttachment) => void;
}) {
  const { t, tx } = useTranslation();
  const src = useMemo(() => attachmentSrc(attachment.path), [attachment.path]);
  const [failed, setFailed] = useState(false);
  const missing = failed || !src;

  return (
    <li data-testid="report-attachment-image" className="min-w-0">
      <div className={`relative aspect-video overflow-hidden rounded-card border border-primary/15 bg-secondary/20 ${missing ? 'border-dashed' : ''}`}>
        {missing ? (
          <AttachmentMissing framed={false} />
        ) : (
          <>
            <img
              src={src}
              alt={attachment.caption ?? attachment.name}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="h-full w-full object-cover"
              onError={() => setFailed(true)}
            />
            {/* The tile is the target: an empty ghost button laid over the image,
                so the focus ring and the press response are the shared ones. */}
            <Button
              variant="ghost"
              data-testid="report-attachment-open"
              aria-label={tx(t.overview.reports_view.attachment_open, { name: attachment.name })}
              onClick={() => onOpen(attachment)}
              className="absolute inset-0 h-full w-full p-0! rounded-card!"
            />
          </>
        )}
      </div>
      {attachment.caption && (
        <p className="typo-caption mt-1.5 break-words">{attachment.caption}</p>
      )}
    </li>
  );
}

/** A non-image attachment: name and caption as a chip (the file is not previewed). */
function AttachmentFileChip({ attachment }: { attachment: ReportAttachment }) {
  return (
    <li
      data-testid="report-attachment-file"
      className="inline-flex max-w-full items-center gap-2 rounded-input border border-primary/15 bg-secondary/30 px-2.5 py-1.5"
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" />
      <span className="typo-body truncate">{attachment.name}</span>
      {attachment.caption && <span className="typo-caption truncate">{attachment.caption}</span>}
    </li>
  );
}

/**
 * Attachments of a report (screenshots from a headless App Master), read from
 * the report's `metadata`. Renders nothing when the report has none. After the
 * linked decision the files are deleted and `attachmentsCleaned` is set: that
 * state shows ONE muted line instead of images that could only break.
 */
export function ReportAttachmentsSection({ metadata }: { metadata: string | null | undefined }) {
  const { t } = useTranslation();
  const view = useMemo(() => parseReportAttachments(metadata), [metadata]);
  const [opened, setOpened] = useState<ReportAttachment | null>(null);

  if (!view.cleaned && view.attachments.length === 0) return null;

  const images = view.attachments.filter((a) => a.kind === 'image');
  const files = view.attachments.filter((a) => a.kind === 'file');

  return (
    <section data-testid="report-attachments" className="mb-10">
      <h3 className="typo-eyebrow text-foreground mb-3">{t.overview.reports_view.attachments_label}</h3>
      {view.cleaned ? (
        <p data-testid="report-attachments-cleaned" className="typo-caption">
          {t.overview.reports_view.attachments_cleaned}
          {view.cleanedAt && (
            <>
              {' · '}
              <RelativeTime timestamp={view.cleanedAt} className="typo-caption" />
            </>
          )}
        </p>
      ) : (
        <div className="space-y-3">
          {images.length > 0 && (
            <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {images.map((a) => (
                <AttachmentThumb key={a.path} attachment={a} onOpen={setOpened} />
              ))}
            </ul>
          )}
          {files.length > 0 && (
            <ul className="flex flex-wrap gap-2">
              {files.map((a) => (
                <AttachmentFileChip key={a.path} attachment={a} />
              ))}
            </ul>
          )}
        </div>
      )}
      {opened && <AttachmentLightbox attachment={opened} onClose={() => setOpened(null)} />}
    </section>
  );
}
