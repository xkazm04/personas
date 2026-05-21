import { useState, useRef, useEffect, useCallback, lazy, Suspense, useMemo } from 'react';
import { Palette, Check, Share2, LogOut, PanelLeftClose, PanelLeft, FolderGit2, ChevronUp, X } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useSystemStore } from '@/stores/systemStore';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { DebtText } from '@/i18n/DebtText';



const CompanionFooterIcon = lazy(() => import('@/features/plugins/companion/CompanionFooterIcon'));
const RadioFooter = lazy(() => import('@/features/radio/components/RadioFooter'));

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
                      {isActive && <Check className="w-3 h-3 text-foreground drop-shadow-elevation-1" />}
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
                        {isActive && <Check className="w-3 h-3 text-foreground drop-shadow-elevation-1" />}
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
      try { setCollapsed(localStorage.getItem('sidebar-collapsed') === '1'); } catch (err) { silentCatch("features/shared/components/layout/DesktopFooter:catch1")(err); }
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
// Active Dev Tools project picker -- compact right-side switcher so users
// can change the active codebase without opening the Dev Tools plugin UI.
// Hidden when no projects exist (avoids advertising an empty state).
// ---------------------------------------------------------------------------

function ProjectPickerFooterIcon() {
  const projects = useSystemStore((s) => s.projects);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const setActiveProject = useSystemStore((s) => s.setActiveProject);
  const fetchProjects = useSystemStore((s) => s.fetchProjects);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const loadedRef = useRef(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    void fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  if (projects.length === 0) return null;

  const buttonLabel = activeProject?.name ?? 'Pick project';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="footer-project-picker"
        className={`flex items-center gap-1.5 h-7 px-2 rounded-lg transition-colors max-w-[180px] ${
          activeProject
            ? 'text-indigo-300/90 hover:bg-indigo-500/10'
            : 'text-foreground hover:bg-secondary/50'
        }`}
        title={activeProject?.root_path ?? 'Pick active Dev Tools project'}
        aria-label={`Active project: ${buttonLabel}`}
      >
        <FolderGit2 className="w-4 h-4 flex-shrink-0" />
        <span className="text-[11px] font-medium truncate min-w-0">{buttonLabel}</span>
        <ChevronUp className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>

      {open && (
        <div className="animate-fade-slide-in absolute bottom-full right-0 mb-2 w-64 rounded-xl border border-primary/15 bg-background shadow-elevation-3 p-2 z-50">
          <div className="px-2 py-1 mb-1 border-b border-primary/10">
            <p className="text-[10px] uppercase tracking-wider text-foreground font-mono"><DebtText k="auto_active_project_687de263" /></p>
          </div>
          <div className="max-h-64 overflow-y-auto">
            {/* Deselect — clears the active project (show all personas). */}
            <button
              onClick={() => { void setActiveProject(null); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg typo-caption transition-colors text-left ${
                activeProjectId === null
                  ? 'bg-indigo-500/10 text-indigo-300'
                  : 'text-foreground hover:bg-secondary/40'
              }`}
            >
              <X className="w-3.5 h-3.5 flex-shrink-0" />
              <div className="flex-1 min-w-0 text-[12px] font-medium truncate">{t.chrome.project_picker_none}</div>
              {activeProjectId === null && <Check className="w-3 h-3 text-indigo-300 flex-shrink-0" />}
            </button>
            {projects.map((p) => {
              const isActive = p.id === activeProjectId;
              return (
                <button
                  key={p.id}
                  onClick={() => { void setActiveProject(p.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg typo-caption transition-colors text-left ${
                    isActive
                      ? 'bg-indigo-500/10 text-indigo-300'
                      : 'text-foreground hover:bg-secondary/40'
                  }`}
                >
                  <FolderGit2 className="w-3.5 h-3.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium truncate">{p.name}</div>
                    {p.root_path && (
                      <div className="text-[10px] text-foreground truncate">{p.root_path}</div>
                    )}
                  </div>
                  {isActive && <Check className="w-3 h-3 text-indigo-300 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
          <div className="mt-1 pt-1 border-t border-primary/10">
            <button
              onClick={() => { setSidebarSection('plugins'); setOpen(false); }}
              className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] text-foreground hover:bg-secondary/40 transition-colors"
            >
              <DebtText k="auto_manage_in_dev_tools_70c6b5fa" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Desktop footer bar
// ---------------------------------------------------------------------------

export default function DesktopFooter() {
  const radioEnabled = useSystemStore((s) => s.radioEnabled);
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

      {/* Center cluster: radio controls. Absolute-centered so left/right
          cluster widths don't shift its position. Off by default — user
          opts in via Settings → Account; preference is persisted. */}
      {radioEnabled && (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          <Suspense fallback={null}>
            <RadioFooter />
          </Suspense>
        </div>
      )}

      {/* Right cluster: project picker + Athena companion. Companion sits
          rightmost so the notice popover anchors against the window edge
          and never collides with sibling footer popovers. */}
      <div className="flex items-center gap-1.5">
        <ProjectPickerFooterIcon />
        <div className="w-px h-4 bg-primary/10" />
        <Suspense fallback={null}>
          <CompanionFooterIcon />
        </Suspense>
      </div>
    </div>
  );
}
