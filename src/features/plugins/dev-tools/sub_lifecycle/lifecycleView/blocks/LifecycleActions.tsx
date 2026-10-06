/**
 * The surface's actions and its one load-failure door: Install into repo (only
 * while a binding is missing) and Ask Athena, plus the inline failure banner
 * that keeps a warm snapshot on screen.
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

export function LifecycleActions() {
  const { dl, tx, projectName, snapshot, error, refetch, missingCount, missingText, installing, install, askAthena } =
    useLifecycleViewModel();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const installRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <ActionRow
        left={installing ? (
          <span className="flex items-center gap-1.5 typo-caption text-status-warning" data-testid="lc-install-running">
            <span className="w-3 h-3 rounded-interactive border-2 border-dashed border-status-warning/80" aria-hidden />
            {dl.lc_install_running}
          </span>
        ) : undefined}
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
