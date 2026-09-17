import { AlertTriangle, Check, ExternalLink } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { TtsEngineId } from '@/api/companion';
import type {
  CreateAthenaActions,
  CreateAthenaCard,
  InstallState,
} from '../../engine/createAthenaTypes';

/** Engine choice + the install that follows it. */

export function StageCardEnginePick({
  card,
  actions,
}: {
  card: Extract<CreateAthenaCard, { kind: 'engine_pick' }>;
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const copy: Record<TtsEngineId, { title: string; desc: string }> = {
    kokoro: { title: c.create_engine_kokoro_title, desc: c.create_engine_kokoro_desc },
    pocket_tts: { title: c.create_engine_pocket_title, desc: c.create_engine_pocket_desc },
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label={c.create_step_voice_engine}>
        {card.options.map((opt) => {
          const selected = opt.id === card.selected;
          return (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => actions.selectEngine(opt.id)}
              className={`text-left rounded-card border p-4 focus-ring transition-colors duration-fast motion-reduce:transition-none ${
                selected
                  ? 'border-primary bg-primary/10'
                  : 'border-foreground/10 bg-secondary/20 hover:bg-secondary/40'
              }`}
              data-testid={`create-athena-engine-${opt.id}`}
            >
              <div className="flex items-center gap-2">
                <span className="typo-title text-foreground">{copy[opt.id].title}</span>
                {opt.id === card.recommended && (
                  <span className="inline-flex items-center px-1.5 py-px rounded-pill bg-primary/15 text-primary typo-caption">
                    {c.create_recommended}
                  </span>
                )}
                <span
                  className={`ml-auto inline-flex items-center gap-1 typo-caption ${
                    opt.installed ? 'text-primary' : 'text-foreground/85'
                  }`}
                >
                  {opt.installed && <Check className="w-3 h-3" aria-hidden="true" />}
                  {opt.installed ? c.create_engine_installed : c.create_engine_needs_install}
                </span>
              </div>
              <p className="typo-caption text-foreground/85 mt-1.5">{copy[opt.id].desc}</p>
            </button>
          );
        })}
      </div>
      <p className="typo-caption text-foreground/85">{card.why}</p>
      <Button
        variant={card.confirmed ? 'secondary' : 'primary'}
        size="md"
        icon={card.confirmed ? <Check className="w-4 h-4 text-primary" aria-hidden="true" /> : undefined}
        onClick={actions.confirmEngine}
        data-testid="create-athena-engine-choose"
      >
        {c.create_engine_choose}
      </Button>
    </div>
  );
}

function InstallProgress({ state }: { state: InstallState }) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const label =
    state.phase === 'downloading_engine'
      ? c.create_install_phase_engine
      : state.phase === 'downloading_model'
        ? c.create_install_phase_model
        : c.create_install_phase_extract;
  const pct =
    state.bytesTotal && state.bytesTotal > 0
      ? Math.min(100, Math.round((state.bytesDownloaded / state.bytesTotal) * 100))
      : null;
  return (
    <div className="space-y-2" data-testid="create-athena-install-progress">
      <div className="flex items-center gap-2 typo-caption text-foreground">
        <span>{label}</span>
        <span className="ml-auto tabular-nums text-foreground/85">
          {pct !== null ? (
            <Numeric value={pct} unit="percent" precision={0} />
          ) : (
            <>
              <Numeric value={state.bytesDownloaded / (1024 * 1024)} precision={0} /> MB
            </>
          )}
        </span>
      </div>
      <div className="h-1.5 rounded-pill bg-secondary/60 overflow-hidden">
        <div
          className={`h-full rounded-pill bg-primary transition-[width] duration-normal motion-reduce:transition-none ${
            pct === null ? 'w-1/3 animate-pulse motion-reduce:animate-none' : ''
          }`}
          style={pct !== null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}

function ManualLink({ href, label }: { href: string | null; label: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary/15 hover:bg-primary/25 text-primary typo-caption font-medium transition-colors duration-fast motion-reduce:transition-none focus-ring"
    >
      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
      {label}
    </a>
  );
}

export function StageCardInstall({
  card,
  actions,
}: {
  card: Extract<CreateAthenaCard, { kind: 'install' }>;
  actions: CreateAthenaActions;
}) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const { state } = card;

  switch (state.phase) {
    case 'idle':
      return (
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
      );
    case 'downloading_engine':
    case 'downloading_model':
    case 'extracting':
      return <InstallProgress state={state} />;
    case 'completed':
    case 'not_needed':
      return (
        <p className="inline-flex items-center gap-2 typo-body text-foreground" data-testid="create-athena-install-done">
          <Check className="w-4 h-4 text-primary" aria-hidden="true" />
          {c.create_install_done}
        </p>
      );
    case 'failed':
      return (
        <div className="space-y-3" data-testid="create-athena-install-failed">
          <p className="flex items-start gap-2 typo-body text-foreground">
            <AlertTriangle className="w-4 h-4 mt-0.5 text-status-error shrink-0" aria-hidden="true" />
            <span>
              {c.create_install_failed}
              {state.error && <span className="block typo-caption text-foreground/85 mt-0.5">{state.error}</span>}
            </span>
          </p>
          <Button variant="primary" size="sm" onClick={actions.retryInstall} data-testid="create-athena-install-retry">
            {c.create_install_retry}
          </Button>
        </div>
      );
    case 'manual':
      return (
        <div className="space-y-3" data-testid="create-athena-install-manual">
          <h3 className="typo-title text-foreground">{c.create_install_manual_title}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <ManualLink href={state.engineDownloadUrl} label={c.create_install_engine_link} />
            <ManualLink href={state.modelDownloadUrl} label={c.create_install_model_link} />
          </div>
          <Button variant="secondary" size="sm" onClick={actions.recheckInstall} data-testid="create-athena-install-recheck">
            {c.create_install_recheck}
          </Button>
        </div>
      );
  }
}
