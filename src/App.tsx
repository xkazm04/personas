import { useEffect } from "react";
import { MotionConfig } from "framer-motion";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/shared/components/UpdateBanner";
import { HealingToast } from "@/features/shared/components/HealingToast";
import { ToastContainer } from "@/features/shared/components/ToastContainer";
import { ProvisioningWizard } from "@/features/vault/sub_wizard/ProvisioningWizard";
import { initAuthListener, useAuthStore } from "@/stores/authStore";
import { registerKnowledgeMiddleware } from "@/lib/execution/knowledgeMiddleware";
import { useLabEvents } from "@/hooks/lab/useLabEvents";

// Register pipeline middleware once at module load
registerKnowledgeMiddleware();

export default function App() {
  useEffect(() => {
    initAuthListener();
    useAuthStore.getState().initialize();
  }, []);

  // Global lab event listeners — hoisted here so they survive tab navigation
  useLabEvents();

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
        <UpdateBanner />
        <div className="flex flex-1 overflow-hidden">
          <PersonasPage />
        </div>
        <HealingToast />
        <ToastContainer />
        <ProvisioningWizard />
      </div>
    </MotionConfig>
  );
}
