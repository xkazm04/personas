import { motion } from "framer-motion";
import { Map, RotateCcw } from "lucide-react";
import { usePersonaStore } from "@/stores/personaStore";

<<<<<<< HEAD
=======
/**
 * A call-to-action card that appears on the home/welcome page
 * inviting first-time users to take the guided tour.
 * Also allows restarting the tour for returning users.
 */
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
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
<<<<<<< HEAD
=======
    // Small delay after reset so state clears
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
    setTimeout(() => {
      usePersonaStore.getState().startTour();
    }, 50);
  };

  return (
<<<<<<< HEAD
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
=======
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-violet-500/15 bg-gradient-to-br from-violet-500/5 via-background to-blue-500/5 p-5 space-y-3"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
          <Map className="w-5 h-5 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground/90">
            {hasFinished ? "Take the tour again?" : "New here? Take the guided tour"}
          </h3>
          <p className="text-sm text-muted-foreground/60 mt-0.5 leading-relaxed">
            {hasFinished
              ? "Revisit the key areas of the app with an interactive walkthrough."
              : "Walk through credentials, templates, agent execution, and monitoring in 4 quick steps. The tour won't block your view \u2014 explore freely as you go."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 pl-[52px]">
        <button
          onClick={handleStart}
          className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl
            bg-violet-500/15 text-violet-300 border border-violet-500/25
            hover:bg-violet-500/25 transition-colors"
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
        </button>
      </div>
    </motion.div>
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  );
}
