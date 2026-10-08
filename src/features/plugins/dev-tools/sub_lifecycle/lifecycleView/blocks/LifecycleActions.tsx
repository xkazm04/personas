/**
 * The surface's actions and its one load-failure door: Install into repo (only
 * while a binding is missing) and Ask Athena, plus the inline failure banner
 * that keeps a warm snapshot on screen. What an install attempt came to is
 * said here, beside the button that caused it, never in a toast.
 *
 * The "install running" line is a dashed square, not a spinner: this is a
 * background task reported by the backend, not a control the user just pressed.
 */
import { useRef, useState } from 'react';
import { Download, Sparkles } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { Banner } from '@/features/shared/components/feedback/Banner';
import { ConfirmPopover } from '@/features/shared/components/feedback/ConfirmPopover';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';

import { useLifecycleViewModel } from '../context';
import type { InstallNote } from '../useLifecycleInstall';
import { MeasureControl } from './MeasureControl';

const NOTE_INK: Record<InstallNote['tone'], string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
};

export function LifecycleActions() {
  const { dl, tx, projectName, snapshot, error, refetch, missingCount, missingText, installing, install, installNote, askAthena } =
    useLifecycleViewModel();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const installRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <ActionRow
        left={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {installing && (
              <span className="flex items-center gap-1.5 typo-body text-status-warning" data-testid="lc-install-running">
                <span className="w-3 h-3 rounded-interactive border-2 border-dashed border-status-warning/80" aria-hidden />
                {dl.lc_install_running}
              </span>
            )}
            {/* The live region is always mounted and only its text changes, so the result is announced. */}
            <span role="status" className={`typo-body ${installNote ? NOTE_INK[installNote.tone] : ''}`} data-testid="lc-install-note">
              {installNote ? (installNote.cause ? `${installNote.text}: ${installNote.cause}` : installNote.text) : ''}
            </span>
          </span>
        }
      >
        {snapshot && missingCount > 0 && !installing && (
          <Button
            ref={installRef}
            variant="secondary"
            size="sm"
            icon={<Download className="w-3.5 h-3.5" />}
            onClick={() => setConfirmOpen(true)}
            data-testid="lc-install"
          >
            {dl.lc_install}
          </Button>
        )}
        <MeasureControl />
        <Button
          variant="accent"
          tone="agent"
          size="sm"
          icon={<Sparkles className="w-3.5 h-3.5" />}
          onClick={askAthena}
          disabled={!projectName}
          data-testid="lc-ask-athena"
        >
          {dl.lc_ask_athena}
        </Button>
      </ActionRow>

      {error && <Banner severity="error" compact message={dl.lc_load_failed} cause={error} onRetry={refetch} />}

      <ConfirmPopover
        open={confirmOpen}
        anchorRef={installRef}
        title={dl.lc_install_title}
        detail={tx(dl.lc_install_body, { items: missingText })}
        confirmLabel={dl.lc_install_confirm}
        confirmIcon={<Download className="w-3.5 h-3.5" />}
        onConfirm={() => { setConfirmOpen(false); void install(); }}
        onCancel={() => setConfirmOpen(false)}
        width={380}
        testId="lc-install-confirm"
        confirmTestId="lc-install-confirm-go"
      />
    </>
  );
}
