import { useCallback, useEffect, useMemo, useState } from 'react';
import { Cloud, ExternalLink, HardDrive, KeyRound, Mic, RefreshCw, RotateCcw, ShieldCheck } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Slider } from '@/features/shared/components/forms/Slider';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listConnectorResources,
  type ResourceItem,
} from '@/api/credentials/scopedResources';
import {
  COMPANION_VOICE_MODELS,
  type CompanionTtsEngine,
  type CompanionVoiceModel,
} from '@/stores/slices/system/companionPluginSlice';
import PiperVoicePanel from './PiperVoicePanel';
import SttPanel from './SttPanel';
import { debtText } from '@/i18n/DebtText';


/**
 * Voice tab entry point. Owns the engine segmented control at the top
 * and dispatches to either the ElevenLabs panel (cloud, credential-
 * gated) or the Piper panel (local, voice-download-gated). Splitting
 * by engine keeps each panel's state contract narrow — switching
 * engines doesn't bleed credential picking into Piper or vice versa.
 */
export default function VoicePanel() {
  const engine = useSystemStore((s) => s.companionVoiceEngine);
  return (
    <div className="space-y-4 max-w-2xl">
      <EngineSelectorCard />
      {engine === 'piper' ? <PiperVoicePanel /> : <ElevenLabsVoicePanel />}
      <SttPanel />
    </div>
  );
}

function EngineSelectorCard() {
  const { t } = useTranslation();
  const engine = useSystemStore((s) => s.companionVoiceEngine);
  const setEngine = useSystemStore((s) => s.setCompanionVoiceEngine);
  const voiceEnabled = useSystemStore((s) => s.companionVoiceEnabled);
  const setVoiceEnabled = useSystemStore((s) => s.setCompanionVoiceEnabled);
  const volume = useSystemStore((s) => s.companionVoiceVolume);
  const setVolume = useSystemStore((s) => s.setCompanionVoiceVolume);

  // Switching engines invalidates the playback gate — disable until the
  // new engine reports it's configured. Avoids a state where the toggle
  // says "on" but the synthesis path silently falls back / errors.
  const onSwitch = (next: CompanionTtsEngine) => {
    if (next === engine) return;
    setEngine(next);
    if (voiceEnabled) setVoiceEnabled(false);
  };

  return (
    <SectionCard
      title={t.plugins.companion.voice_engine_title}
      subtitle={t.plugins.companion.voice_engine_desc}
      titleClassName="text-primary"
    >
      <div className="grid grid-cols-2 gap-2 px-1 py-2">
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

      {/* Playback volume — engine-agnostic; mirrors the chat toolbar's
          voice popover (both bind `companionVoiceVolume`). */}
      <div className="px-1 pt-1 pb-2 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="typo-caption text-foreground font-medium">
            {t.plugins.companion.voice_volume_label}
          </label>
          <span className="typo-code text-[11px] text-foreground">{Math.round(volume * 100)}%</span>
        </div>
        <Slider
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(v) => setVolume(v)}
          ariaLabel={t.plugins.companion.voice_volume_label}
          showBubble={false}
        />
      </div>
    </SectionCard>
  );
}

interface EngineButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  caption: string;
}

function EngineButton({ active, onClick, icon, label, caption }: EngineButtonProps) {
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
        <span className={active ? 'text-cyan-300' : 'text-foreground'}>{icon}</span>
        <span
          className={`typo-body font-medium ${active ? 'text-cyan-200' : 'text-foreground'}`}
        >
          {label}
        </span>
      </div>
      <p className="typo-caption text-foreground mt-1">{caption}</p>
    </button>
  );
}

/**
 * ElevenLabs voice configuration — credential picker, voice id, tuning
 * sliders, master enable. Mounted by `VoicePanel` when the engine
 * selector is on `'elevenlabs'`.
 *
 * Voice picking has three layers, in order of preference:
 *   1. If the selected credential has scoped `voices`, use that pinned set —
 *      the user already curated it during scope save.
 *   2. Otherwise live-list every voice on the account via the same
 *      `list_connector_resources` command the scope picker uses, so users
 *      with no scope still get a real dropdown.
 *   3. As a last resort (or for power users with a voice id from elsewhere),
 *      a "Use a custom voice id" disclosure exposes the raw text input.
 */
