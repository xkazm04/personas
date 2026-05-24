import { useCallback, useEffect, useState } from 'react';
import { BundleImportDialog } from './BundleImportDialog';

/**
 * Global handler for `personas://share` deep links.
 *
 * Listens for `personas:share-link` DOM events (dispatched by the event bridge
 * when the OS opens the app via a deep link) and auto-opens the import dialog
 * with the share URL pre-filled.
 */
export function ShareLinkHandler() {
  const [open, setOpen] = useState(false);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  // Monotonic key bumped on every deep-link arrival. Without this, a second
  // identical share URL arriving while the dialog is already open silently
  // no-ops: setPendingUrl(sameUrl) and setOpen(true) both bail because the
  // values are unchanged, so the dialog's autoStartedRef effect never re-fires
  // and the user (who clicked their share link expecting a retry) sees the
  // stale preview instead of a fresh fetch.
  const [shareLinkKey, setShareLinkKey] = useState(0);

  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent<{ url: string }>).detail?.url;
      if (url) {
        setPendingUrl(url);
        setShareLinkKey((k) => k + 1);
        setOpen(true);
      }
    };
    window.addEventListener('personas:share-link', handler);
    return () => window.removeEventListener('personas:share-link', handler);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
    setPendingUrl(null);
  }, []);

  return (
    <BundleImportDialog
      isOpen={open}
      onClose={handleClose}
      initialShareUrl={pendingUrl ?? undefined}
      shareLinkKey={shareLinkKey}
    />
  );
}
