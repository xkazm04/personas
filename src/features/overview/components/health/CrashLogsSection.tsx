import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  XCircle,
  FileWarning,
  ChevronDown,
  ChevronRight,
  Trash2,
} from 'lucide-react';
import { clearCrashLogs, getCrashLogs } from "@/api/system/system";
import { readCrashLogs, CRASH_STORAGE_KEY } from '@/lib/utils/crashPersistence';
import type { CrashLogEntry } from "@/api/system/system";

export function CrashLogsSection() {
  const [expanded, setExpanded] = useState(false);
  const [backendLogs, setBackendLogs] = useState<CrashLogEntry[]>([]);
  const [frontendLogs, setFrontendLogs] = useState<Array<{ timestamp: string; component: string; message: string; stack?: string }>>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (expanded) {
      let cancelled = false;
      getCrashLogs()
        .then((data) => { if (!cancelled) setBackendLogs(data); })
        .catch(() => { if (!cancelled) setBackendLogs([]); });
      if (!cancelled) setFrontendLogs(readCrashLogs());
      return () => { cancelled = true; };
    }
  }, [expanded]);

  const totalCount = backendLogs.length + frontendLogs.length;

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearCrashLogs();
      localStorage.removeItem(CRASH_STORAGE_KEY);
      setBackendLogs([]);
      setFrontendLogs([]);
      setSelectedLog(null);
    } catch {
      // intentional: non-critical -- crash log clear is best-effort
    } finally {
      setClearing(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-secondary/30 transition-colors cursor-pointer"
      >
        <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-red-500/10">
          <FileWarning className="w-3.5 h-3.5 text-red-300" />
        </div>
        <span className="text-sm font-medium text-foreground/80 uppercase tracking-wider">
          Crash Logs
        </span>
        {totalCount > 0 && (
          <span className="ml-1 px-1.5 py-0.5 text-sm font-medium rounded-full bg-red-500/15 text-red-400">
            {totalCount}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {totalCount > 0 && expanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                void handleClear();
              }}
              disabled={clearing}
              className="flex items-center gap-1 px-2 py-1 text-sm rounded-lg text-red-400/60 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}
          {expanded ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/80" /> : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/80" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-primary/5 px-4 py-3 space-y-2 max-h-80 overflow-y-auto">
              {totalCount === 0 && (
                <p className="text-sm text-muted-foreground/80 py-2">No crash logs recorded.</p>
              )}

              {backendLogs.map((log) => {
                const isAutoCred = log.filename.startsWith('autocred_');
                const crashLabel = isAutoCred ? 'Auto-cred session' : 'Rust panic';
                const crashColor = isAutoCred ? 'text-amber-400/60' : 'text-red-400/60';
                const CrashIcon = isAutoCred ? AlertTriangle : XCircle;
                return (
                <div key={log.filename} className="rounded-lg border border-primary/10 bg-background/40 overflow-hidden">
                  <button
                    onClick={() => setSelectedLog(selectedLog === log.filename ? null : log.filename)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors"
                  >
                    <CrashIcon className={`w-3.5 h-3.5 flex-shrink-0 ${isAutoCred ? 'text-amber-400' : 'text-red-400'}`} />
                    <span className="text-sm text-foreground/90 font-mono truncate">{log.filename}</span>
                    <span className={`ml-auto text-sm font-medium ${crashColor}`}>{crashLabel}</span>
                  </button>
                  {selectedLog === log.filename && (
                    <div className="border-t border-primary/5 px-3 py-2">
                      <pre className="text-sm text-muted-foreground/90 whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono leading-relaxed">
                        {log.content}
                      </pre>
                    </div>
                  )}
                </div>
                );
              })}

              {frontendLogs.map((log, i) => (
                <div key={`fe-${i}`} className="rounded-lg border border-primary/10 bg-background/40 overflow-hidden">
                  <button
                    onClick={() => setSelectedLog(selectedLog === `fe-${i}` ? null : `fe-${i}`)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-secondary/30 transition-colors"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                    <span className="text-sm text-foreground/90 truncate">{log.message}</span>
                    <span className="ml-auto text-sm text-amber-400/60 font-medium flex-shrink-0">{log.component}</span>
                  </button>
                  {selectedLog === `fe-${i}` && (
                    <div className="border-t border-primary/5 px-3 py-2 space-y-1">
                      <p className="text-sm text-muted-foreground/80">
                        {log.timestamp}
                      </p>
                      {log.stack && (
                        <pre className="text-sm text-muted-foreground/90 whitespace-pre-wrap break-all max-h-48 overflow-y-auto font-mono leading-relaxed">
                          {log.stack}
                        </pre>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
