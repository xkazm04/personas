import { motion } from "framer-motion";
import { Map, RotateCcw } from "lucide-react";
import { usePersonaStore } from "@/stores/personaStore";

export default function TourLauncher() {
  const tourCompleted = usePersonaStore((s) => s.tourCompleted);
  const tourDismissed = usePersonaStore((s) => s.tourDismissed);
  const tourActive = usePersonaStore((s) => s.tourActive);
  const resetTour = usePersonaStore((s) => s.resetTour);

  if (tourActive) return null;

  const hasFinished = tourCompleted || tourDismissed;

  const handleStart = () => {
    if (hasFinished) {
      resetTour();
    }
    setTimeout(() => {
      usePersonaStore.getState().startTour();
    }, 50);
  };

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.4, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      onClick={handleStart}
      className="flex-shrink-0 flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
        bg-violet-500/10 text-violet-300 border border-violet-500/25
        hover:bg-violet-500/20 hover:border-violet-400/40 hover:shadow-[0_0_16px_rgba(139,92,246,0.15)]
        transition-all duration-300 cursor-pointer"
    >
      {hasFinished ? (
        <>
          <RotateCcw className="w-3.5 h-3.5" />
          Restart Tour
        </>
      ) : (
        <>
          <Map className="w-3.5 h-3.5" />
          Start Tour
        </>
      )}
    </motion.button>
  );
}