function ElevenLabsVoicePanel() {
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
  const [showCustomId, setShowCustomId] = useState(false);

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
    () =>
      credentials.filter(
        (c) => c.service_type.toLowerCase() === 'elevenlabs',
      ),
    [credentials],
  );

  // Auto-select the first credential when there's exactly one and none picked.
  useEffect(() => {
    if (
      !credentialId &&
      elevenlabsCreds.length === 1 &&
      elevenlabsCreds[0]
    ) {
      setCredentialId(elevenlabsCreds[0].id);
    }
  }, [credentialId, elevenlabsCreds, setCredentialId]);

  // Drop the picked id if the credential is gone.
  useEffect(() => {
    if (
      credentialId &&
      !elevenlabsCreds.some((c) => c.id === credentialId)
    ) {
      setCredentialId(null);
      if (enabled) setEnabled(false);
    }
  }, [credentialId, elevenlabsCreds, setCredentialId, enabled, setEnabled]);

  const selectedCred = useMemo(
    () => elevenlabsCreds.find((c) => c.id === credentialId) ?? null,
    [elevenlabsCreds, credentialId],
  );

  // Voices pinned by the scope picker, if any.
  const scopedVoices = useMemo<ResourceItem[]>(() => {
    const picks = selectedCred?.scopedResources?.voices ?? [];
    return picks as ResourceItem[];
  }, [selectedCred]);

  // Models pinned by the scope picker, if any — drives the model dropdown
  // in VoiceSettingsCard so it reflects what the user scoped (voice already
  // did; the model didn't).
  const scopedModels = useMemo<ResourceItem[]>(() => {
    const picks = selectedCred?.scopedResources?.models ?? [];
    return picks as ResourceItem[];
  }, [selectedCred]);

  const hasScope = scopedVoices.length > 0;

  // Live-list voices when there's no scope (or when the user refreshes).
  // We bail when the scope is present — the picks are authoritative.
  const fetchLiveVoices = useCallback(
    async (bypassCache = false) => {
      if (!credentialId || hasScope) return;
      setVoicesLoading(true);
      setVoicesError(null);
      try {
        const items = await listConnectorResources(
          credentialId,
          'voices',
          {},
          bypassCache,
        );
        setLiveVoices(items);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setVoicesError(msg);
        setLiveVoices([]);
      } finally {
        setVoicesLoading(false);
      }
    },
    [credentialId, hasScope],
  );

  useEffect(() => {
    if (!credentialId) {
      setLiveVoices([]);
      setVoicesError(null);
      return;
    }
    if (hasScope) {
      // Drop any stale live list — we won't render it.
      setLiveVoices([]);
      setVoicesError(null);
      return;
    }
    void fetchLiveVoices(false);
  }, [credentialId, hasScope, fetchLiveVoices]);

  // The picker source: scoped picks take priority.
  const pickerVoices = hasScope ? scopedVoices : liveVoices;

  // If the persisted voiceId no longer appears in the available set,
  // surface that by showing the custom-id input pre-expanded so the user
  // can see what's stored without losing it on render.
  useEffect(() => {
    if (!voiceId) return;
    if (pickerVoices.length === 0) return;
    if (!pickerVoices.some((v) => v.id === voiceId)) {
      setShowCustomId(true);
    }
  }, [voiceId, pickerVoices]);

  if (credLoading) {
    return (
      <div className="flex items-center gap-3 p-5 typo-body text-foreground">
        <LoadingSpinner size="sm" />
        <span>{t.plugins.companion.loading}</span>
      </div>
    );
  }

  if (elevenlabsCreds.length === 0) {
    return (
      <div>
        <SectionCard
          title={t.plugins.companion.voice_title}
          subtitle={t.plugins.companion.voice_subtitle}
          titleClassName="text-primary"
        >
          <div className="px-1 py-3 space-y-3">
            <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <KeyRound className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="typo-body font-medium text-foreground">
                    {t.plugins.companion.voice_empty_title}
                  </div>
                  <p className="typo-caption text-foreground mt-1">
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
          </div>
        </SectionCard>
      </div>
    );
  }

  const isHealthy = selectedCred?.healthcheck_last_success === true;
  const canEnable = !!credentialId && !!voiceId?.trim();

  return (
    <div className="space-y-4">
      <SectionCard
        title={t.plugins.companion.voice_credential_title}
        subtitle={t.plugins.companion.voice_credential_desc}
        titleClassName="text-primary"
      >
        <div className="px-1 py-2 space-y-3">
          {elevenlabsCreds.length > 1 ? (
            <ThemedSelect
              filterable
              options={elevenlabsCreds.map((c) => ({ value: c.id, label: c.name }))}
              value={credentialId ?? ''}
              onValueChange={(v) => {
                setCredentialId(v || null);
                // Reset the voice selection when the cred changes — the new
                // cred has a different scope (or none) and a different
                // voice library, so the previously picked id rarely
                // applies. The custom-id disclosure reopens automatically
                // if the persisted voiceId can't be found.
                setVoiceId(null);
                setShowCustomId(false);
              }}
              placeholder={t.plugins.companion.voice_credential_pick}
              aria-label={t.plugins.companion.voice_credential_picker_label}
            />
          ) : (
            <div className="flex items-center gap-2 px-3 py-2 rounded-input bg-secondary/40 border border-foreground/10 typo-body">
              <KeyRound className="w-3.5 h-3.5 text-foreground" />
              <span className="truncate">{selectedCred?.name ?? '—'}</span>
              {selectedCred && (
                <span
                  className={`ml-auto inline-flex items-center gap-1 typo-caption px-2 py-0.5 rounded-full ${
                    isHealthy
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-foreground/5 text-foreground'
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
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.voice_pick_title}
        subtitle={t.plugins.companion.voice_pick_desc}
        titleClassName="text-primary"
      >
        <div className="px-1 py-2 space-y-2">
          {!credentialId ? (
            <p className="typo-caption text-foreground">
              {t.plugins.companion.voice_credential_pick}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <ThemedSelect
                  filterable
                  wrapperClassName="flex-1"
                  options={pickerVoices.map((v) => ({
                    value: v.id,
                    label: v.sublabel ? `${v.label} — ${v.sublabel}` : v.label,
                  }))}
                  value={
                    voiceId && pickerVoices.some((v) => v.id === voiceId)
                      ? voiceId
                      : ''
                  }
                  onValueChange={(v) => setVoiceId(v || null)}
                  disabled={voicesLoading || pickerVoices.length === 0}
                  placeholder={
                    voicesLoading
                      ? t.plugins.companion.voice_pick_loading
                      : pickerVoices.length === 0
                        ? t.plugins.companion.voice_pick_no_voices
                        : t.plugins.companion.voice_pick_placeholder
                  }
                  aria-label={t.plugins.companion.voice_pick_title}
                />
                {!hasScope && (
                  <button
                    onClick={() => fetchLiveVoices(true)}
                    disabled={voicesLoading}
                    className="p-2 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground hover:text-foreground transition-colors focus-ring disabled:opacity-50"
                    title={t.plugins.companion.voice_pick_refresh}
                    aria-label={t.plugins.companion.voice_pick_refresh}
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${voicesLoading ? 'animate-spin' : ''}`}
                    />
                  </button>
                )}
              </div>

              <p className="typo-caption text-foreground">
                {hasScope
                  ? t.plugins.companion.voice_pick_scoped_hint
                  : t.plugins.companion.voice_pick_unscoped_hint}
              </p>

              {voicesError && (
                <p className="typo-caption text-status-warning">
                  {t.plugins.companion.voice_pick_error} {voicesError}
                </p>
              )}

              <button
                type="button"
                onClick={() => setShowCustomId((v) => !v)}
                className="typo-caption text-foreground hover:text-foreground/80 underline-offset-2 hover:underline transition-colors"
              >
                {t.plugins.companion.voice_pick_custom_toggle}
              </button>

              {showCustomId && (
                <div className="space-y-1 pt-1">
                  <input
                    type="text"
                    value={voiceId ?? ''}
                    onChange={(e) => setVoiceId(e.target.value || null)}
                    placeholder={debtText("auto_e_g_21m00tcm4tlvdq8ikwam_8f2f27fb")}
                    spellCheck={false}
                    className="w-full bg-secondary/40 border border-foreground/10 rounded-input px-3 py-2 typo-code focus-ring"
                    aria-label={t.plugins.companion.voice_id_label}
                  />
                  <p className="typo-caption text-foreground">
                    {t.plugins.companion.voice_id_hint}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </SectionCard>

      <VoiceSettingsCard scopedModels={scopedModels} />

      <SectionCard
        title={t.plugins.companion.voice_enable_title}
        subtitle={t.plugins.companion.voice_enable_desc}
        titleClassName="text-primary"
      >
        <div className="flex items-start gap-3 px-1 py-2">
          <Mic
            className={`w-4 h-4 mt-0.5 shrink-0 ${enabled ? 'text-cyan-400' : 'text-foreground'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium">
              {t.plugins.companion.voice_enable_label}
            </div>
            <div className="typo-caption text-foreground mt-0.5">
              {!canEnable
                ? t.plugins.companion.voice_enable_blocked
                : enabled
                  ? t.plugins.companion.voice_enable_on
                  : t.plugins.companion.voice_enable_off}
            </div>
          </div>
          <div className="shrink-0">
            <AccessibleToggle
              checked={enabled}
              onChange={() => canEnable && setEnabled(!enabled)}
              label={t.plugins.companion.voice_enable_label}
              disabled={!canEnable}
            />
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

/**
 * Voice tuning section — model + 4 sliders. Each control writes to a
 * dedicated systemStore key; `null` means "let the backend apply its
 * default" so a fresh install (or a user who hits Reset) sends the
 * smallest possible payload.
 */
function VoiceSettingsCard({ scopedModels }: { scopedModels: ResourceItem[] }) {
  const { t } = useTranslation();

  const model = useSystemStore((s) => s.companionVoiceModel);
  const setModel = useSystemStore((s) => s.setCompanionVoiceModel);
  const stability = useSystemStore((s) => s.companionVoiceStability);
  const setStability = useSystemStore((s) => s.setCompanionVoiceStability);
  const similarity = useSystemStore((s) => s.companionVoiceSimilarity);
  const setSimilarity = useSystemStore((s) => s.setCompanionVoiceSimilarity);
  const speed = useSystemStore((s) => s.companionVoiceSpeed);
  const setSpeed = useSystemStore((s) => s.setCompanionVoiceSpeed);
  const style = useSystemStore((s) => s.companionVoiceStyle);
  const setStyle = useSystemStore((s) => s.setCompanionVoiceStyle);
  const reset = useSystemStore((s) => s.resetCompanionVoiceSettings);

  const isCustomized =
    model != null || stability != null || similarity != null || speed != null || style != null;

  const modelLabel: Record<CompanionVoiceModel, string> = {
    eleven_turbo_v2_5: t.plugins.companion.voice_settings_model_turbo,
    eleven_flash_v2_5: t.plugins.companion.voice_settings_model_flash,
    eleven_multilingual_v2: t.plugins.companion.voice_settings_model_multilingual,
    eleven_v3: t.plugins.companion.voice_settings_model_v3,
  };

  // When the credential scopes models, narrow the dropdown to that subset of
  // the curated allowlist (and prefer the scope's live label). Falls back to
  // the full curated list when nothing's scoped or the scope is all
  // off-allowlist ids. Keeps the value type-safe (CompanionVoiceModel).
  const scopeLabelById = new Map(scopedModels.map((m) => [m.id, m.label] as const));
  const scopedIds = new Set(scopedModels.map((m) => m.id));
  const scopedSubset = COMPANION_VOICE_MODELS.filter((m) => scopedIds.has(m));
  const modelOptions = scopedSubset.length > 0 ? scopedSubset : COMPANION_VOICE_MODELS;

  return (
    <SectionCard
      title={t.plugins.companion.voice_settings_title}
      subtitle={t.plugins.companion.voice_settings_desc}
      titleClassName="text-primary"
    >
      <div className="px-1 py-2 space-y-4">
        {/* Model dropdown */}
        <div className="space-y-1">
          <label className="typo-caption text-foreground font-medium">
            {t.plugins.companion.voice_settings_model_label}
          </label>
          <ThemedSelect
            filterable
            hideSearch
            options={[
              { value: '', label: t.plugins.companion.voice_settings_default },
              ...modelOptions.map((m) => ({
                value: m,
                label: scopeLabelById.get(m) ?? modelLabel[m],
              })),
            ]}
            value={model ?? ''}
            onValueChange={(v) =>
              setModel(v === '' ? null : (v as CompanionVoiceModel))
            }
            aria-label={t.plugins.companion.voice_settings_model_label}
          />
          <p className="typo-caption text-foreground">
            {t.plugins.companion.voice_settings_model_hint}
          </p>
        </div>

        {/* Fine-tuning sliders — grouped under a hairline divider so they
            read as one band, separated from the model selector above. */}
        <div className="space-y-3 border-t border-primary/8 pt-3">
        <SliderRow
          label={t.plugins.companion.voice_settings_stability_label}
          hint={t.plugins.companion.voice_settings_stability_hint}
          value={stability}
          onChange={setStability}
          min={0}
          max={1}
          step={0.05}
          defaultLabel={t.plugins.companion.voice_settings_default}
        />
        <SliderRow
          label={t.plugins.companion.voice_settings_similarity_label}
          hint={t.plugins.companion.voice_settings_similarity_hint}
          value={similarity}
          onChange={setSimilarity}
          min={0}
          max={1}
          step={0.05}
          defaultLabel={t.plugins.companion.voice_settings_default}
        />
        <SliderRow
          label={t.plugins.companion.voice_settings_speed_label}
          hint={t.plugins.companion.voice_settings_speed_hint}
          value={speed}
          onChange={setSpeed}
          min={0.7}
          max={1.2}
          step={0.05}
          defaultLabel={t.plugins.companion.voice_settings_default}
        />
        <SliderRow
          label={t.plugins.companion.voice_settings_style_label}
          hint={t.plugins.companion.voice_settings_style_hint}
          value={style}
          onChange={setStyle}
          min={0}
          max={1}
          step={0.05}
          defaultLabel={t.plugins.companion.voice_settings_default}
        />
        </div>

        {isCustomized && (
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-secondary/40 hover:bg-secondary/60 border border-foreground/10 text-foreground hover:text-foreground typo-caption transition-colors focus-ring"
          >
            <RotateCcw className="w-3 h-3" />
            {t.plugins.companion.voice_settings_reset}
          </button>
        )}
      </div>
    </SectionCard>
  );
}

interface SliderRowProps {
  label: string;
  hint: string;
  value: number | null;
  onChange: (v: number | null) => void;
  min: number;
  max: number;
  step: number;
  defaultLabel: string;
}

function SliderRow({ label, hint, value, onChange, min, max, step, defaultLabel }: SliderRowProps) {
  const display = value == null ? defaultLabel : value.toFixed(2);
  // Slider value when "default" is selected: render the midpoint of the
  // band so the user can see where they're starting from before they
  // commit. The actual stored value stays null until the user moves it.
  const sliderValue = value ?? (min + max) / 2;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="typo-caption text-foreground font-medium">{label}</label>
        <span className="typo-code text-foreground text-[11px]">{display}</span>
      </div>
      <div className="flex items-center gap-2">
        <Slider
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={(v) => onChange(v)}
          ariaLabel={label}
          showBubble={false}
          className="flex-1"
        />
        {value != null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-foreground hover:text-foreground/80 transition-colors"
            title={defaultLabel}
            aria-label={defaultLabel}
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>
      <p className="typo-caption text-foreground">{hint}</p>
    </div>
  );
}
