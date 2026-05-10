import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  HardDrive,
  KeyRound,
  Mic,
  RefreshCw,
  ShieldCheck,
  Sliders,
} from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listConnectorResources,
  type ResourceItem,
} from '@/api/credentials/scopedResources';
import type { CompanionTtsEngine } from '@/stores/slices/system/companionPluginSlice';
import PiperVoicePanel from './PiperVoicePanel';
import { VoiceSettingsCard } from './VoicePanel';

/**
 * Variant A — "Wizard".
 *
 * The four jobs (engine, credential, voice, tune+enable) become
 * numbered steps with status pills (done / current / locked). Each
 * step is collapsed once complete, expands when active. The user
 * never sees more than one config card at a time, but always sees
 * the full progression. Inspired by linear-onboarding flows where
 * the next-best-action is always obvious.
 *
 * Direction: linear, guided, low-cognitive-load. Trades flexibility
 * (you can't randomly tweak one slider without scrolling past the
 * earlier steps) for momentum.
 */
type StepId = 'engine' | 'credential' | 'voice' | 'tune';

export default function VoicePanelVariantA() {
  const { t } = useTranslation();
  const engine = useSystemStore((s) => s.companionVoiceEngine);
  const setEngine = useSystemStore((s) => s.setCompanionVoiceEngine);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);

  const onSwitch = (next: CompanionTtsEngine) => {
    if (next === engine) return;
    setEngine(next);
    if (voiceEnabled) setVoiceEnabled(false);
  };

  // Step 1 is always "engine"; once an engine is chosen the step is done.
  // For ElevenLabs we then unlock steps 2-4. Piper takes its own panel.
  const [activeStep, setActiveStep] = useState<StepId>('credential');

  return (
    <div className="space-y-3 max-w-2xl">
      <WizardStep
        index={1}
        id="engine"
        title={t.plugins.companion.voice_engine_title}
        subtitle={t.plugins.companion.voice_engine_desc}
        status="done"
        active={false}
        onActivate={() => undefined}
      >
        <div className="grid grid-cols-2 gap-2">
          <EngineButton
            active={engine === 'elevenlabs'}
            onClick={() => onSwitch('elevenlabs')}
            icon={<Cloud className="w-4 h-4" />}
            label={t.plugins.companion.voice_engine_elevenlabs}
            caption={t.plugins.companion.voice_engine_elevenlabs_caption}
          />
          <EngineButton
            active={engine === 'piper'}
            onClick={() => onSwitch('piper')}
            icon={<HardDrive className="w-4 h-4" />}
            label={t.plugins.companion.voice_engine_piper}
            caption={t.plugins.companion.voice_engine_piper_caption}
          />
        </div>
      </WizardStep>

      {engine === 'piper' ? (
        <div className="rounded-card border border-foreground/10 bg-card-bg p-4">
          <PiperVoicePanel />
        </div>
      ) : (
        <ElevenLabsWizardSteps active={activeStep} onActivate={setActiveStep} />
      )}
    </div>
  );
}

