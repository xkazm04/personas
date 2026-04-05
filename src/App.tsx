import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/shared/components/feedback/UpdateBanner";
import { ToastContainer } from "@/features/shared/components/feedback/ToastContainer";
import { FirstUseConsentModal, hasUserConsented, storedConsentVersion } from "@/features/shared/components/overlays/FirstUseConsentModal";
import { useAuthStore } from "@/stores/authStore";
import VibeThemeProvider from "@/features/shared/components/layout/VibeThemeProvider";
import { AriaLiveProvider } from "@/features/shared/components/feedback/AriaLiveProvider";
import { ChartGradientDefs } from "@/features/overview/sub_usage/components/ChartGradientDefs";
import { toggleMobilePreview } from "@/lib/utils/platform/platform";
import { useMobilePreview } from "@/hooks/utility/interaction/useMobilePreview";
import TitleBar from "@/features/shared/components/layout/TitleBar";
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Silent error boundary for invisible components (renders null on error).
 * Logs the failure but doesn't show UI — used for BackgroundServices which
 * normally renders nothing.
 */
class SilentErrorBoundary extends Component<
  { name: string; children: ReactNode },
  { hasError: boolean; retryCount: number }
> {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_RETRIES = 3;
  private static readonly BACKOFF_MS = [5_000, 15_000, 45_000];

  state = { hasError: false, retryCount: 0 };

  static getDerivedStateFromError() { return { hasError: true }; }

  componentDidCatch(error: Error) {
    console.error(`[${this.props.name}] silently failed (attempt ${this.state.retryCount + 1}):`, error);

    if (this.state.retryCount < SilentErrorBoundary.MAX_RETRIES) {
      const delay = SilentErrorBoundary.BACKOFF_MS[this.state.retryCount] ?? 45_000;
      this.retryTimer = setTimeout(() => {
        this.setState((prev) => ({ hasError: false, retryCount: prev.retryCount + 1 }));
      }, delay);
    }
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  render() { return this.state.hasError ? null : this.props.children; }
}

// Lazy-load overlays and background services — none needed for first paint.
// BackgroundServices hosts hooks that import domain stores (~300 KB deferred).
const BackgroundServices = lazy(() => import("@/features/shared/components/layout/BackgroundServices"));
const CommandPalette = lazy(() => import("@/features/shared/components/overlays/CommandPalette"));
const GuidedTour = lazy(() => import("@/features/onboarding/components/GuidedTour"));
const TourSpotlight = lazy(() => import("@/features/onboarding/components/TourSpotlight"));
const ExecutionMiniPlayer = lazy(() => import("@/features/execution/components/ExecutionMiniPlayer"));
const HealingToast = lazy(() => import("@/features/shared/components/feedback/HealingToast").then(m => ({ default: m.HealingToast })));
const AlertToastContainer = lazy(() => import("@/features/overview/sub_observability/components/AlertToastContainer").then(m => ({ default: m.AlertToastContainer })));
const NotificationCenter = lazy(() => import("@/features/gitlab/components/NotificationCenter").then(m => ({ default: m.NotificationCenter })));
const ShareLinkHandler = lazy(() => import("@/features/sharing/components/ShareLinkHandler").then(m => ({ default: m.ShareLinkHandler })));

export default function App() {
  const [consented, setConsented] = useState(hasUserConsented);
  // True when user consented to an older version and needs to re-accept
  const [isVersionBump] = useState(() => {
    const stored = storedConsentVersion();
    return stored !== null && !hasUserConsented();
  });
  useEffect(() => {
    // Dynamic imports: event bridge + middleware + background hooks.
    // These pull in all 5 domain stores — loading them async keeps
    // them out of the main bundle (~300 KB savings).
    // Loaded in parallel (no interdependency) to avoid a boot waterfall.
    Promise.all([
      import("@/lib/storeBusWiring").then(m => m.initStoreBus()),
      import("@/lib/eventBridge").then(m => m.initAllListeners()),
      import("@/lib/execution/middleware").then(m => m.registerAllMiddleware()),
    ]).catch((err) => {
      console.error("[App] Critical startup module failed to initialize:", err);
    });
    void useAuthStore.getState().initialize();
    // Test automation bridge — exposes window.__TEST__ for MCP-driven testing.
    // Loaded in dev builds always, or in production when PERSONAS_TEST_PORT is set
    // (Rust injects window.__PERSONAS_TEST_MODE__ = true via eval).
    if (import.meta.env.DEV || (window as unknown as Record<string, unknown>).__PERSONAS_TEST_MODE__) {
      void import("@/test/automation/bridge");
    }

    // Report frontend time-to-interactive to the Rust backend.
    // __BOOT_TIME__ is set in index.html before any JS loads.
    const bootTime = (window as unknown as Record<string, unknown>).__BOOT_TIME__;
    if (typeof bootTime === "number") {
      const tti = performance.now() - bootTime;
      import("@tauri-apps/api/core").then(({ invoke }) => {
        invoke("report_frontend_ready", { ttiMs: tti }).catch(() => {});
      });
    }
  }, []);

  const { t } = useTranslation();

  // Dev-mode mobile preview toggle: Ctrl+Shift+M
  const isMobilePreview = useMobilePreview();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        toggleMobilePreview();
        window.location.reload();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <VibeThemeProvider>
        <AriaLiveProvider>
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:top-1 focus:left-1 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-md focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-medium focus:shadow-elevation-3 focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {t.chrome.skip_to_content}
          </a>
          <TitleBar />
          {!consented && <FirstUseConsentModal onAccept={() => setConsented(true)} isVersionBump={isVersionBump} />}
          <UpdateBanner />
          <div className="flex flex-1 overflow-hidden">
            <PersonasPage />
          </div>
          <SilentErrorBoundary name="BackgroundServices">
            <Suspense fallback={null}>
              <BackgroundServices />
            </Suspense>
          </SilentErrorBoundary>
          <Suspense fallback={null}>
            <HealingToast />
            <AlertToastContainer />
            <GuidedTour />
            <TourSpotlight />
            <ExecutionMiniPlayer />
            <CommandPalette />
            <NotificationCenter />
            <ShareLinkHandler />
          </Suspense>
          <ChartGradientDefs />
          <ToastContainer />
          {import.meta.env.DEV && isMobilePreview && (
            <div className="fixed top-1 right-1 z-[999] px-2 py-1 rounded-lg bg-cyan-500/90 text-white text-xs font-bold shadow-elevation-3 pointer-events-none select-none">
              MOBILE PREVIEW
            </div>
          )}
        </div>
        </AriaLiveProvider>
      </VibeThemeProvider>
  );
}
