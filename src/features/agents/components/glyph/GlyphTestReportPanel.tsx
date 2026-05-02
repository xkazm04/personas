import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, AlertCircle, CheckCircle2 } from "lucide-react";

interface GlyphTestReportPanelProps {
  isOpen: boolean;
  onClose: () => void;
  testPassed?: boolean | null;
  testError?: string | null;
  testOutputLines?: string[];
}

/** Test-report modal — shown after tests complete (pass or fail) so the
 *  user can see the full CLI output and any failure detail. The
 *  test-complete card in the centre of the sigil only has room for a
 *  status icon, a label, and a small error preview clamped to ~2 lines;
 *  this modal carries the rest. */
export function GlyphTestReportPanel({
  isOpen, onClose, testPassed, testError, testOutputLines,
}: GlyphTestReportPanelProps) {
  // ESC dismisses — keyboard parity with click-outside.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          key="report-overlay"
          className="fixed inset-0 z-40 flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          aria-modal="true"
          role="dialog"
        >
          <motion.div
            role="presentation"
            onClick={onClose}
            className="absolute inset-0 bg-background/80 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          />
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 w-full max-w-2xl max-h-[80vh] flex flex-col rounded-modal bg-background/95 backdrop-blur-md border border-card-border shadow-elevation-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border/30">
              {testPassed ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-orange-400" />
              )}
              <span className="typo-label uppercase tracking-[0.18em] font-bold text-foreground/80 flex-1">
                {testPassed ? "Test Report — Passed" : "Test Report — Failed"}
              </span>
              <button
                type="button"
                onClick={onClose}
                className="text-foreground/50 hover:text-foreground rounded-interactive p-1"
                aria-label="Close test report"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
              {testError && (
                <div className="rounded-card border border-orange-500/30 bg-orange-500/[0.06] px-3 py-2.5">
                  <div className="typo-caption uppercase tracking-[0.15em] font-bold text-orange-400 mb-1">
                    Error
                  </div>
                  <p className="typo-body text-foreground whitespace-pre-wrap break-words">
                    {testError}
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <div className="typo-caption uppercase tracking-[0.15em] font-bold text-foreground/65">
                  CLI Output
                </div>
                {testOutputLines && testOutputLines.length > 0 ? (
                  <pre
                    className="typo-caption font-mono text-foreground/85 bg-foreground/[0.04] border border-border/30 rounded-card p-3 overflow-x-auto whitespace-pre-wrap break-words"
                  >
                    {testOutputLines.join("\n")}
                  </pre>
                ) : (
                  <p className="typo-caption text-foreground/55 italic">
                    No CLI output captured.
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
