import { useState } from 'react';
import { Globe, LogOut, User, AlertCircle, RefreshCw, Activity } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { isTelemetryEnabled, setTelemetryEnabled } from '@/lib/telemetryPreference';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

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
  const clearError = () => useAuthStore.setState({ error: null });
  const { t } = useTranslation();
  const s = t.settings.account;

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
        <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
          <SectionHeading title={s.telemetry_title} icon={<Activity className="text-rose-400" />} />
          <p className="text-sm text-muted-foreground/60 leading-relaxed">
            {s.telemetry_description}
          </p>
          <div className="flex items-center justify-between gap-4 rounded-lg bg-secondary/20 border border-primary/8 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground/85">{s.telemetry_toggle}</p>
              <p className="text-xs text-muted-foreground/50 mt-0.5">
                {telemetryOn
                  ? s.telemetry_on
                  : s.telemetry_off}
              </p>
              {telemetryChanged && (
                <p className="text-xs text-amber-400/80 mt-1.5 flex items-center gap-1.5">
                  <RefreshCw className="w-3 h-3" />
                  {s.telemetry_restart}
                </p>
              )}
            </div>
            <button
              onClick={() => {
                const next = !telemetryOn;
                setTelemetryEnabled(next);
                setTelemetryOn(next);
                setTelemetryChanged(true);
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full shrink-0 transition-colors ${
                telemetryOn ? 'bg-emerald-500/70' : 'bg-secondary/60 border border-primary/15'
              }`}
              role="switch"
              aria-checked={telemetryOn}
              aria-label="Toggle telemetry"
            >
              <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-elevation-1 transition-transform ${
                  telemetryOn ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-6">
          {isAuthenticated && user ? (
            <>
              <div className="flex items-center gap-4">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.display_name ?? s.title}
                    className="w-14 h-14 rounded-full border-2 border-primary/20"
                  />
                ) : (
                  <div className="w-14 h-14 rounded-full bg-primary/15 border-2 border-primary/20 flex items-center justify-center">
                    <User className="w-7 h-7 text-primary" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-base font-medium text-foreground/90 truncate">
                    {user.display_name ?? user.email}
                  </div>
                  {user.display_name && (
                    <div className="text-sm text-muted-foreground/90 truncate">{user.email}</div>
                  )}
                  {isOffline && (
                    <span className="inline-block mt-1.5 px-2 py-0.5 text-sm font-bold rounded-full bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase">
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
              <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Globe className="w-7 h-7 text-primary/60" />
              </div>
              <p className="text-sm text-muted-foreground/80 mb-4">{s.sign_in_prompt}</p>

              {/* Error display */}
              {error && (
                <div className="max-w-sm mx-auto mb-4 flex items-start gap-2.5 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-left">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-red-300/90">{error}</p>
                    <Button variant="link" size="xs" onClick={clearError} className="mt-1">
                      {s.dismiss}
                    </Button>
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium
                    bg-primary/10 text-primary border border-primary/20">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    {s.waiting_sign_in}
                  </div>
                  <p className="text-[11px] text-muted-foreground/50">{s.complete_sign_in}</p>
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
        </div>
      </ContentBody>
    </ContentBox>
  );
}
