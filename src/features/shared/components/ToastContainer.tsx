import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { useToastStore, Toast } from '@/stores/toastStore';

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [paused, setPaused] = useState(false);
  const elapsedRef = useRef(0);
  const lastTickRef = useRef(Date.now());

  useEffect(() => {
    if (paused) return;

    lastTickRef.current = Date.now();
    const interval = setInterval(() => {
      const now = Date.now();
      elapsedRef.current += now - lastTickRef.current;
      lastTickRef.current = now;

      if (elapsedRef.current >= toast.duration) {
        onDismiss(toast.id);
      }
    }, 50);

    return () => clearInterval(interval);
  }, [paused, toast.duration, toast.id, onDismiss]);

  const remaining = Math.max(0, toast.duration - elapsedRef.current);
  const progressFraction = remaining / toast.duration;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.95 }}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => {
        lastTickRef.current = Date.now();
        setPaused(false);
      }}
      className={`pointer-events-auto rounded-xl border shadow-lg shadow-black/20 backdrop-blur-md overflow-hidden ${
        toast.type === 'success'
          ? 'bg-emerald-950/90 border-emerald-500/25 text-emerald-300'
          : 'bg-red-950/90 border-red-500/25 text-red-300'
      }`}
    >
      <div className="flex items-center gap-2.5 px-4 py-2.5">
        {toast.type === 'success' ? (
          <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        ) : (
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
        )}
        <span className="text-sm font-medium whitespace-nowrap">{toast.message}</span>
        <button
          onClick={() => onDismiss(toast.id)}
          className="ml-1 opacity-60 hover:opacity-100 transition-opacity flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Auto-dismiss progress bar */}
      <div className="h-0.5 bg-black/20">
        <motion.div
          className={`h-full ${
            toast.type === 'success' ? 'bg-emerald-400/50' : 'bg-red-400/50'
          }`}
          initial={{ width: '100%' }}
          animate={{ width: paused ? `${progressFraction * 100}%` : '0%' }}
          transition={
            paused
              ? { duration: 0 }
              : { duration: remaining / 1000, ease: 'linear' }
          }
        />
      </div>
    </motion.div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  const handleDismiss = useCallback(
    (id: string) => dismiss(id),
    [dismiss],
  );

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none" role="status" aria-live="polite" aria-relevant="additions removals">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={handleDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
