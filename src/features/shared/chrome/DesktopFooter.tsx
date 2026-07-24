import { useState, useRef, useEffect, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { Palette, Check, Share2, LogOut, PanelLeftClose, PanelLeft, Keyboard, Map, Compass } from 'lucide-react';
import { SHORTCUTS_OPEN_EVENT } from '@/lib/keyboard/shortcutRegistry';
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useSystemStore } from '@/stores/systemStore';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';



import SystemLoadFooterIcon from '@/features/shared/chrome/SystemLoadFooterIcon';
import { FooterSectionNav } from '@/features/shared/chrome/FooterSectionNav';
// The workspace + project switcher (breadcrumb direction, chosen 2026-07-24).
// Supersedes the old project-only ProjectPickerFooterIcon, which it fully
// replaces: same actions (pick / clear / manage) plus the workspace scope.
import { SwitcherBreadcrumb } from '@/features/plugins/dev-tools/sub_workspaces/SwitcherBreadcrumb';

const CompanionFooterIcon = lazy(() => import('@/features/plugins/companion/CompanionFooterIcon'));
const RadioFooter = lazy(() => import('@/features/plugins/radio/components/RadioFooter'));
// Fleet status cluster (DEV-only). Lazy so the fleet module graph stays out of
// the always-mounted footer chunk.
const FleetFooterIcon = lazy(() => import('@/features/plugins/fleet/FleetFooterIcon'));
// Debug-recorder stop pill (DEV-only). Renders nothing unless a recording is
// running, but must be MOUNTED whenever the app is, so the recorder can always
// be stopped even after you leave the grid where it was started.
const FleetDebugLogFooterPill = lazy(() =>
  import('@/features/plugins/fleet/FleetDebugLogFooterPill').then((m) => ({
    default: m.FleetDebugLogFooterPill,
  })),
);

/** Custom event name used to toggle sidebar collapse from anywhere. */
export const SIDEBAR_TOGGLE_EVENT = 'personas:sidebar-toggle';

/**
 * Height of the desktop footer bar in px (the `h-8` below).
 *
 * Exported so fullscreen surfaces can stop *above* the footer rather than
 * relying on z-order to sit under it — reserving the space keeps the footer's
 * controls clickable and keeps the surface's own bottom edge visible. Zero on
 * mobile, where the footer isn't rendered at all.
 */
export const DESKTOP_FOOTER_HEIGHT_PX = IS_MOBILE ? 0 : 32;

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
// Keyboard-shortcuts cheat-sheet trigger -- opens the global `?` overlay.
// Subtle discoverability affordance so users learn the binding exists.
// ---------------------------------------------------------------------------