function ElevenLabsWizardSteps({
  active,
  onActivate,
}: {
  active: StepId;
  onActivate: (s: StepId) => void;
}) {
  const { t } = useTranslation();
  const credentials = useVaultStore((s) => s.credentials);
  const fetchCredentials = useVaultStore((s) => s.fetchCredentials);
  const credentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const setCredentialId = useSystemStore((s) => s.setCompanionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const setVoiceId = useSystemStore((s) => s.setCompanionVoiceId);
  const enabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);

  const [credLoading, setCredLoading] = useState(true);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [liveVoices, setLiveVoices] = useState<ResourceItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchCredentials().finally(() => {
      if (!cancelled) setCredLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchCredentials]);

  const elevenlabsCreds = useMemo(
    () => credentials.filter((c) => c.service_type.toLowerCase() === 'elevenlabs'),
    [credentials],
  );
  const selectedCred = useMemo(
    () => elevenlabsCreds.find((c) => c.id === credentialId) ?? null,
    [elevenlabsCreds, credentialId],
  );

  useEffect(() => {
    if (!credentialId && elevenlabsCreds.length === 1 && elevenlabsCreds[0]) {
      setCredentialId(elevenlabsCreds[0].id);
    }
  }, [credentialId, elevenlabsCreds, setCredentialId]);

  const scopedVoices = useMemo<ResourceItem[]>(
    () => (selectedCred?.scopedResources?.voices ?? []) as ResourceItem[],
    [selectedCred],
  );
  const hasScope = scopedVoices.length > 0;

  const fetchLiveVoices = useCallback(
    async (bypassCache = false) => {
      if (!credentialId || hasScope) return;
      setVoicesLoading(true);
      setVoicesError(null);
      try {
        const items = await listConnectorResources(credentialId, 'voices', {}, bypassCache);
        setLiveVoices(items);
      } catch (e) {
        setVoicesError(e instanceof Error ? e.message : String(e));
        setLiveVoices([]);
      } finally {
        setVoicesLoading(false);
      }
    },
    [credentialId, hasScope],
  );

  useEffect(() => {
    if (!credentialId || hasScope) return;
    void fetchLiveVoices(false);
  }, [credentialId, hasScope, fetchLiveVoices]);

  const pickerVoices = hasScope ? scopedVoices : liveVoices;
  const isHealthy = selectedCred?.healthcheck_last_success === true;
  const canEnable = !!credentialId && !!voiceId?.trim();

  if (credLoading) {
    return (
      <div className="rounded-card border border-foreground/10 bg-card-bg p-5 flex items-center gap-3">
        <LoadingSpinner size="sm" />
        <span className="typo-body text-foreground/70">{t.plugins.companion.loading}</span>
      </div>
    );
  }

  if (elevenlabsCreds.length === 0) {
    return (
      <WizardStep
        index={2}
        id="credential"
        title={t.plugins.companion.voice_credential_title}
        subtitle={t.plugins.companion.voice_credential_desc}
        status="locked"
        active={true}
        onActivate={() => undefined}
      >
        <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-start gap-3">
            <KeyRound className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="typo-body font-medium">
                {t.plugins.companion.voice_empty_title}
              </div>
              <p className="typo-caption text-foreground/70 mt-1">
                {t.plugins.companion.voice_empty_desc}
              </p>
              <button
                onClick={() => setSidebarSection('credentials')}
                className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 typo-caption font-medium transition-colors focus-ring"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {t.plugins.companion.voice_empty_cta}
              </button>
            </div>
          </div>
        </div>
      </WizardStep>
    );
  }

  return (
    <>
      <WizardStep
        index={2}
        id="credential"
        title={t.plugins.companion.voice_credential_title}
        subtitle={t.plugins.companion.voice_credential_desc}
        status={credentialId ? 'done' : 'current'}
        statusLabel={
          selectedCred ? selectedCred.name : t.plugins.companion.voice_credential_pick
        }
        active={active === 'credential'}
        onActivate={() => onActivate('credential')}
      >
        {elevenlabsCreds.length > 1 ? (
          <select
            value={credentialId ?? ''}
            onChange={(e) => {
              setCredentialId(e.target.value || null);
              setVoiceId(null);
            }}
            className="w-full bg-secondary/40 border border-foreground/10 rounded-input px-3 py-2 typo-body focus-ring"
            aria-label={t.plugins.companion.voice_credential_picker_label}
          >
            <option value="">{t.plugins.companion.voice_credential_pick}</option>
            {elevenlabsCreds.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center gap-2 px-3 py-2 rounded-input bg-secondary/40 border border-foreground/10 typo-body">
            <KeyRound className="w-3.5 h-3.5 text-foreground/60" />
            <span className="truncate">{selectedCred?.name ?? '—'}</span>
            {selectedCred && (
              <span
                className={`ml-auto inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full ${
                  isHealthy
                    ? 'bg-status-success/10 text-status-success'
                    : 'bg-foreground/5 text-foreground/60'
                }`}
              >
                <ShieldCheck className="w-3 h-3" />
                {isHealthy
                  ? t.plugins.companion.voice_cred_healthy
                  : t.plugins.companion.voice_cred_unverified}
              </span>
            )}
          </div>
        )}
      </WizardStep>

      <WizardStep
        index={3}
        id="voice"
        title={t.plugins.companion.voice_pick_title}
        subtitle={t.plugins.companion.voice_pick_desc}
        status={!credentialId ? 'locked' : voiceId ? 'done' : 'current'}
        statusLabel={
          voiceId
            ? pickerVoices.find((v) => v.id === voiceId)?.label ?? voiceId.slice(0, 8) + '…'
            : undefined
        }
        active={active === 'voice'}
        onActivate={() => credentialId && onActivate('voice')}
      >
        {!credentialId ? (
          <p className="typo-caption text-foreground/50">
            {t.plugins.companion.voice_credential_pick}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <select
                value={
                  voiceId && pickerVoices.some((v) => v.id === voiceId) ? voiceId : ''
                }
                onChange={(e) => setVoiceId(e.target.value || null)}
                className="flex-1 bg-secondary/40 border border-foreground/10 rounded-input px-3 py-2 typo-body focus-ring disabled:opacity-50"
                disabled={voicesLoading || pickerVoices.length === 0}
                aria-label={t.plugins.companion.voice_pick_title}
              >
                <option value="">
                  {voicesLoading
                    ? t.plugins.companion.voice_pick_loading
                    : pickerVoices.length === 0
                      ? t.plugins.companion.voice_pick_no_voices
                      : t.plugins.companion.voice_pick_placeholder}
                </option>
                {pickerVoices.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                    {v.sublabel ? ` — ${v.sublabel}` : ''}
                  </option>
                ))}
              </select>
              {!hasScope && (
                <button
                  onClick={() => fetchLiveVoices(true)}
                  disabled={voicesLoading}
                  className="p-2 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground/70 hover:text-foreground transition-colors focus-ring disabled:opacity-50"
                  title={t.plugins.companion.voice_pick_refresh}
                  aria-label={t.plugins.companion.voice_pick_refresh}
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 ${voicesLoading ? 'animate-spin' : ''}`}
                  />
                </button>
              )}
            </div>
            <p className="typo-caption text-foreground/50">
              {hasScope
                ? t.plugins.companion.voice_pick_scoped_hint
                : t.plugins.companion.voice_pick_unscoped_hint}
            </p>
            {voicesError && (
              <p className="typo-caption text-status-warning">
                {t.plugins.companion.voice_pick_error} {voicesError}
              </p>
            )}
          </div>
        )}
      </WizardStep>

      <WizardStep
        index={4}
        id="tune"
        title={t.plugins.companion.voice_settings_title}
        subtitle={t.plugins.companion.voice_settings_desc}
        status={canEnable ? (enabled ? 'done' : 'current') : 'locked'}
        statusLabel={
          canEnable
            ? enabled
              ? t.plugins.companion.voice_enable_on
              : t.plugins.companion.voice_enable_off
            : undefined
        }
        active={active === 'tune'}
        onActivate={() => canEnable && onActivate('tune')}
      >
        <div className="space-y-3">
          <VoiceSettingsCard />
          <div className="rounded-card border border-foreground/10 bg-secondary/30 p-3 flex items-center gap-3">
            <Mic
              className={`w-4 h-4 shrink-0 ${
                enabled ? 'text-cyan-400' : 'text-foreground/40'
              }`}
            />
            <div className="flex-1 min-w-0">
              <div className="typo-body font-medium">
                {t.plugins.companion.voice_enable_label}
              </div>
              <div className="typo-caption text-foreground/60">
                {!canEnable
                  ? t.plugins.companion.voice_enable_blocked
                  : enabled
                    ? t.plugins.companion.voice_enable_on
                    : t.plugins.companion.voice_enable_off}
              </div>
            </div>
            <AccessibleToggle
              checked={enabled}
              onChange={() => canEnable && setEnabled(!enabled)}
              label={t.plugins.companion.voice_enable_label}
              disabled={!canEnable}
            />
          </div>
        </div>
      </WizardStep>
    </>
  );
}

function WizardStep({
  index,
  title,
  subtitle,
  status,
  statusLabel,
  active,
  onActivate,
  children,
}: {
  index: number;
  id: StepId;
  title: string;
  subtitle: string;
  status: 'done' | 'current' | 'locked';
  statusLabel?: string;
  active: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  const isExpanded = active || status === 'current';
  return (
    <div
      className={`rounded-card border bg-card-bg overflow-hidden transition-colors ${
        isExpanded
          ? 'border-cyan-500/30 shadow-elevation-1'
          : 'border-foreground/10'
      }`}
    >
      <button
        type="button"
        onClick={onActivate}
        disabled={status === 'locked'}
        className="w-full flex items-center gap-3 px-4 py-3 text-left disabled:cursor-not-allowed focus-ring"
      >
        <div
          className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center typo-caption font-semibold ${
            status === 'done'
              ? 'bg-status-success/15 text-status-success'
              : status === 'current'
                ? 'bg-cyan-500/15 text-cyan-300'
                : 'bg-foreground/5 text-foreground/40'
          }`}
        >
          {status === 'done' ? <CheckCircle2 className="w-4 h-4" /> : index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="typo-body font-medium">{title}</div>
          <div className="typo-caption text-foreground/60 mt-0.5">{subtitle}</div>
        </div>
        {statusLabel ? (
          <div className="shrink-0 typo-caption text-foreground/55 max-w-[140px] truncate">
            {statusLabel}
          </div>
        ) : null}
        <Sliders
          className={`w-3.5 h-3.5 shrink-0 transition-transform ${
            isExpanded ? 'rotate-90 text-cyan-300' : 'text-foreground/40'
          }`}
        />
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 pt-1 border-t border-foreground/5">{children}</div>
      )}
    </div>
  );
}

function EngineButton({
  active,
  onClick,
  icon,
  label,
  caption,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  caption: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-card border p-3 transition-colors focus-ring ${
        active
          ? 'border-cyan-500/50 bg-cyan-500/10'
          : 'border-foreground/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-cyan-300' : 'text-foreground/70'}>{icon}</span>
        <span className={`typo-body font-medium ${active ? 'text-cyan-200' : 'text-foreground'}`}>
          {label}
        </span>
      </div>
      <p className="typo-caption text-foreground/60 mt-1">{caption}</p>
    </button>
  );
}
