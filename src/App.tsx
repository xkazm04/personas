import { useEffect } from "react";
import PersonasPage from "@/features/personas/PersonasPage";
import UpdateBanner from "@/features/personas/components/UpdateBanner";
import { initAuthListener, useAuthStore } from "@/stores/authStore";

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
    </div>
  );
}
