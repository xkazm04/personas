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

  useEffect(() => {
    const handler = (e: Event) => {
      const url = (e as CustomEvent<{ url: string }>).detail?.url;
      if (url) {
        setPendingUrl(url);
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
    />
  );
}
