import { useMemo, useState } from 'react';
import { ModalShell } from '@/features/shared/components/modals/ModalShell';
import { attachmentSrc } from '../libs/attachmentSrc';
import type { ReportAttachment } from '../libs/reportAttachments';
import { AttachmentMissing } from './AttachmentMissing';

/**
 * The larger view of one image attachment. The catalog has no lightbox, so this
 * is the standard modal interior (`ModalShell`) around the image. It renders
 * through the portal tier because it opens from inside the report detail modal,
 * which sits at z 200 and would cover the default tier.
 */
export function AttachmentLightbox({
  attachment,
  onClose,
}: {
  attachment: ReportAttachment;
  onClose: () => void;
}) {
  const src = useMemo(() => attachmentSrc(attachment.path), [attachment.path]);
  const [failed, setFailed] = useState(false);

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      titleId="report-attachment-lightbox-title"
      width="lg"
      portal
      title={attachment.name}
      subtitle={attachment.caption ?? undefined}
    >
      <div data-testid="report-attachment-lightbox" className="flex justify-center">
        {failed || !src ? (
          <AttachmentMissing />
        ) : (
          <img
            src={src}
            alt={attachment.caption ?? attachment.name}
            decoding="async"
            className="max-h-[70vh] w-auto max-w-full rounded-card object-contain"
            onError={() => setFailed(true)}
          />
        )}
      </div>
    </ModalShell>
  );
}