function ShortcutsFooterIcon() {
  const { t } = useTranslation();
  const navActive = useSystemStore((s) => s.keyboardNavActive);
  const setNavActive = useSystemStore((s) => s.setKeyboardNavActive);

  // Left click toggles the keyboard "shortcut mode" (the `;` nav mode) like a
  // switch — it stays armed until toggled off, not just for one shortcut. Right
  // click opens the cheat-sheet modal with the shortcut hints.
  return (
    <button
      onClick={() => setNavActive(!navActive)}
      onContextMenu={(e) => {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT));
      }}
      data-testid="footer-shortcuts"
      aria-pressed={navActive}
      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${
        navActive
          ? 'text-primary bg-primary/15 border border-primary/25'
          : 'text-foreground hover:text-foreground hover:bg-secondary/50'
      }`}
      title={t.chrome.shortcuts.mode_toggle_title}
      aria-label={t.chrome.shortcuts.mode_toggle_aria}
    >
      <Keyboard className="w-5 h-5" />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Resume-tour action — appears only when a guided tour was started, made
// partial progress, and was then dismissed (not completed). Lets the user
// pick the tour back up from the footer without hunting for the launcher.
// ---------------------------------------------------------------------------

function TourResumeFooterIcon() {
  const { t, tx } = useTranslation();
  const tourActive = useSystemStore((s) => s.tourActive);
  const tourDismissed = useSystemStore((s) => s.tourDismissed);
  const tourCompleted = useSystemStore((s) => s.tourCompleted);
  const tourId = useSystemStore((s) => s.tourActiveTourId);
  const stepCompleted = useSystemStore((s) => s.tourStepCompleted);

  const steps = getActiveTourSteps(tourId);
  const total = steps.length;
  const done = steps.filter((s) => stepCompleted[s.id]).length;
  const partial = done > 0 && done < total;
  const show = !tourActive && !tourCompleted && tourDismissed && partial;

  const handleClick = useCallback(() => {
    // Resume WITHOUT an aggressive route jump: startTour reactivates the tour,
    // then tourResumePending makes GuidedTour show its "continue where you left
    // off" window first and redirect only after the user confirms.
    useSystemStore.getState().startTour(tourId);
    useSystemStore.setState({ tourDismissed: false, tourResumePending: true });
  }, [tourId]);

  if (!show) return null;

  // tx() interpolates {completed}/{total} — the label string carries the
  // placeholders, so a plain `t.onboarding.resume_tour` would render them raw.
  const label = tx(t.onboarding.resume_tour, { completed: done, total });
  return (
    <button
      onClick={handleClick}
      data-testid="footer-resume-tour"
      className="h-7 px-2 rounded-lg flex items-center gap-1.5 text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
      title={label}
      aria-label={label}
    >
      <Map className="w-4 h-4" />
      <span className="typo-caption font-medium">{done}/{total}</span>
    </button>
  );
}

/**
 * Escape hatch that makes Skip reversible for the first-run onboarding modal.
 *
 * Without this, `reopenOnboarding`/`resumeOnboarding` had zero callers: once a
 * user skipped or finished onboarding, `startOnboarding` early-returns forever
 * (completed || personas>0), so the welcome flow could never be seen again.
 *
 * Shows only once onboarding is out of the way (not active) AND there is
 * something to return to:
 *  - dismissed mid-flow (`onboardingDismissedAtStep` set, not completed) →
 *    RESUME at the recorded step via `resumeOnboarding`.
 *  - finished or skipped-to-completion (`onboardingCompleted`) → REOPEN from
 *    the top via `reopenOnboarding`.
 * The label reflects which of the two it is.
 */
function OnboardingReplayFooterIcon() {
  const { t } = useTranslation();
  const onboardingActive = useSystemStore((s) => s.onboardingActive);
  const onboardingCompleted = useSystemStore((s) => s.onboardingCompleted);
  const dismissedAtStep = useSystemStore((s) => s.onboardingDismissedAtStep);

  // Dismissed-but-not-completed takes precedence: resuming where they left off
  // is more useful than restarting from scratch.
  const canResume = !onboardingCompleted && dismissedAtStep != null;
  const canReopen = onboardingCompleted;
  const show = !onboardingActive && (canResume || canReopen);

  const handleClick = useCallback(() => {
    if (canResume) {
      useSystemStore.getState().resumeOnboarding();
    } else {
      useSystemStore.getState().reopenOnboarding();
    }
  }, [canResume]);

  if (!show) return null;

  const label = canResume ? t.onboarding.resume_setup : t.onboarding.replay_setup;
  return (
    <button
      onClick={handleClick}
      data-testid="footer-replay-onboarding"
      className="h-7 px-2 rounded-lg flex items-center gap-1.5 text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
      title={label}
      aria-label={label}
    >
      <Compass className="w-4 h-4" />
      <span className="typo-caption font-medium">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Desktop footer bar
// ---------------------------------------------------------------------------

export default function DesktopFooter() {
  const radioEnabled = useSystemStore((s) => s.radioEnabled);
  // Grid mode covers the sidebar, so the footer takes over as the way into
  // other sections (see FooterSectionNav) — and lifts above the z-200 overlay.
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);
  if (IS_MOBILE) return null;

  // PORTAL, not an in-place render — this is load-bearing, not tidiness.
  //
  // `PersonasPage`'s root carries `contain: layout style`. Layout containment
  // makes that element BOTH a stacking context and the containing block for
  // fixed-position descendants, so a footer rendered inside it can only stack
  // against PersonasPage's own children: any `z-[210]` it wears is scoped to a
  // context that itself sits at z-auto. The fleet grid overlay is portaled to
  // <body> at z-200, so it painted over the entire PersonasPage subtree —
  // footer included — no matter how high the footer's z-index went. Portaling
  // the footer to <body> puts the two in the same stacking context, which is
  // what finally makes the z-index mean what it says. It also fixes the
  // footer's upward popovers (theme / account / project picker / fleet), which
  // open INTO the overlay's region and were being painted underneath it.
  //
  // Visually identical either way: the bar is `position: fixed` with explicit
  // insets, so it never depended on its DOM parent for placement.
  return createPortal(
    <div
      role="contentinfo"
      className={`fixed bottom-0 left-0 right-0 ${fleetGridOpen ? 'z-[210]' : 'z-40'} flex items-center justify-between px-4 h-8 border-t border-primary/10 bg-background`}
    >
      {/* Left cluster: Collapse + Account + Theme + Network */}
      <div className="flex items-center gap-1.5">
        <CollapseFooterIcon />
        <div className="w-px h-4 bg-primary/10" />
        <AccountFooterIcon />
        <div className="w-px h-4 bg-primary/10" />
        <ThemeFooterIcon />
        <div className="w-px h-4 bg-primary/10" />
        <ShortcutsFooterIcon />
        {import.meta.env.DEV && (
          <>
            <div className="w-px h-4 bg-primary/10" />
            <NetworkFooterIcon />
          </>
        )}
        {/* Athena companion — docked on the left, immediately right of the
            Network Settings icon. */}
        <div className="w-px h-4 bg-primary/10" />
        <Suspense fallback={null}>
          <CompanionFooterIcon />
        </Suspense>
      </div>

      {/* Center cluster, absolute-centered so left/right cluster widths don't
          shift it. In grid mode it carries section navigation — the sidebar is
          covered then, and this is the only way to reach another module without
          first dismissing the grid. That takes precedence over radio: one is
          navigation, the other is a nicety. */}
      {fleetGridOpen ? (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          <FooterSectionNav />
        </div>
      ) : radioEnabled ? (
        <div className="absolute left-1/2 -translate-x-1/2 flex items-center">
          <Suspense fallback={null}>
            <RadioFooter />
          </Suspense>
        </div>
      ) : null}

      {/* Right cluster: debug-recorder stop + fleet toggle + system load + tour
          + project picker. */}
      <div className="flex items-center gap-1.5">
        {import.meta.env.DEV && (
          <>
            <Suspense fallback={null}>
              <FleetDebugLogFooterPill />
            </Suspense>
            <Suspense fallback={null}>
              <FleetFooterIcon />
            </Suspense>
            <div className="w-px h-4 bg-primary/10" />
          </>
        )}
        <SystemLoadFooterIcon />
        <div className="w-px h-4 bg-primary/10" />
        <OnboardingReplayFooterIcon />
        <TourResumeFooterIcon />
        <SwitcherBreadcrumb />
      </div>
    </div>,
    document.body,
  );
}
