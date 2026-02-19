import { useState, useEffect, useRef, useCallback } from 'react';
import { X, AlertTriangle, Wrench, CheckCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';
import { SEVERITY_COLORS, HEALING_CATEGORY_COLORS } from '@/lib/utils/formatters';

interface HealingIssueModalProps {
  issue: PersonaHealingIssue;
  onResolve: (id: string) => void;
  onClose: () => void;
}

export default function HealingIssueModal({ issue, onResolve, onClose }: HealingIssueModalProps) {
  const [resolved, setResolved] = useState(false);
  const defaultSev = { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' };
  const defaultCat = { bg: 'bg-violet-500/10', text: 'text-violet-400', border: 'border-violet-500/20' };
  const sev = SEVERITY_COLORS[issue.severity] ?? defaultSev;
  const cat = HEALING_CATEGORY_COLORS[issue.category] ?? defaultCat;
  const isAutoFixed = issue.auto_fixed;

  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Auto-focus close button on mount
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Escape key handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Auto-close after resolve animation
  useEffect(() => {
    if (!resolved) return;
    const timer = setTimeout(onClose, 800);
    return () => clearTimeout(timer);
  }, [resolved, onClose]);

  // Focus trap: keep Tab within the modal
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  const handleResolve = useCallback(() => {
    onResolve(issue.id);
    setResolved(true);
  }, [onResolve, issue.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="healing-issue-title"
        onKeyDown={handleKeyDown}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="relative w-full max-w-lg mx-4 bg-background border border-primary/20 rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <AnimatePresence mode="wait">
          {resolved ? (
            <motion.div
              key="success"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex flex-col items-center justify-center py-16 px-8"
            >
              {/* Burst ring */}
              <div className="relative">
                <motion.div
                  initial={{ scale: 0, opacity: 0.8 }}
                  animate={{ scale: 2.5, opacity: 0 }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="absolute inset-0 rounded-full border-2 border-emerald-400/40"
                  style={{ width: 48, height: 48, top: -4, left: -4 }}
                />
                <motion.div
                  initial={{ scale: 0, opacity: 0.5 }}
                  animate={{ scale: 3, opacity: 0 }}
                  transition={{ duration: 0.7, ease: 'easeOut', delay: 0.05 }}
                  className="absolute inset-0 rounded-full border border-emerald-400/20"
                  style={{ width: 48, height: 48, top: -4, left: -4 }}
                />
                {/* CheckCircle icon with spring */}
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 15, stiffness: 300 }}
                >
                  <CheckCircle className="w-10 h-10 text-emerald-400" strokeWidth={1.5} />
                </motion.div>
              </div>

              {/* Text */}
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15, duration: 0.3 }}
                className="mt-4 text-sm font-medium text-emerald-400"
              >
                Issue Resolved
              </motion.p>
            </motion.div>
          ) : (
            <motion.div
              key="content"
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
            >
              {/* Header */}
              <div className="flex items-start justify-between p-5 border-b border-primary/10">
                <div className="flex-1 min-w-0 pr-4">
                  <h3 id="healing-issue-title" className="text-sm font-semibold text-foreground/90 mb-2">{issue.title}</h3>
                  <div className="flex items-center gap-2">
                    {isAutoFixed ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase rounded-md border bg-emerald-500/10 text-emerald-400 border-emerald-500/20">
                        <CheckCircle className="w-3 h-3" />
                        auto-fixed
                      </span>
                    ) : (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase rounded-md border ${sev.bg} ${sev.text} ${sev.border}`}>
                        <AlertTriangle className="w-3 h-3" />
                        {issue.severity}
                      </span>
                    )}
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono uppercase rounded-md border ${cat.bg} ${cat.text} ${cat.border}`}>
                      {issue.category}
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      {new Date(issue.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  ref={closeButtonRef}
                  onClick={onClose}
                  className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Description */}
              <div className="p-5 space-y-4 max-h-[60vh] overflow-y-auto">
                <div>
                  <h4 className="text-xs font-mono uppercase text-muted-foreground/50 mb-2">Analysis</h4>
                  <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {issue.description}
                  </div>
                </div>

                {issue.suggested_fix && (
                  <div className="p-4 rounded-xl bg-emerald-500/5 border border-emerald-500/15">
                    <div className="flex items-center gap-2 mb-2">
                      <Wrench className="w-3.5 h-3.5 text-emerald-400" />
                      <h4 className="text-xs font-mono uppercase text-emerald-400/80">Suggested Fix</h4>
                    </div>
                    <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                      {issue.suggested_fix}
                    </div>
                  </div>
                )}

                {issue.execution_id && (
                  <div className="text-[10px] font-mono text-muted-foreground/30">
                    Execution: {issue.execution_id}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 p-4 border-t border-primary/10 bg-secondary/20">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-medium text-muted-foreground/60 hover:text-foreground/80 rounded-lg hover:bg-secondary/60 transition-colors"
                >
                  Close
                </button>
                {!isAutoFixed && (
                  <button
                    onClick={handleResolve}
                    className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/25 rounded-lg hover:bg-emerald-500/20 transition-colors"
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    Resolve
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
