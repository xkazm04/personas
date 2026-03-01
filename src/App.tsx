import { useEffect } from "react";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/shared/components/UpdateBanner";
import { HealingToast } from "@/features/shared/components/HealingToast";
import { initAuthListener, useAuthStore } from "@/stores/authStore";
import { registerKnowledgeMiddleware } from "@/lib/execution/knowledgeMiddleware";

// Register pipeline middleware once at module load
registerKnowledgeMiddleware();

export default function App() {
  useEffect(() => {
    initAuthListener();
    useAuthStore.getState().initialize();
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <UpdateBanner />
      <div className="flex flex-1 overflow-hidden">
        <PersonasPage />
      </div>
      <HealingToast />
    </div>
  );
}
