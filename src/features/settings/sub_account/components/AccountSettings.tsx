import { Chrome, LogOut, User, Check, Sparkles, LayoutGrid, Wrench, AlertCircle, RefreshCw } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useAuthStore } from '@/stores/authStore';
import { useSystemStore } from '@/stores/systemStore';
import { TIERS, TIER_CYCLE } from '@/lib/constants/uiModes';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';

export default function AccountSettings() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOffline = useAuthStore((s) => s.isOffline);
  const isLoading = useAuthStore((s) => s.isLoading);
  const error = useAuthStore((s) => s.error);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);
  const viewMode = useSystemStore((s) => s.viewMode);
  const setViewMode = useSystemStore((s) => s.setViewMode);

  const clearError = () => useAuthStore.setState({ error: null });

  return (
    <ContentBox>
      <ContentHeader
        icon={<User className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title="Account"
        subtitle="Manage your sign-in and profile"
      />

      <ContentBody centered>
        <div className="space-y-6">
        {/* Interface mode */}
        <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
          <SectionHeading title="Interface Mode" icon={<Sparkles className="text-violet-400" />} />
          <div className="grid grid-cols-3 gap-3">
            {([
              { mode: TIERS.STARTER, icon: Sparkles, label: 'Starter', desc: 'Clean, focused UI', color: 'violet' },
              { mode: TIERS.TEAM, icon: LayoutGrid, label: 'Team', desc: 'Pipelines & analytics', color: 'primary' },
              { mode: TIERS.BUILDER, icon: Wrench, label: 'Builder', desc: 'Dev tools & lab', color: 'amber' },
            ] as const).filter(({ mode }) => TIER_CYCLE.includes(mode)).map(({ mode, icon: Icon, label, desc, color }) => {
              const isActive = viewMode === mode;
              return (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
                    isActive
                      ? `border-${color}-500/30 bg-${color}-500/5`
                      : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? `text-${color}-400` : 'text-muted-foreground/50'}`} />
                  <span className={`text-sm font-medium ${isActive ? 'text-foreground/90' : 'text-muted-foreground/70'}`}>{label}</span>
                  <span className="text-[11px] text-muted-foreground/50 text-center">{desc}</span>
                  {isActive && (
                    <div className="absolute top-2 right-2"><Check className={`w-3.5 h-3.5 text-${color}-400`} /></div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-6">
          {isAuthenticated && user ? (
            <>
              <div className="flex items-center gap-4">
                {user.avatar_url ? (
                  <img
                    src={user.avatar_url}
                    alt={user.display_name ?? 'User'}
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
                      Offline
                    </span>
                  )}
                </div>
              </div>

              <div className="border-t border-primary/10 pt-4">
                <button
                  onClick={logout}
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm text-foreground/90
                    hover:bg-primary/5 border border-primary/10 hover:border-primary/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <div className="w-14 h-14 mx-auto mb-4 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Chrome className="w-7 h-7 text-primary/60" />
              </div>
              <p className="text-sm text-muted-foreground/80 mb-4">Sign in to sync your data across devices</p>

              {/* Error display */}
              {error && (
                <div className="max-w-sm mx-auto mb-4 flex items-start gap-2.5 p-3 rounded-xl border border-red-500/20 bg-red-500/5 text-left">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-red-300/90">{error}</p>
                    <button
                      onClick={clearError}
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 mt-1 transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              )}

              {isLoading ? (
                <div className="space-y-3">
                  <div className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium
                    bg-primary/10 text-primary border border-primary/20">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Waiting for sign-in...
                  </div>
                  <p className="text-[11px] text-muted-foreground/50">Complete sign-in in the popup window</p>
                  <button
                    onClick={() => useAuthStore.setState({ isLoading: false, error: null })}
                    className="text-xs text-muted-foreground/50 hover:text-muted-foreground/80 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={loginWithGoogle}
                  className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-medium
                    bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15
                    transition-colors"
                >
                  <Chrome className="w-4 h-4" />
                  Sign in with Google
                </button>
              )}
            </div>
          )}
        </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
