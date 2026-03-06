import { useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/shared/components/UpdateBanner";
import { HealingToast } from "@/features/shared/components/HealingToast";
import { ToastContainer } from "@/features/shared/components/ToastContainer";
import { FirstUseConsentModal, hasUserConsented } from "@/features/shared/components/FirstUseConsentModal";
import { ProvisioningWizard } from "@/features/vault/sub_wizard/ProvisioningWizard";
import { initAuthListener, useAuthStore } from "@/stores/authStore";
import { registerKnowledgeMiddleware } from "@/lib/execution/knowledgeMiddleware";
import { useLabEvents } from "@/hooks/lab/useLabEvents";
import { useHealthDigestScheduler } from "@/features/agents/health";
import OnboardingOverlay from "@/features/onboarding/components/OnboardingOverlay";
import ExecutionMiniPlayer from "@/features/execution/components/ExecutionMiniPlayer";
import VibeThemeProvider from "@/features/shared/components/VibeThemeProvider";

// Register pipeline middleware once at module load
registerKnowledgeMiddleware();

export default function App() {
  const [consented, setConsented] = useState(hasUserConsented);

  useEffect(() => {
    initAuthListener();
    useAuthStore.getState().initialize();
  }, []);

  // Global lab event listeners — hoisted here so they survive tab navigation
  useLabEvents();

  // Weekly health digest scheduler — checks on mount if a digest is overdue
  useHealthDigestScheduler();

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
          <ProvisioningWizard />
          <OnboardingOverlay />
          <ExecutionMiniPlayer />
        </div>
      </VibeThemeProvider>
    </MotionConfig>
  );
}
