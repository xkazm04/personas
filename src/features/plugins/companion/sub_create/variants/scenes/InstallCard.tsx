import { Check, ExternalLink } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { openExternalUrl } from '@/api/system/system';
import { toastCatch } from '@/lib/silentCatch';
import { CSS_DURATION_CLASS } from '@/lib/utils/animation/animationPresets';
import type { CreateAthenaActions, CreateAthenaCard, InstallState } from '../../engine/createAthenaTypes';

type Install = Extract<CreateAthenaCard, { kind: 'install' }>;

const BUSY_PHASES = new Set<InstallState['phase']>(['downloading_engine', 'downloading_model', 'extracting']);

function ProgressBar({ state, label }: { state: InstallState; label: string }) {
  const ratio = state.bytesTotal ? Math.min(1, state.bytesDownloaded / state.bytesTotal) : null;
  return (
    <div className="flex w-full flex-col gap-2" data-testid="create-athena-install-progress">
      <div className="flex items-center justify-between gap-3">
        <span className="typo-caption">{label}</span>
        {ratio !== null && (
          <span className="typo-data">
            <Numeric value={ratio} unit="ratio" precision={0} />
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={ratio === null ? undefined : Math.round(ratio * 100)}
        className="h-1 w-full overflow-hidden rounded-pill bg-secondary/60"
      >
        <div
          className={`h-full rounded-pill bg-primary transition-[width] ${CSS_DURATION_CLASS.smooth}`}
          style={{ width: ratio === null ? '100%' : `${ratio * 100}%`, opacity: ratio === null ? 0.35 : 1 }}
        />
      </div>
    </div>
  );
}

function openLink(url: string) {
  openExternalUrl(url).catch(toastCatch('CreateAthenaScenes:openInstallLink'));
}

/**
 * install — the whole card is a function of `state.phase`: a single start,
 * a thin progress band while it works, a done mark, a retry on failure, or
 * the two download links when auto-install is not possible here.
 */
export function InstallCard({ card, actions }: { card: Install; actions: CreateAthenaActions }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { state } = card;

  if (state.phase === 'idle') {
    return (
      <AsyncButton variant="primary" size="lg" onClick={actions.startInstall} data-testid="create-athena-install-start">
        {c.create_install_start}
      </AsyncButton>
    );
  }

  if (BUSY_PHASES.has(state.phase)) {
    const label =
      state.phase === 'downloading_engine'
        ? c.create_install_phase_engine
        : state.phase === 'downloading_model'
          ? c.create_install_phase_model
          : c.create_install_phase_extract;
    return <ProgressBar state={state} label={label} />;
  }

  if (state.phase === 'failed') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="typo-body text-status-error" data-testid="create-athena-install-error">
          {state.error ?? c.create_install_failed}
        </p>
        <AsyncButton variant="primary" size="lg" onClick={actions.retryInstall} data-testid="create-athena-install-retry">
          {c.create_install_retry}
        </AsyncButton>
      </div>
    );
  }

  if (state.phase === 'manual') {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="create-athena-install-manual">
        <p className="typo-title-lg text-foreground">{c.create_install_manual_title}</p>
        <div className="flex flex-wrap gap-2">
          {state.engineDownloadUrl && (
            <Button variant="secondary" iconRight={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => openLink(state.engineDownloadUrl!)}>
              {c.create_install_engine_link}
            </Button>
          )}
          {state.modelDownloadUrl && (
            <Button variant="secondary" iconRight={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => openLink(state.modelDownloadUrl!)}>
              {c.create_install_model_link}
            </Button>
          )}
        </div>
        <AsyncButton variant="primary" onClick={actions.recheckInstall} data-testid="create-athena-install-recheck">
          {c.create_install_recheck}
        </AsyncButton>
      </div>
    );
  }

  // completed | not_needed
  return (
    <p className="typo-title-lg flex items-center gap-2 text-status-success" data-testid="create-athena-install-done">
      <Check className="h-4 w-4" aria-hidden="true" />
      {c.create_install_done}
    </p>
  );
}
