import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { openExternalUrl } from '@/api/system/system';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import type { CreateAthenaCard, CreateAthenaEngine, InstallState } from '../../engine/createAthenaTypes';

type InstallData = Extract<CreateAthenaCard, { kind: 'install' }>;

/**
 * Engine + model install, one face per `state.phase`: start → a byte-driven
 * progress bar with a phase label → done + Continue, or failed + retry, or
 * the manual path (two download links + "Check again") where auto-install
 * is unavailable. Skip stays available in the shell's corner throughout.
 */
export function InstallCard({ card, engine }: { card: InstallData; engine: CreateAthenaEngine }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { actions, canNext } = engine;
  const { state } = card;

  const open = (url: string | null) => () => {
    if (url) openExternalUrl(url).catch(silentCatch('create-athena:install-link'));
  };

  switch (state.phase) {
    case 'idle':
      return (
        <div className="flex justify-end">
          <AsyncButton
            variant="primary"
            size="md"
            onClick={async () => {
              actions.startInstall();
            }}
            data-testid="create-athena-install-start"
          >
            {c.create_install_start}
          </AsyncButton>
        </div>
      );
    case 'downloading_engine':
    case 'downloading_model':
    case 'extracting':
      return <InstallProgress state={state} label={phaseLabel(state.phase, c)} />;
    case 'completed':
    case 'not_needed':
      return (
        <div className="flex items-center justify-between gap-3">
          <p className="typo-body text-foreground" data-testid="create-athena-install-done">
            {c.create_install_done}
          </p>
          <Button variant="primary" size="sm" disabled={!canNext} onClick={actions.next} data-testid="create-athena-next">
            {c.create_next}
          </Button>
        </div>
      );
    case 'failed':
      return (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="typo-label text-destructive">{c.create_install_failed}</p>
            {state.error && (
              <p className="typo-caption text-foreground/85 break-words" data-testid="create-athena-install-error">
                {state.error}
              </p>
            )}
          </div>
          <Button variant="secondary" size="sm" onClick={actions.retryInstall} data-testid="create-athena-install-retry">
            {c.create_install_retry}
          </Button>
        </div>
      );
    case 'manual':
      return (
        <>
          <p className="typo-label text-foreground">{c.create_install_manual_title}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="link" size="sm" disabled={!state.engineDownloadUrl} onClick={open(state.engineDownloadUrl)} data-testid="create-athena-install-engine-link">
              {c.create_install_engine_link}
            </Button>
            <Button variant="link" size="sm" disabled={!state.modelDownloadUrl} onClick={open(state.modelDownloadUrl)} data-testid="create-athena-install-model-link">
              {c.create_install_model_link}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" onClick={actions.recheckInstall} data-testid="create-athena-install-recheck">
              {c.create_install_recheck}
            </Button>
          </div>
        </>
      );
  }
}

function phaseLabel(
  phase: 'downloading_engine' | 'downloading_model' | 'extracting',
  c: { create_install_phase_engine: string; create_install_phase_model: string; create_install_phase_extract: string },
): string {
  if (phase === 'downloading_engine') return c.create_install_phase_engine;
  if (phase === 'downloading_model') return c.create_install_phase_model;
  return c.create_install_phase_extract;
}

function InstallProgress({ state, label }: { state: InstallState; label: string }) {
  const determinate = state.bytesTotal !== null && state.bytesTotal > 0;
  const pct = determinate
    ? Math.min(100, Math.round((state.bytesDownloaded / (state.bytesTotal ?? 1)) * 100))
    : null;
  return (
    <div className="flex flex-col gap-2" data-testid="create-athena-install-progress">
      <div className="flex items-center justify-between gap-2">
        <span className="typo-caption text-foreground/85">{label}</span>
        {pct !== null && <span className="typo-data text-foreground/85">{pct}%</span>}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="h-1.5 w-full rounded-pill bg-secondary/60 overflow-hidden"
      >
        <div
          className="h-full rounded-pill bg-primary transition-[width] duration-ease motion-reduce:transition-none"
          style={{ width: pct !== null ? `${pct}%` : '35%' }}
        />
      </div>
    </div>
  );
}
