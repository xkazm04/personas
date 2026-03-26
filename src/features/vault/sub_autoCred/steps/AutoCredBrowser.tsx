import { useRef, useCallback, useMemo, useEffect } from 'react';
import { MonitorX, Clock } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { BrowserLogEntry, AutoCredMode } from '../helpers/types';
import { openExternalUrl } from '@/api/system/system';
import {
  deriveSessionState, STATE_CONFIG, useElapsed, groupLogEntries,
  deriveEntryPhase, PHASE_LABELS,
  type SessionState, type GroupedEntry,
} from '../helpers/autoCredHelpers';
import {
  ActionBlock, WaitingCard, UrlCard, InputRequestCard,
  ErrorLine, CopyLogButton,
} from '../display/AutoCredLogEntries';

const DIVIDER_COLORS: Record<SessionState, { text: string; line: string }> = {
  connecting: { text: 'text-muted-foreground/30', line: 'bg-primary/8' },
  working: { text: 'text-cyan-400/30', line: 'bg-cyan-500/10' },
  action_required: { text: 'text-amber-400/30', line: 'bg-amber-500/10' },
  opening_url: { text: 'text-blue-400/30', line: 'bg-blue-500/10' },
};

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

  const prevGroupCountRef = useRef(0);

  const annotatedItems = useMemo(() => {
    const items: (
      | { kind: 'divider'; phase: SessionState; label: string; id: string }
      | { kind: 'entry'; group: GroupedEntry; gi: number; delay: number }
    )[] = [];
    let currentPhase: SessionState | null = null;
    let newCounter = 0;

    for (let gi = 0; gi < groupedEntries.length; gi++) {
      const group = groupedEntries[gi]!;
      const phase = deriveEntryPhase(group);

      if (phase !== currentPhase) {
        currentPhase = phase;
        items.push({ kind: 'divider', phase, label: PHASE_LABELS[phase], id: `phase-before-${gi}` });
      }

      const isNew = gi >= prevGroupCountRef.current;
      items.push({ kind: 'entry', group, gi, delay: isNew ? Math.min(newCounter, 8) * 0.08 : 0 });
      if (isNew) newCounter++;
    }

    return items;
  }, [groupedEntries]);

  useEffect(() => { prevGroupCountRef.current = groupedEntries.length; });

  return (
    <div
      className="animate-fade-slide-in space-y-3"
    >
      {/* Dynamic status banner */}
      <div
          key={sessionState}
          className={`animate-fade-slide-in flex items-center gap-3 p-3 rounded-xl border ${config.borderColor} ${config.bgColor}`}
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
              <LoadingSpinner className={`${config.color} opacity-60`} />
            )}
          </div>
        </div>

      {/* Browser hands-off warning (playwright mode only) */}
      {!isGuided && (sessionState === 'connecting' || sessionState === 'working') && (
        <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-orange-500/20 bg-orange-500/5">
          <MonitorX className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground/70">
            <span className="font-medium text-orange-400/90">Do not interact with the browser.</span>{' '}
            The automation controls the browser window directly -- clicking, scrolling or typing in it may break the process.
          </p>
        </div>
      )}

      {/* Full scrollable log */}
      <div
        ref={scrollRef}
        className="max-h-[40rem] overflow-y-auto rounded-xl border border-primary/10 bg-black/20 p-3 space-y-2"
      >
        {annotatedItems.map((item) => {
          if (item.kind === 'divider') {
            const colors = DIVIDER_COLORS[item.phase];
            return (
              <div
                key={item.id}
                className="animate-fade-slide-in flex items-center gap-2 py-1.5"
              >
                <div className={`flex-1 h-px ${colors.line}`} />
                <span className={`text-[10px] uppercase tracking-widest font-medium shrink-0 ${colors.text}`}>
                  {item.label}
                </span>
                <div className={`flex-1 h-px ${colors.line}`} />
              </div>
            );
          }
          const { group, gi, delay: _delay } = item;
          return (
            <div className="animate-fade-slide-in"
              key={`entry-${gi}`}
            >
              {group.kind === 'action_block' ? (
                <ActionBlock entries={group.entries} onUrlClick={handleUrlClick} />
              ) : group.entry.type === 'warning' ? (
                <WaitingCard entry={group.entry} isLatest={gi === lastWarningIndex} />
              ) : group.entry.type === 'url' ? (
                <UrlCard entry={group.entry} onUrlClick={handleUrlClick} />
              ) : group.entry.type === 'input_request' ? (
                <InputRequestCard entry={group.entry} />
              ) : group.entry.type === 'error' ? (
                <ErrorLine entry={group.entry} />
              ) : null}
            </div>
          );
        })}

        {visibleLogs.length === 0 && (
          <div className="text-muted-foreground/60 text-center py-10 space-y-2">
            <LoadingSpinner size="xl" className="mx-auto text-muted-foreground/50" />
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
    </div>
  );
}
