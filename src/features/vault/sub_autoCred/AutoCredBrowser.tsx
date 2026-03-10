import { useRef, useCallback, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, MonitorX, Clock } from 'lucide-react';
import type { BrowserLogEntry, AutoCredMode } from './types';
import { openExternalUrl } from '@/api/system/system';
import {
  deriveSessionState, STATE_CONFIG, useElapsed, groupLogEntries,
} from './autoCredHelpers';
import {
  ActionBlock, WaitingCard, UrlCard, InputRequestCard,
  ErrorLine, CopyLogButton,
} from './AutoCredLogEntries';

interface AutoCredBrowserProps {
  logs: BrowserLogEntry[];
  onCancel: () => void;
  mode?: AutoCredMode;
}

export function AutoCredBrowser({ logs, onCancel, mode = 'playwright' }: AutoCredBrowserProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isGuided = mode === 'guided';
  const sessionState = deriveSessionState(logs);
  const config = STATE_CONFIG[sessionState];
  const StateIcon = config.icon;
  const startTs = logs.length > 0 ? logs[0]!.ts : null;
  const elapsed = useElapsed(startTs);

  const visibleLogs = useMemo(
    () => logs.filter((e) => e.type !== 'info'),
    [logs],
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [visibleLogs.length]);

  const handleUrlClick = useCallback((url: string) => {
    openExternalUrl(url).catch(console.error);
  }, []);

  const groupedEntries = useMemo(() => groupLogEntries(visibleLogs), [visibleLogs]);

  const lastWarningIndex = useMemo(() => {
    let last = -1;
    for (let i = 0; i < groupedEntries.length; i++) {
      if (groupedEntries[i]!.kind === 'single' && (groupedEntries[i] as { kind: 'single'; entry: BrowserLogEntry }).entry.type === 'warning') {
        last = i;
      }
    }
    return last;
  }, [groupedEntries]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-3"
    >
      {/* Dynamic status banner */}
      <AnimatePresence mode="wait">
        <motion.div
          key={sessionState}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.2 }}
          className={`flex items-center gap-3 p-3 rounded-xl border ${config.borderColor} ${config.bgColor}`}
        >
          <div className="relative">
            {sessionState === 'connecting' || sessionState === 'working' ? (
              <StateIcon className={`w-5 h-5 ${config.color} ${sessionState === 'connecting' ? 'animate-spin' : 'animate-[spin_3s_linear_infinite]'}`} />
            ) : (
              <StateIcon className={`w-5 h-5 ${config.color}`} />
            )}
            {config.pulse && (
              <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-amber-400 animate-ping" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-semibold ${config.color}`}>{config.label}</p>
            <p className="text-sm text-muted-foreground/50 mt-0.5">
              {isGuided ? config.guidedSublabel : config.sublabel}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {elapsed && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground/60 tabular-nums">
                <Clock className="w-3 h-3" />
                {elapsed}
              </span>
            )}
            {(sessionState === 'connecting' || sessionState === 'working') && (
              <Loader2 className={`w-4 h-4 animate-spin ${config.color} opacity-60`} />
            )}
          </div>
        </motion.div>
      </AnimatePresence>

      {/* Browser hands-off warning (playwright mode only) */}
      {!isGuided && (sessionState === 'connecting' || sessionState === 'working') && (
        <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-orange-500/20 bg-orange-500/5">
          <MonitorX className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground/70">
            <span className="font-medium text-orange-400/90">Do not interact with the browser.</span>{' '}
            The automation controls the browser window directly — clicking, scrolling or typing in it may break the process.
          </p>
        </div>
      )}

      {/* Full scrollable log */}
      <div
        ref={scrollRef}
        className="max-h-[40rem] overflow-y-auto rounded-xl border border-primary/10 bg-black/20 p-3 space-y-2"
      >
        {groupedEntries.map((group, gi) => {
          if (group.kind === 'action_block') {
            return <ActionBlock key={gi} entries={group.entries} onUrlClick={handleUrlClick} />;
          }
          const entry = group.entry;
          if (entry.type === 'warning') return <WaitingCard key={gi} entry={entry} isLatest={gi === lastWarningIndex} />;
          if (entry.type === 'url') return <UrlCard key={gi} entry={entry} onUrlClick={handleUrlClick} />;
          if (entry.type === 'input_request') return <InputRequestCard key={gi} entry={entry} />;
          if (entry.type === 'error') return <ErrorLine key={gi} entry={entry} />;
          return null;
        })}

        {visibleLogs.length === 0 && (
          <div className="text-muted-foreground/60 text-center py-10 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground/50" />
            <p className="text-sm">
              {isGuided ? 'Preparing guided setup instructions...' : 'Starting browser session...'}
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        {import.meta.env.DEV ? <CopyLogButton logs={logs} /> : <div />}
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-red-400/80 hover:text-red-400 rounded-xl border border-red-500/15 hover:bg-red-500/10 transition-colors"
        >
          Cancel Session
        </button>
      </div>
    </motion.div>
  );
}
