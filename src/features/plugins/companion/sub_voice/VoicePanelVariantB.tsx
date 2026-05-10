import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Cloud,
  ExternalLink,
  HardDrive,
  KeyRound,
  Mic,
  RefreshCw,
  ShieldCheck,
  Volume2,
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
 * Variant B — "Live console".
 *
 * Single dense card layout: a left-column form with engine, credential,
 * voice, and tuning all visible at once; a sticky right-column "preview
 * chip" pinned to the corner that aggregates the live config (engine ·
 * voice · model · stability · enabled-state) and shows what would
 * synthesize right now. Inspired by audio-software studio inspectors —
 * everything tweakable at once, with a continuous status read-out.
 *
 * Direction: studio-grade density. Trades the gentle hand-holding of a
 * wizard for the speed of having every knob at thumb's reach. Right
 * for power users who already know their way around ElevenLabs.
 */
export default function VoicePanelVariantB() {
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4 max-w-4xl">
      <div className="space-y-3">
        <div className="rounded-card border border-foreground/10 bg-card-bg p-4">
          <div className="typo-label text-foreground/55 mb-2">
            {t.plugins.companion.voice_engine_title}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <EnginePill
              active={engine === 'elevenlabs'}
              onClick={() => onSwitch('elevenlabs')}
              icon={<Cloud className="w-3.5 h-3.5" />}
              label={t.plugins.companion.voice_engine_elevenlabs}
              caption={t.plugins.companion.voice_engine_elevenlabs_caption}
            />
            <EnginePill
              active={engine === 'piper'}
              onClick={() => onSwitch('piper')}
              icon={<HardDrive className="w-3.5 h-3.5" />}
              label={t.plugins.companion.voice_engine_piper}
              caption={t.plugins.companion.voice_engine_piper_caption}
            />
          </div>
        </div>

        {engine === 'piper' ? (
          <div className="rounded-card border border-foreground/10 bg-card-bg p-4">
            <PiperVoicePanel />
          </div>
        ) : (
          <ElevenLabsConsole />
        )}
      </div>

      <div className="lg:sticky lg:top-4 self-start">
        <PreviewChip />
      </div>
    </div>
  );
}

function ElevenLabsConsole() {
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
      <div className="rounded-card border border-foreground/10 bg-card-bg p-4 flex items-center gap-3">
        <LoadingSpinner size="sm" />
        <span className="typo-body text-foreground/70">{t.plugins.companion.loading}</span>
      </div>
    );
  }

  if (elevenlabsCreds.length === 0) {
    return (
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
    );
  }

  return (
    <div className="rounded-card border border-foreground/10 bg-card-bg p-4 space-y-4">
      <div>
        <div className="typo-label text-foreground/55 mb-2">
          {t.plugins.companion.voice_credential_title}
        </div>
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
      </div>

      <div className="border-t border-foreground/5 pt-4">
        <div className="typo-label text-foreground/55 mb-2 flex items-center justify-between">
          <span>{t.plugins.companion.voice_pick_title}</span>
          {!hasScope && credentialId && (
            <button
              onClick={() => fetchLiveVoices(true)}
              disabled={voicesLoading}
              className="inline-flex items-center gap-1 typo-caption font-normal text-foreground/55 hover:text-foreground/85 focus-ring rounded"
              title={t.plugins.companion.voice_pick_refresh}
            >
              <RefreshCw className={`w-3 h-3 ${voicesLoading ? 'animate-spin' : ''}`} />
              {t.plugins.companion.voice_pick_refresh}
            </button>
          )}
        </div>
        {!credentialId ? (
          <p className="typo-caption text-foreground/50 px-1">
            {t.plugins.companion.voice_credential_pick}
          </p>
        ) : (
          <>
            <select
              value={voiceId && pickerVoices.some((v) => v.id === voiceId) ? voiceId : ''}
              onChange={(e) => setVoiceId(e.target.value || null)}
              className="w-full bg-secondary/40 border border-foreground/10 rounded-input px-3 py-2 typo-body focus-ring disabled:opacity-50"
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
            <p className="typo-caption text-foreground/50 mt-1">
              {hasScope
                ? t.plugins.companion.voice_pick_scoped_hint
                : t.plugins.companion.voice_pick_unscoped_hint}
            </p>
            {voicesError && (
              <p className="typo-caption text-status-warning mt-1">
                {t.plugins.companion.voice_pick_error} {voicesError}
              </p>
            )}
          </>
        )}
      </div>

      <div className="border-t border-foreground/5 pt-4">
        <VoiceSettingsCard />
      </div>

      <div className="border-t border-foreground/5 pt-4 flex items-center gap-3">
        <Mic
          className={`w-4 h-4 shrink-0 ${enabled ? 'text-cyan-400' : 'text-foreground/40'}`}
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
  );
}

