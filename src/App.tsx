<<<<<<< HEAD
import { useEffect, useState, useCallback } from "react";
=======
import { useEffect, useState } from "react";
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import { MotionConfig } from "framer-motion";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/shared/components/UpdateBanner";
import { HealingToast } from "@/features/shared/components/HealingToast";
import { ToastContainer } from "@/features/shared/components/ToastContainer";
import { FirstUseConsentModal, hasUserConsented } from "@/features/shared/components/FirstUseConsentModal";
import { initAuthListener, useAuthStore } from "@/stores/authStore";
import { registerKnowledgeMiddleware } from "@/lib/execution/knowledgeMiddleware";
import { useLabEvents } from "@/hooks/lab/useLabEvents";
import { useHealthDigestScheduler } from "@/features/agents/health";
<<<<<<< HEAD
import { useCredentialRemediation } from "@/features/vault/hooks/useCredentialRemediation";
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
import OnboardingOverlay from "@/features/onboarding/components/OnboardingOverlay";
import GuidedTour from "@/features/onboarding/components/GuidedTour";
import ExecutionMiniPlayer from "@/features/execution/components/ExecutionMiniPlayer";
import VibeThemeProvider from "@/features/shared/components/VibeThemeProvider";
import CommandPalette from "@/features/shared/components/CommandPalette";
<<<<<<< HEAD
import { AlertToastContainer } from "@/features/overview/sub_observability/components/AlertToastContainer";
import { toggleMobilePreview } from "@/lib/utils/platform";
import { useMobilePreview } from "@/hooks/utility/useMobilePreview";
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

// Register pipeline middleware once at module load
registerKnowledgeMiddleware();

export default function App() {
  const [consented, setConsented] = useState(hasUserConsented);

  useEffect(() => {
    initAuthListener();
    void useAuthStore.getState().initialize();
  }, []);

<<<<<<< HEAD
  // Dev-mode mobile preview toggle: Ctrl+Shift+M
  const isMobilePreview = useMobilePreview();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'M') {
        e.preventDefault();
        const active = toggleMobilePreview();
        // Force full re-render by reloading — module-level exports updated
        window.location.reload();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  // Global lab event listeners — hoisted here so they survive tab navigation
  useLabEvents();

  // Weekly health digest scheduler — checks on mount if a digest is overdue
  useHealthDigestScheduler();

<<<<<<< HEAD
  // Credential remediation loop — monitors anomaly scores, auto-rotates/disables/notifies
  useCredentialRemediation();

=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  return (
    <MotionConfig reducedMotion="user">
      <VibeThemeProvider>
        <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
          {!consented && <FirstUseConsentModal onAccept={() => setConsented(true)} />}
          <UpdateBanner />
          <div className="flex flex-1 overflow-hidden">
            <PersonasPage />
          </div>
          <HealingToast />
          <ToastContainer />
<<<<<<< HEAD
          <AlertToastContainer />
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
          <OnboardingOverlay />
          <GuidedTour />
          <ExecutionMiniPlayer />
          <CommandPalette />
<<<<<<< HEAD
          {import.meta.env.DEV && isMobilePreview && (
            <div className="fixed top-1 right-1 z-[999] px-2 py-1 rounded-lg bg-cyan-500/90 text-white text-xs font-bold shadow-lg pointer-events-none select-none">
              MOBILE PREVIEW
            </div>
          )}
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
        </div>
      </VibeThemeProvider>
    </MotionConfig>
  );
}
