import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, KeyRound, Mic, RefreshCw, ShieldCheck } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useTranslation } from '@/i18n/useTranslation';
import {
  listConnectorResources,
  type ResourceItem,
} from '@/api/credentials/scopedResources';

/**
 * Voice tab — bind ElevenLabs credentials to a voice id, then toggle
 * voice playback on. Playback in chat is downstream; this panel only
 * handles the configuration side.
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
export default function VoicePanel() {
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
      <div className="flex items-center gap-3 p-5 typo-body text-foreground/70">
        <LoadingSpinner size="sm" />
        <span>{t.plugins.companion.loading}</span>
      </div>
    );
  }

  if (elevenlabsCreds.length === 0) {
    return (
      <div className="max-w-2xl">
        <SectionCard
          title={t.plugins.companion.voice_title}
          subtitle={t.plugins.companion.voice_subtitle}
        >
          <div className="px-1 py-3 space-y-3">
            <div className="rounded-card border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="flex items-start gap-3">
                <KeyRound className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="typo-body font-medium text-foreground">
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
          </div>
        </SectionCard>
      </div>
    );
  }

  const isHealthy = selectedCred?.healthcheck_last_success === true;
  const canEnable = !!credentialId && !!voiceId?.trim();

  return (
    <div className="space-y-4 max-w-2xl">
      <SectionCard
        title={t.plugins.companion.voice_credential_title}
        subtitle={t.plugins.companion.voice_credential_desc}
      >
        <div className="px-1 py-2 space-y-3">
          {elevenlabsCreds.length > 1 ? (
            <select
              value={credentialId ?? ''}
              onChange={(e) => {
                setCredentialId(e.target.value || null);
                // Reset the voice selection when the cred changes — the new
                // cred has a different scope (or none) and a different
                // voice library, so the previously picked id rarely
                // applies. The custom-id disclosure reopens automatically
                // if the persisted voiceId can't be found.
                setVoiceId(null);
                setShowCustomId(false);
              }}
              className="w-full bg-secondary/40 border border-foreground/10 rounded-input px-3 py-2 typo-body focus-ring"
              aria-label={t.plugins.companion.voice_credential_picker_label}
            >
              <option value="">
                {t.plugins.companion.voice_credential_pick}
              </option>
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
                      ? 'bg-emerald-500/10 text-emerald-400'
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
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.voice_pick_title}
        subtitle={t.plugins.companion.voice_pick_desc}
      >
        <div className="px-1 py-2 space-y-2">
          {!credentialId ? (
            <p className="typo-caption text-foreground/50">
              {t.plugins.companion.voice_credential_pick}
            </p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <select
                  value={
                    voiceId && pickerVoices.some((v) => v.id === voiceId)
                      ? voiceId
                      : ''
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

              <button
                type="button"
                onClick={() => setShowCustomId((v) => !v)}
                className="typo-caption text-foreground/60 hover:text-foreground/80 underline-offset-2 hover:underline transition-colors"
              >
                {t.plugins.companion.voice_pick_custom_toggle}
              </button>

              {showCustomId && (
                <div className="space-y-1 pt-1">
                  <input
                    type="text"
                    value={voiceId ?? ''}
                    onChange={(e) => setVoiceId(e.target.value || null)}
                    placeholder="e.g. 21m00Tcm4TlvDq8ikWAM"
                    spellCheck={false}
                    className="w-full bg-secondary/40 border border-foreground/10 rounded-input px-3 py-2 typo-code focus-ring"
                    aria-label={t.plugins.companion.voice_id_label}
                  />
                  <p className="typo-caption text-foreground/50">
                    {t.plugins.companion.voice_id_hint}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title={t.plugins.companion.voice_enable_title}
        subtitle={t.plugins.companion.voice_enable_desc}
      >
        <div className="flex items-start gap-3 px-1 py-2">
          <Mic
            className={`w-4 h-4 mt-0.5 shrink-0 ${enabled ? 'text-cyan-400' : 'text-foreground/40'}`}
          />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium">
              {t.plugins.companion.voice_enable_label}
            </div>
            <div className="typo-caption text-foreground/60 mt-0.5">
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
