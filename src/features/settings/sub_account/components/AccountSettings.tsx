import { useState, useEffect, useRef } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { Globe, LogOut, User, AlertCircle, RefreshCw, Activity, Download, CheckCircle2 } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { useAutoUpdater, type CheckOutcome } from '@/hooks/utility/data/useAutoUpdater';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { isTelemetryEnabled, setTelemetryEnabled } from '@/lib/telemetryPreference';
import { applyTelemetrySink } from '@/lib/analytics';
import { getUpdateHistory, clearUpdateHistory, type UpdateHistoryEntry } from '@/lib/updateHistory';
import { formatRelativeTime } from '@/lib/utils/formatters';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import Button from '@/features/shared/components/buttons/Button';
import RadioSettingsCard from '@/features/plugins/radio/components/RadioSettingsCard';
import CloudSyncCard from './CloudSyncCard';

export default function AccountSettings() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOffline = useAuthStore((s) => s.isOffline);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);

  const [telemetryOn, setTelemetryOn] = useState(isTelemetryEnabled);
  const [telemetryChanged, setTelemetryChanged] = useState(false);
  const { isChecking, lastChecked, checkForUpdate } = useAutoUpdater();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  // Last manual-check result, surfaced inline in the card so the result
  // persists after the toast auto-dismisses. Cleared after 6s.
  const [lastOutcome, setLastOutcome] = useState<CheckOutcome | null>(null);
  const [history, setHistory] = useState<UpdateHistoryEntry[]>([]);
  const outcomeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearError = () => useAuthStore.setState({ error: null });
  const { t } = useTranslation();
  const s = t.settings.account;

  useEffect(() => {
    getVersion().then(setAppVersion).catch(silentCatch('AccountSettings:getVersion'));
    setHistory(getUpdateHistory());
    return () => { if (outcomeTimer.current) clearTimeout(outcomeTimer.current); };
  }, []);

  const handleCheckForUpdate = async () => {
    const outcome = await checkForUpdate();
    const addToast = useToastStore.getState().addToast;
    if (outcome === "update-available") {
      addToast(s.updates_available_toast, 'success');
    } else if (outcome === "up-to-date") {
      addToast(s.updates_up_to_date, 'success');
    } else {
      addToast(s.updates_check_failed, 'error');
    }
    setLastOutcome(outcome);
    if (outcomeTimer.current) clearTimeout(outcomeTimer.current);
    outcomeTimer.current = setTimeout(() => setLastOutcome(null), 6000);
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<User className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title={s.title}
        subtitle={s.subtitle}
      />

      <ContentBody centered>
        <div className="space-y-6">
        {/* Telemetry */}
        <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
          <SectionHeading title={s.telemetry_title} icon={<Activity className="text-rose-400" />} />
          <p className="typo-body text-foreground leading-relaxed">
            {s.telemetry_description}
          </p>
          <div className="flex items-center justify-between gap-4 rounded-card bg-secondary/20 border border-primary/8 p-4">
            <div className="min-w-0">
              <p className="typo-body font-medium text-foreground/85">{s.telemetry_toggle}</p>
              <p className="typo-caption text-foreground mt-0.5">
                {telemetryOn
                  ? s.telemetry_on
                  : s.telemetry_off}
              </p>
              {telemetryChanged && (
                <p className="typo-caption text-amber-400/80 mt-1.5 flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3" />
                  {s.telemetry_restart}
                </p>
              )}
            </div>
            <AccessibleToggle
              checked={telemetryOn}
              onChange={() => {
                const next = !telemetryOn;
                setTelemetryEnabled(next);
                // Stop/resume usage tracking immediately (no restart). Error
                // reporting still needs a restart — hence the note below stays.
                applyTelemetrySink(next);
                setTelemetryOn(next);
                setTelemetryChanged(true);
              }}
              label={s.telemetry_toggle_aria}
            />
          </div>
        </div>

        {/* Radio */}
        <RadioSettingsCard />

        {/* Updates */}
        <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
          <SectionHeading title={s.updates_title} icon={<Download className="text-blue-400" />} />
          <p className="typo-body text-foreground leading-relaxed">
            {s.updates_description}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {appVersion && (
              <span className="inline-flex items-center px-2 py-0.5 typo-caption font-medium rounded-full bg-secondary/30 border border-primary/10 text-foreground">
                {interpolate(s.updates_current_version, { version: appVersion })}
              </span>
            )}
            {lastChecked !== null && (
              <span className="typo-caption text-foreground">
                {interpolate(s.updates_last_checked, {
                  time: formatRelativeTime(new Date(lastChecked).toISOString()),
                })}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              icon={<RefreshCw className={`w-4 h-4 ${isChecking ? 'animate-spin' : ''}`} />}
              onClick={() => { void handleCheckForUpdate(); }}
              disabled={isChecking}
            >
              {isChecking ? s.updates_checking : s.updates_check_button}
            </Button>
            {!isChecking && lastOutcome === 'up-to-date' && (
              <span className="inline-flex items-center gap-1.5 typo-caption text-emerald-400 animate-fade-slide-in">
                <CheckCircle2 className="w-4 h-4" />
                {s.updates_up_to_date}
              </span>
            )}
            {!isChecking && lastOutcome === 'failed' && (
              <span className="inline-flex items-center gap-1.5 typo-caption text-red-400 animate-fade-slide-in">
                <AlertCircle className="w-4 h-4" />
                {s.updates_check_failed}
              </span>
            )}
          </div>

          {history.length > 0 && (
            <div className="border-t border-primary/10 pt-4 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="typo-caption font-medium text-foreground uppercase tracking-wide">
                  {s.updates_history_title}
                </p>
                <button
                  onClick={() => { clearUpdateHistory(); setHistory([]); }}
                  className="typo-caption text-foreground hover:text-primary transition-colors"
                >
                  {t.common.clear}
                </button>
              </div>
              <ul className="space-y-1.5">
                {history.map((entry) => (
                  <li
                    key={`${entry.version}-${entry.at}`}
                    className="flex items-center justify-between gap-3 typo-caption"
                  >
                    <span className="font-mono text-foreground">v{entry.version}</span>
                    <span className="text-foreground">
                      {formatRelativeTime(new Date(entry.at).toISOString())}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-6">
          {isAuthenticated && user ? (
            <>
              <div className="flex items-center gap-4">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.display_name ?? s.avatar_alt}
                    className="w-14 h-14 rounded-full border-2 border-primary/20"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-primary/15 border-2 border-primary/20 flex items-center justify-center">
                    <User className="w-7 h-7 text-primary" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="typo-body-lg font-medium text-foreground/90 truncate">
                    {user.display_name ?? user.email}
                  </div>
                  {user.display_name && (
                    <div className="typo-body text-foreground truncate">{user.email}</div>
                  )}
                  {isOffline && (
                    <span className="inline-block mt-1.5 px-2 py-0.5 typo-heading font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase">
                      {s.offline}
                    </span>
                  )}
                </div>
              </div>

              <div className="border-t border-primary/10 pt-4">
                <Button variant="secondary" icon={<LogOut className="w-4 h-4" />} onClick={logout}>
                  {s.sign_out}
                </Button>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <div className="w-14 h-14 mx-auto mb-4 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Globe className="w-7 h-7 text-primary/60" />
              </div>
              <p className="typo-body text-foreground mb-4">{s.sign_in_prompt}</p>

              {/* Error display */}
              {error && (
                <div className="max-w-sm mx-auto mb-4 flex items-start gap-2.5 p-3 rounded-modal border border-red-500/20 bg-red-500/5 text-left">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="typo-body text-red-300/90">{error}</p>
                    <Button variant="link" size="xs" onClick={clearError} className="mt-1">
                      {s.dismiss}
                    </Button>
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-modal typo-body font-medium
                    bg-primary/10 text-primary border border-primary/20">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {s.waiting_sign_in}
                  </div>
                  <p className="typo-caption text-foreground">{s.complete_sign_in}</p>
                  <Button variant="link" size="xs" onClick={() => useAuthStore.setState({ isLoading: false, error: null })}>
                    {s.cancel}
                  </Button>
                </div>
              ) : (
                <Button variant="secondary" icon={<Globe className="w-4 h-4" />} onClick={loginWithGoogle}>
                  {s.sign_in_google}
                </Button>
              )}
            </div>
          )}
        </div>

        {isAuthenticated && user && <CloudSyncCard />}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
