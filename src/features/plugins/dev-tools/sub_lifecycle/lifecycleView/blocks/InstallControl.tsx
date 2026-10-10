/**
 * "Install into repo", the one CONDITIONAL control of the header's cluster: it
 * exists only while a binding is missing, so it sits LAST in the row, where
 * appearing moves nothing else. Pressing it asks first (a confirm popover
 * naming what will be added); what the attempt came to is a note line under
 * the cluster, never a toast.
 *
 * The "install running" line is a dashed square, not a spinner: this is a
 * background task reported by the backend, not a control the user just pressed.
 */
import { useRef, useState } from 'react';
import { Download } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { ConfirmPopover } from '@/features/shared/components/feedback/ConfirmPopover';

import { useLifecycleViewModel } from '../context';
import { LT } from '../system/lcType';
import { GLYPH } from '../system/scales';
import type { InstallNote } from '../useLifecycleInstall';
import { NOTE_LINE } from './OverseerControls';

const NOTE_INK: Record<InstallNote['tone'], string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
};

export function InstallControl() {
  const { dl, tx, snapshot, missingCount, missingText, installing, install, installNote } = useLifecycleViewModel();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const installRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      {snapshot && missingCount > 0 && !installing && (
        <Button
          ref={installRef}
          variant="secondary"
          size="sm"
          icon={<Download className={GLYPH.sm} />}
          onClick={() => setConfirmOpen(true)}
          data-testid="lc-install"
        >
          {dl.lc_install}
        </Button>
      )}
      {installing && (
        <p className={`flex items-center gap-1.5 ${NOTE_LINE} ${LT.row} text-status-warning`} data-testid="lc-install-running">
          <span className="h-3 w-3 rounded-interactive border-2 border-dashed border-status-warning/80" aria-hidden />
          {dl.lc_install_running}
        </p>
      )}
      {/* The live region is always mounted and only its text changes, so the result is announced. */}
      <p role="status" className={installNote ? `${NOTE_LINE} ${LT.row} ${NOTE_INK[installNote.tone]}` : 'sr-only'} data-testid="lc-install-note">
        {installNote ? (installNote.cause ? `${installNote.text}: ${installNote.cause}` : installNote.text) : ''}
      </p>
      <ConfirmPopover
        open={confirmOpen}
        anchorRef={installRef}
        title={dl.lc_install_title}
        detail={tx(dl.lc_install_body, { items: missingText })}
        confirmLabel={dl.lc_install_confirm}
        confirmIcon={<Download className={GLYPH.sm} />}
        onConfirm={() => { setConfirmOpen(false); void install(); }}
        onCancel={() => setConfirmOpen(false)}
        width={380}
        testId="lc-install-confirm"
        confirmTestId="lc-install-confirm-go"
      />
    </>
  );
}
