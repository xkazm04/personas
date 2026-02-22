import { AnimatePresence, motion } from "framer-motion";
import { useAutoUpdater } from "@/hooks/utility/useAutoUpdater";

export default function UpdateBanner() {
  const {
    updateAvailable,
    updateInfo,
    isInstalling,
    installUpdate,
    dismissUpdate,
  } = useAutoUpdater();

  return (
    <AnimatePresence>
      {updateAvailable && updateInfo && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          className="overflow-hidden"
        >
          <div className="flex items-center gap-3 px-4 py-2 bg-accent/10 border-b border-accent/20 text-sm">
            <span className="text-accent font-medium shrink-0">
              Update available: v{updateInfo.version}
            </span>

            {updateInfo.body && (
              <span className="text-muted-foreground truncate">
                {updateInfo.body.slice(0, 120)}
                {updateInfo.body.length > 120 ? "..." : ""}
              </span>
            )}

            <div className="ml-auto flex items-center gap-2 shrink-0">
              <button
                onClick={installUpdate}
                disabled={isInstalling}
                className="px-3 py-1 rounded-md bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
              >
                {isInstalling ? "Installing..." : "Install & Restart"}
              </button>
              <button
                onClick={dismissUpdate}
                className="p-1 rounded hover:bg-accent/10 text-muted-foreground transition-colors"
                aria-label="Dismiss"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <path d="M3 3l8 8M11 3l-8 8" />
                </svg>
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
