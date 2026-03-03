import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Globe, Loader2, AlertTriangle, Info, MousePointerClick } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import type { BrowserLogEntry } from './types';

interface AutoCredBrowserProps {
  designResult: CredentialDesignResult;
  logs: BrowserLogEntry[];
  onCancel: () => void;
}

const ICON_MAP: Record<BrowserLogEntry['type'], typeof Info> = {
  info: Info,
  action: MousePointerClick,
  warning: AlertTriangle,
  error: AlertTriangle,
};

const COLOR_MAP: Record<BrowserLogEntry['type'], string> = {
  info: 'text-muted-foreground/70',
  action: 'text-cyan-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

export function AutoCredBrowser({ designResult, logs, onCancel }: AutoCredBrowserProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Status header */}
      <div className="flex items-center gap-3 p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5">
        <div className="relative">
          <Globe className="w-5 h-5 text-cyan-400" />
          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">
            Browser session active — {designResult.connector.label}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-0.5">
            Playwright MCP is controlling the browser
          </p>
        </div>
        <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
      </div>

      {/* Log output */}
      <div
        ref={scrollRef}
        className="h-64 overflow-y-auto rounded-xl border border-primary/10 bg-black/30 p-3 font-mono text-xs space-y-1"
      >
        {logs.map((entry, i) => {
          const Icon = ICON_MAP[entry.type];
          const color = COLOR_MAP[entry.type];
          return (
            <div key={i} className={`flex items-start gap-2 ${color}`}>
              <Icon className="w-3 h-3 mt-0.5 shrink-0" />
              <span className="text-muted-foreground/60 select-none shrink-0">
                {new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span>{entry.message}</span>
            </div>
          );
        })}
        {logs.length === 0 && (
          <div className="text-muted-foreground/60 text-center py-8">
            Waiting for browser session to start...
          </div>
        )}
      </div>

      {/* Cancel */}
      <div className="flex justify-end">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-red-400/80 hover:text-red-400 rounded-lg border border-red-500/15 hover:bg-red-500/10 transition-colors"
        >
          Cancel Session
        </button>
      </div>
    </motion.div>
  );
}
