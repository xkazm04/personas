import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useTranslation } from '@/i18n/useTranslation';

// Account icon -- Google sign-in shortcut + auth status.

export default function AccountFooterIcon() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  const { t } = useTranslation();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!isAuthenticated) {
            loginWithGoogle();
          } else {
            setOpen((o) => !o);
          }
        }}
        disabled={isLoading}
        data-testid="footer-account"
        className={`relative w-7 h-7 rounded-lg flex items-center justify-center transition-colors group ${
          isAuthenticated
            ? 'text-emerald-400 hover:bg-emerald-500/10'
            : 'text-foreground hover:text-foreground hover:bg-secondary/50'
        } ${isLoading ? 'animate-pulse' : ''}`}
        title={isAuthenticated ? (user?.display_name ?? user?.email ?? t.chrome.signed_in) : t.chrome.sign_in_google}
        aria-label={isAuthenticated ? (user?.display_name ?? user?.email ?? t.chrome.signed_in) : t.chrome.sign_in_google}
      >
        {isAuthenticated && user?.avatar_url ? (
          <img src={user.avatar_url} alt="" className="w-5 h-5 rounded-full border border-emerald-500/30" />
        ) : (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
        )}
        {/* Status dot */}
        <span className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full border border-background ${
          isAuthenticated ? 'bg-emerald-500' : 'bg-muted-foreground/40'
        }`} />
      </button>

      {open && isAuthenticated && (
          <div
            /* Anchor to the button's left edge and expand rightward — the
               account icon sits near the window's left corner, so centering
               (left-1/2 -translate-x-1/2) used to push the popover off-screen. */
            className="animate-fade-slide-in absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-primary/15 bg-background shadow-elevation-3 p-2 z-50"
          >
            <div className="px-2 py-1.5 mb-1 border-b border-primary/10">
              <p className="typo-caption text-foreground/90 truncate">{user?.display_name ?? 'User'}</p>
              {user?.email && <p className="text-[10px] text-foreground truncate">{user.email}</p>}
            </div>
            <button
              type="button"
              onClick={() => { logout(); setOpen(false); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg typo-caption text-foreground hover:bg-primary/5 transition-colors"
            >
              <LogOut className="w-3 h-3" />
              {t.chrome.sign_out}
            </button>
          </div>
        )}
    </div>
  );
}
