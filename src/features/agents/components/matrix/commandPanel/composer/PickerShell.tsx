/**
 * Modal picker shell — used by the Composer variant to open focused,
 * keyboard-first pickers for Schedule / Connectors / Events.
 *
 * Behavior:
 *   · Backdrop blur + click-outside to close
 *   · Esc to close
 *   · ⌘/Ctrl+Enter to apply (when `onApply` is provided)
 *   · AnimatePresence fade+scale for smooth mount/unmount
 *   · Body scrolls if content overflows; header/footer stay pinned
 */
import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

interface PickerShellProps {
  open: boolean;
  onClose: () => void;
  onApply?: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg";
}

export function PickerShell({
  open, onClose, onApply, title, subtitle, icon, children, footer, size = "md",
}: PickerShellProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && onApply) {
        e.preventDefault();
        onApply();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, onApply]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className={`relative w-full ${size === "lg" ? "max-w-3xl" : "max-w-2xl"} rounded-modal border border-card-border bg-card-bg shadow-elevation-4 overflow-hidden flex flex-col max-h-[82vh]`}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center gap-3 px-5 py-4 border-b border-border/25 bg-gradient-to-r from-primary/10 via-transparent to-transparent">
              {icon && (
                <div className="shrink-0 w-10 h-10 rounded-interactive bg-primary/25 text-primary flex items-center justify-center">
                  {icon}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <h2 className="typo-heading-sm text-foreground font-semibold truncate">{title}</h2>
                {subtitle && (
                  <p className="typo-caption text-foreground/70 mt-0.5 truncate">{subtitle}</p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="shrink-0 text-foreground/60 hover:text-foreground hover:bg-foreground/5 p-1.5 rounded-interactive transition-colors"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </header>
            <div className="flex-1 min-h-0 overflow-y-auto">{children}</div>
            {footer && (
              <footer className="px-5 py-3.5 border-t border-border/25 bg-foreground/[0.03] flex items-center justify-between gap-3">
                {footer}
              </footer>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
