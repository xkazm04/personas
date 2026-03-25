import { lazy, Suspense, useEffect, useState } from "react";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/shared/components/feedback/UpdateBanner";
import { ToastContainer } from "@/features/shared/components/feedback/ToastContainer";
import { FirstUseConsentModal, hasUserConsented } from "@/features/shared/components/overlays/FirstUseConsentModal";
import { useAuthStore } from "@/stores/authStore";
import VibeThemeProvider from "@/features/shared/components/layout/VibeThemeProvider";
import { AriaLiveProvider } from "@/features/shared/components/feedback/AriaLiveProvider";
import { toggleMobilePreview } from "@/lib/utils/platform/platform";
import { useMobilePreview } from "@/hooks/utility/interaction/useMobilePreview";
import TitleBar from "@/features/shared/components/layout/TitleBar";
import { useTranslation } from '@/i18n/useTranslation';

// Lazy-load overlays and background services — none needed for first paint.
// BackgroundServices hosts hooks that import domain stores (~300 KB deferred).
const BackgroundServices = lazy(() => import("@/features/shared/components/layout/BackgroundServices"));
const CommandPalette = lazy(() => import("@/features/shared/components/overlays/CommandPalette"));
const OnboardingOverlay = lazy(() => import("@/features/onboarding/components/OnboardingOverlay"));
const GuidedTour = lazy(() => import("@/features/onboarding/components/GuidedTour"));
const ExecutionMiniPlayer = lazy(() => import("@/features/execution/components/ExecutionMiniPlayer"));
const HealingToast = lazy(() => import("@/features/shared/components/feedback/HealingToast").then(m => ({ default: m.HealingToast })));
const AlertToastContainer = lazy(() => import("@/features/overview/sub_observability/components/AlertToastContainer").then(m => ({ default: m.AlertToastContainer })));
const NotificationCenter = lazy(() => import("@/features/gitlab/components/NotificationCenter").then(m => ({ default: m.NotificationCenter })));
const ShareLinkHandler = lazy(() => import("@/features/sharing/components/ShareLinkHandler").then(m => ({ default: m.ShareLinkHandler })));

export default function App() {
  const [consented, setConsented] = useState(hasUserConsented);

  useEffect(() => {
    // Dynamic imports: event bridge + middleware + background hooks.
    // These pull in all 5 domain stores — loading them async keeps
    // them out of the main bundle (~300 KB savings).
    void import("@/lib/storeBusWiring").then(m => m.initStoreBus());
    void import("@/lib/eventBridge").then(m => m.initAllListeners());
    void import("@/lib/execution/middleware").then(m => m.registerAllMiddleware());
    void useAuthStore.getState().initialize();
    // Test automation bridge — exposes window.__TEST__ for MCP-driven testing.
    // Only loaded in dev builds; tree-shaken from production.
    if (import.meta.env.DEV) {
      void import("@/test/automation/bridge");
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
            className="sr-only focus:not-sr-only focus:fixed focus:top-1 focus:left-1 focus:z-[9999] focus:px-4 focus:py-2 focus:rounded-md focus:bg-primary focus:text-primary-foreground focus:text-sm focus:font-medium focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {t.chrome.skip_to_content}
          </a>
          <TitleBar />
          {!consented && <FirstUseConsentModal onAccept={() => setConsented(true)} />}
          <UpdateBanner />
          <div className="flex flex-1 overflow-hidden">
            <PersonasPage />
          </div>
          <Suspense fallback={null}>
            <BackgroundServices />
            <HealingToast />
            <AlertToastContainer />
            <OnboardingOverlay />
            <GuidedTour />
            <ExecutionMiniPlayer />
            <CommandPalette />
            <NotificationCenter />
            <ShareLinkHandler />
          </Suspense>
          <ToastContainer />
          {import.meta.env.DEV && isMobilePreview && (
            <div className="fixed top-1 right-1 z-[999] px-2 py-1 rounded-lg bg-cyan-500/90 text-white text-xs font-bold shadow-lg pointer-events-none select-none">
              MOBILE PREVIEW
            </div>
          )}
        </div>
        </AriaLiveProvider>
      </VibeThemeProvider>
  );
}
