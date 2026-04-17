import { useState, useRef, useEffect, useCallback } from 'react';
import { Palette, Check, Share2, LogOut, PanelLeftClose, PanelLeft } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useSystemStore } from '@/stores/systemStore';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTranslation } from '@/i18n/useTranslation';

/** Custom event name used to toggle sidebar collapse from anywhere. */
export const SIDEBAR_TOGGLE_EVENT = 'personas:sidebar-toggle';

// ---------------------------------------------------------------------------
// Account icon -- Google sign-in shortcut + auth status
// ---------------------------------------------------------------------------

function AccountFooterIcon() {
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const logout = useAuthStore((s) => s.logout);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const { t } = useTranslation();

  return (
    <div ref={ref} className="relative">
      <button
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
            className="animate-fade-slide-in absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 rounded-xl border border-primary/15 bg-background shadow-elevation-3 p-2 z-50"
          >
            <div className="px-2 py-1.5 mb-1 border-b border-primary/10">
              <p className="typo-caption text-foreground/90 truncate">{user?.display_name ?? 'User'}</p>
              {user?.email && <p className="text-[10px] text-foreground truncate">{user.email}</p>}
            </div>
            <button
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

// ---------------------------------------------------------------------------
// Theme icon -- quick theme picker popup
// ---------------------------------------------------------------------------

function ThemeFooterIcon() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t: tTheme } = useTranslation();

  const currentTheme = THEMES.find((t) => t.id === themeId);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="footer-theme"
        className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors group"
        title={`Theme: ${currentTheme?.label ?? 'Default'}`}
        aria-label={`Theme: ${currentTheme?.label ?? 'Default'}`}
      >
        <div className="relative">
          <Palette className="w-5 h-5" />
          {/* Tiny swatch dot showing current primary */}
          <span
            className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-background"
            style={{ backgroundColor: currentTheme?.primaryColor ?? '#3b82f6' }}
          />
        </div>
      </button>

      {open && (
          <div
            className="animate-fade-slide-in absolute bottom-full left-0 mb-2 w-[220px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 p-3 z-50"
          >
            {/* Dark themes */}
            <p className="text-[10px] font-mono uppercase tracking-wider text-foreground mb-2">{tTheme.chrome.dark}</p>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {THEMES.filter((t) => !t.isLight).map((t) => {
                const isActive = themeId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => { setTheme(t.id as ThemeId); setOpen(false); }}
                    className={`flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all ${
                      isActive ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/50'
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform ${
                        isActive ? 'border-foreground/60 scale-110' : 'border-transparent hover:scale-105'
                      }`}
                      style={{ backgroundColor: t.primaryColor }}
                    >
                      {isActive && <Check className="w-3 h-3 text-white drop-shadow-elevation-1" />}
                    </span>
                    <span className={`text-[9px] leading-tight truncate w-full text-center ${
                      isActive ? 'text-foreground/90 font-medium' : 'text-foreground'
                    }`}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Light themes */}
            <div className="border-t border-primary/10 pt-2">
              <p className="text-[10px] font-mono uppercase tracking-wider text-foreground mb-2">{tTheme.chrome.light}</p>
              <div className="grid grid-cols-4 gap-2">
                {THEMES.filter((t) => t.isLight).map((t) => {
                  const isActive = themeId === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => { setTheme(t.id as ThemeId); setOpen(false); }}
                      className={`flex flex-col items-center gap-1 p-1.5 rounded-lg transition-all ${
                        isActive ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/50'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-transform ${
                          isActive ? 'border-foreground/60 scale-110' : 'border-black/10 hover:scale-105'
                        }`}
                        style={{ backgroundColor: t.primaryColor }}
                      >
                        {isActive && <Check className="w-3 h-3 text-white drop-shadow-elevation-1" />}
                      </span>
                      <span className={`text-[9px] leading-tight truncate w-full text-center ${
                        isActive ? 'text-foreground/90 font-medium' : 'text-foreground'
                      }`}>
                        {t.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Network icon -- golden styling when hidden behind dev mode
// ---------------------------------------------------------------------------

function NetworkFooterIcon() {
  const { isBuilder: isDevMode } = useTier();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setSettingsTab = useSystemStore((s) => s.setSettingsTab);
  const { t: tNet } = useTranslation();

  const handleClick = useCallback(() => {
    setSidebarSection('settings');
    setSettingsTab('network');
  }, [setSidebarSection, setSettingsTab]);

  return (
    <button
      onClick={handleClick}
      data-testid="footer-network"
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
        isDevMode
          ? 'text-amber-400/80 bg-amber-500/8 ring-1 ring-amber-500/30 hover:bg-amber-500/15'
          : 'text-amber-400/60 bg-amber-500/5 ring-1 ring-amber-500/20 hover:bg-amber-500/10'
      }`}
      title={tNet.chrome.network_settings}
      aria-label={tNet.chrome.network_settings}
    >
      <Share2 className="w-5 h-5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Sidebar collapse toggle -- fires custom event consumed by Sidebar.tsx
// ---------------------------------------------------------------------------

function CollapseFooterIcon() {
  const { t: tCollapse } = useTranslation();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; }
  });

  // Stay in sync when Sidebar itself changes localStorage (e.g. from another tab)
  useEffect(() => {
    const handler = () => {
      try { setCollapsed(localStorage.getItem('sidebar-collapsed') === '1'); } catch { /* */ }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const handleClick = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT));
    // Optimistically flip local state
    setCollapsed((c) => !c);
  }, []);

  return (
    <button
      onClick={handleClick}
      data-testid="footer-collapse"
      className="w-7 h-7 rounded-lg flex items-center justify-center text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
      title={collapsed ? tCollapse.chrome.expand_sidebar : tCollapse.chrome.collapse_sidebar}
      aria-label={collapsed ? tCollapse.chrome.expand_sidebar : tCollapse.chrome.collapse_sidebar}
    >
      {collapsed ? <PanelLeft className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Desktop footer bar
// ---------------------------------------------------------------------------

export default function DesktopFooter() {
  if (IS_MOBILE) return null;

  return (
    <div role="contentinfo" className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-between px-4 h-8 border-t border-primary/10 bg-background">
      {/* Left cluster: Collapse + Account + Theme + Network */}
      <div className="flex items-center gap-1.5">
        <CollapseFooterIcon />
        <div className="w-px h-4 bg-primary/10" />
        <AccountFooterIcon />
        <div className="w-px h-4 bg-primary/10" />
        <ThemeFooterIcon />
        {import.meta.env.DEV && (
          <>
            <div className="w-px h-4 bg-primary/10" />
            <NetworkFooterIcon />
          </>
        )}
      </div>

      {/* Right: reserved for future status items */}
      <div className="flex items-center gap-1.5" />
    </div>
  );
}
