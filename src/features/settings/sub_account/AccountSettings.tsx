import { useTranslation } from '@/i18n/useTranslation';
import { Globe, LogOut, User } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';

export default function AccountSettings() {
  const { t } = useTranslation();
  const st = t.settings.account;
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isOffline = useAuthStore((s) => s.isOffline);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);

  return (
    <ContentBox>
      <ContentHeader
        icon={<User className="w-5 h-5 text-blue-400" />}
        iconColor="blue"
        title={st.title}
        subtitle={st.subtitle}
      />

      <ContentBody centered>
        <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-6">
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
                  className="flex items-center gap-2.5 px-4 py-2.5 rounded-modal text-sm text-foreground/90
                    hover:bg-primary/5 border border-primary/10 hover:border-primary/20 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <div className="text-center py-6">
              <div className="w-14 h-14 mx-auto mb-4 rounded-modal bg-primary/10 border border-primary/20 flex items-center justify-center">
                <Globe className="w-7 h-7 text-primary/60" />
              </div>
              <p className="text-sm text-muted-foreground/80 mb-4">{st.sign_in_prompt}</p>
              <button
                onClick={loginWithGoogle}
                disabled={isLoading}
                className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-modal text-sm font-medium
                  bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15
                  transition-colors disabled:opacity-50"
              >
                <Globe className={`w-4 h-4 ${isLoading ? 'animate-pulse' : ''}`} />
                Sign in with Google
              </button>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