function PreviewChip() {
  const { t } = useTranslation();
  const engine = useSystemStore((s) => s.companionVoiceEngine);
  const credentialId = useSystemStore((s) => s.companionVoiceCredentialId);
  const voiceId = useSystemStore((s) => s.companionVoiceId);
  const enabled = useSystemStore((s) => s.companionVoiceEnabled);
  const model = useSystemStore((s) => s.companionVoiceModel);
  const stability = useSystemStore((s) => s.companionVoiceStability);
  const speed = useSystemStore((s) => s.companionVoiceSpeed);
  const credentials = useVaultStore((s) => s.credentials);
  const cred = credentials.find((c) => c.id === credentialId) ?? null;

  const lines: { label: string; value: string }[] = [
    { label: 'Engine', value: engine === 'piper' ? 'Piper (local)' : 'ElevenLabs (cloud)' },
    { label: 'Credential', value: cred?.name ?? '—' },
    { label: 'Voice', value: voiceId ? voiceId.slice(0, 12) + (voiceId.length > 12 ? '…' : '') : '—' },
    { label: 'Model', value: model ?? t.plugins.companion.voice_settings_default },
    { label: 'Stability', value: stability == null ? t.plugins.companion.voice_settings_default : stability.toFixed(2) },
    { label: 'Speed', value: speed == null ? t.plugins.companion.voice_settings_default : speed.toFixed(2) },
  ];

  return (
    <div className="rounded-card border border-foreground/10 bg-card-bg p-3 shadow-elevation-1">
      <div className="flex items-center gap-2 mb-2">
        <span
          className={`inline-flex items-center justify-center w-7 h-7 rounded-full ${
            enabled
              ? 'bg-status-success/15 text-status-success'
              : 'bg-foreground/5 text-foreground/45'
          }`}
        >
          <Volume2 className="w-3.5 h-3.5" />
        </span>
        <div className="min-w-0">
          <div className="typo-body font-semibold leading-tight">
            {enabled ? 'Live' : 'Idle'}
          </div>
          <div className="typo-caption text-foreground/55 leading-tight">
            {enabled
              ? t.plugins.companion.voice_enable_on
              : t.plugins.companion.voice_enable_off}
          </div>
        </div>
      </div>
      <dl className="space-y-1 border-t border-foreground/5 pt-2">
        {lines.map((line) => (
          <div key={line.label} className="flex items-center gap-2">
            <dt className="typo-caption text-foreground/55 w-[68px] shrink-0 uppercase tracking-wide">
              {line.label}
            </dt>
            <dd className="typo-caption text-foreground/85 truncate flex-1 text-right tabular-nums">
              {line.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function EnginePill({
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
      className={`text-left rounded-card border px-3 py-2 transition-colors focus-ring ${
        active
          ? 'border-cyan-500/50 bg-cyan-500/10'
          : 'border-foreground/10 bg-secondary/20 hover:bg-secondary/40'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={active ? 'text-cyan-300' : 'text-foreground/70'}>{icon}</span>
        <span
          className={`typo-body font-medium ${
            active ? 'text-cyan-200' : 'text-foreground'
          }`}
        >
          {label}
        </span>
      </div>
      <p className="typo-caption text-foreground/60 mt-0.5">{caption}</p>
    </button>
  );
}
