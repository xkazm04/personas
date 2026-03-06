import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Loader2,
  AlertTriangle,
  MousePointerClick,
  ExternalLink,
  MessageSquare,
  Hand,
  Clock,
  Cog,
  Copy,
  Check,
  MonitorX,
} from 'lucide-react';
import type { BrowserLogEntry, AutoCredMode } from './types';
import { openExternalUrl } from '@/api/system';

interface AutoCredBrowserProps {
  logs: BrowserLogEntry[];
  onCancel: () => void;
  mode?: AutoCredMode;
}

// ── Derived session state ───────────────────────────────────────────────

type SessionState = 'connecting' | 'working' | 'action_required' | 'opening_url';

function deriveSessionState(logs: BrowserLogEntry[]): SessionState {
  if (logs.length === 0) return 'connecting';

  // Walk backwards to find the latest meaningful state
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]!;
    if (entry.type === 'warning' || entry.type === 'input_request') return 'action_required';
    if (entry.type === 'url') return 'opening_url';
    if (entry.type === 'action' || entry.type === 'info') return 'working';
  }
  return 'working';
}

const STATE_CONFIG: Record<SessionState, {
  label: string;
  sublabel: string;
  guidedSublabel: string;
  icon: typeof Cog;
  color: string;
  bgColor: string;
  borderColor: string;
  pulse: boolean;
}> = {
  connecting: {
    label: 'Connecting...',
    sublabel: 'Setting up Claude CLI session',
    guidedSublabel: 'Preparing guided setup instructions',
    icon: Loader2,
    color: 'text-muted-foreground/70',
    bgColor: 'bg-secondary/20',
    borderColor: 'border-primary/10',
    pulse: false,
  },
  working: {
    label: 'Claude is working',
    sublabel: 'Browser automation in progress — no action needed',
    guidedSublabel: 'Generating step-by-step instructions...',
    icon: Cog,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/5',
    borderColor: 'border-cyan-500/20',
    pulse: false,
  },
  action_required: {
    label: 'Your action needed',
    sublabel: 'Please complete the step described below',
    guidedSublabel: 'Please follow the instruction below',
    icon: Hand,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/8',
    borderColor: 'border-amber-500/30',
    pulse: true,
  },
  opening_url: {
    label: 'URL opened in browser',
    sublabel: 'A page was opened in your default browser',
    guidedSublabel: 'A page was opened in your default browser',
    icon: ExternalLink,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/5',
    borderColor: 'border-blue-500/20',
    pulse: false,
  },
};

// ── Elapsed timer ───────────────────────────────────────────────────────

function useElapsed(startTs: number | null) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!startTs) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [startTs]);
  if (!startTs) return null;
  const secs = Math.floor((now - startTs) / 1000);
  const mins = Math.floor(secs / 60);
  const remainder = secs % 60;
  return mins > 0
    ? `${mins}:${String(remainder).padStart(2, '0')}`
    : `${secs}s`;
}

// ── Main component ──────────────────────────────────────────────────────

export function AutoCredBrowser({ logs, onCancel, mode = 'playwright' }: AutoCredBrowserProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isGuided = mode === 'guided';
  const sessionState = deriveSessionState(logs);
  const config = STATE_CONFIG[sessionState];
  const StateIcon = config.icon;
  const startTs = logs.length > 0 ? logs[0]!.ts : null;
  const elapsed = useElapsed(startTs);

  // Filter out info-type entries (setup noise: "Connected...", "Analyzing...")
  // Only show action, warning, url, input_request, error in the log
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

  // Group consecutive action entries for better readability
  const groupedEntries = useMemo(() => groupLogEntries(visibleLogs), [visibleLogs]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-3"
    >
      {/* ── Dynamic status banner ───────────────────────────────── */}
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
            <p className={`text-sm font-semibold ${config.color}`}>
              {config.label}
            </p>
            <p className="text-sm text-muted-foreground/50 mt-0.5">
              {isGuided ? config.guidedSublabel : config.sublabel}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {elapsed && (
              <span className="flex items-center gap-1 text-sm text-muted-foreground/40 tabular-nums">
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

      {/* ── Browser hands-off warning (playwright mode only) ──── */}
      {!isGuided && (sessionState === 'connecting' || sessionState === 'working') && (
        <div className="flex items-start gap-2.5 px-3 py-2 rounded-lg border border-orange-500/20 bg-orange-500/5">
          <MonitorX className="w-3.5 h-3.5 text-orange-400 mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground/70">
            <span className="font-medium text-orange-400/90">Do not interact with the browser.</span>{' '}
            The automation controls the browser window directly — clicking, scrolling or typing in it may break the process.
          </p>
        </div>
      )}

      {/* ── Full scrollable log (info entries filtered out) ─────── */}
      <div
        ref={scrollRef}
        className="max-h-[40rem] overflow-y-auto rounded-xl border border-primary/10 bg-black/20 p-3 space-y-2"
      >
        {groupedEntries.map((group, gi) => {
          if (group.kind === 'action_block') {
            return (
              <ActionBlock
                key={gi}
                entries={group.entries}
                onUrlClick={handleUrlClick}
              />
            );
          }
          const entry = group.entry;
          if (entry.type === 'warning') {
            return <WaitingCard key={gi} entry={entry} />;
          }
          if (entry.type === 'url') {
            return <UrlCard key={gi} entry={entry} onUrlClick={handleUrlClick} />;
          }
          if (entry.type === 'input_request') {
            return <InputRequestCard key={gi} entry={entry} />;
          }
          if (entry.type === 'error') {
            return <ErrorLine key={gi} entry={entry} />;
          }
          return null;
        })}

        {visibleLogs.length === 0 && (
          <div className="text-muted-foreground/40 text-center py-10 space-y-2">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground/30" />
            <p className="text-sm">
              {isGuided ? 'Preparing guided setup instructions...' : 'Starting browser session...'}
            </p>
          </div>
        )}
      </div>

      {/* ── Actions ─────────────────────────────────────────────── */}
      <div className="flex justify-between">
        {import.meta.env.VITE_DEVELOPMENT === 'true' ? <CopyLogButton logs={logs} /> : <div />}
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

// ── Copy log button ─────────────────────────────────────────────────────

function formatLogsForCopy(logs: BrowserLogEntry[]): string {
  return logs
    .map((entry) => {
      const time = new Date(entry.ts).toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      const prefix = entry.type === 'error' ? '[ERROR]' :
        entry.type === 'warning' ? '[WARN]' :
        entry.type === 'url' ? '[URL]' :
        entry.type === 'input_request' ? '[INPUT]' :
        entry.type === 'action' ? '[ACTION]' : '[INFO]';
      return `${time} ${prefix} ${entry.message}`;
    })
    .join('\n');
}

function CopyLogButton({ logs }: { logs: BrowserLogEntry[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (logs.length === 0) return;
    navigator.clipboard.writeText(formatLogsForCopy(logs)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(console.error);
  }, [logs]);

  if (logs.length === 0) return <div />;

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground/60 hover:text-muted-foreground rounded-lg hover:bg-secondary/30 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy Log</span>
        </>
      )}
    </button>
  );
}

// ── Grouped log entries ─────────────────────────────────────────────────

type GroupedEntry =
  | { kind: 'action_block'; entries: BrowserLogEntry[] }
  | { kind: 'single'; entry: BrowserLogEntry };

function groupLogEntries(logs: BrowserLogEntry[]): GroupedEntry[] {
  const groups: GroupedEntry[] = [];
  let actionBuffer: BrowserLogEntry[] = [];

  const flushActions = () => {
    if (actionBuffer.length > 0) {
      groups.push({ kind: 'action_block', entries: [...actionBuffer] });
      actionBuffer = [];
    }
  };

  for (const entry of logs) {
    if (entry.type === 'action') {
      actionBuffer.push(entry);
    } else {
      flushActions();
      groups.push({ kind: 'single', entry });
    }
  }
  flushActions();

  return groups;
}

// ── Specialized entry renderers ─────────────────────────────────────────

/** Consecutive instruction/action lines grouped into a readable block */
function ActionBlock({
  entries,
  onUrlClick,
}: {
  entries: BrowserLogEntry[];
  onUrlClick: (url: string) => void;
}) {
  return (
    <div className="rounded-lg bg-secondary/10 border border-primary/5 px-3 py-2 space-y-1">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 text-sm text-foreground/80">
          <MousePointerClick className="w-3 h-3 mt-1 shrink-0 text-cyan-400/60" />
          <span className="leading-relaxed">
            <RichMessage message={entry.message} onUrlClick={onUrlClick} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Prominent amber card for WAITING: messages — "your action needed" */
function WaitingCard({ entry }: { entry: BrowserLogEntry }) {
  // Strip the "WAITING:" prefix for display
  const message = entry.message.replace(/^WAITING:\s*/i, '');

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-start gap-3 p-3 rounded-xl border-2 border-amber-500/30 bg-amber-500/8"
    >
      <div className="w-8 h-8 rounded-full bg-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
        <Hand className="w-4 h-4 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-400">Action Required</p>
        <p className="text-sm text-foreground/80 mt-1 leading-relaxed">{message}</p>
      </div>
    </motion.div>
  );
}

/** Blue card for URL open events */
function UrlCard({
  entry,
  onUrlClick,
}: {
  entry: BrowserLogEntry;
  onUrlClick: (url: string) => void;
}) {
  const url = entry.url ?? '';
  // Display friendly hostname
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch { /* ignore */ }

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-lg border border-blue-500/20 bg-blue-500/5">
      <ExternalLink className="w-4 h-4 text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground/80">{entry.message.replace(/^Opening:\s*/, '')}</p>
        {hostname && (
          <p className="text-sm text-muted-foreground/50 truncate">{hostname}</p>
        )}
      </div>
      {url && (
        <button
          onClick={() => onUrlClick(url)}
          className="px-3 py-1 text-sm text-blue-400 hover:text-blue-300 rounded-lg border border-blue-500/20 hover:bg-blue-500/10 transition-colors shrink-0"
        >
          Open
        </button>
      )}
    </div>
  );
}

/** Violet card for input requests */
function InputRequestCard({ entry }: { entry: BrowserLogEntry }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-start gap-3 p-3 rounded-xl border-2 border-violet-500/30 bg-violet-500/8"
    >
      <div className="w-8 h-8 rounded-full bg-violet-500/15 flex items-center justify-center shrink-0 mt-0.5">
        <MessageSquare className="w-4 h-4 text-violet-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-violet-400">Input Requested</p>
        <p className="text-sm text-foreground/80 mt-1 leading-relaxed">{entry.message}</p>
      </div>
    </motion.div>
  );
}

/** Error line */
function ErrorLine({ entry }: { entry: BrowserLogEntry }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-400 px-1">
      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
      <span>{entry.message}</span>
    </div>
  );
}

// ── Rich message with clickable URLs ────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s)>\]"'`*_]+/g;

function RichMessage({
  message,
  onUrlClick,
}: {
  message: string;
  onUrlClick: (url: string) => void;
}) {
  const parts = splitByUrls(message);
  if (parts.length === 1 && !parts[0]!.isUrl) {
    return <>{message}</>;
  }

  return (
    <>
      {parts.map((part, i) =>
        part.isUrl ? (
          <button
            key={i}
            onClick={() => onUrlClick(part.text)}
            className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer transition-colors"
            title={`Open ${part.text} in browser`}
          >
            {part.text}
            <ExternalLink className="w-2.5 h-2.5 inline-block ml-0.5" />
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

interface TextPart {
  text: string;
  isUrl: boolean;
}

function splitByUrls(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isUrl: false });
    }
    parts.push({ text: match[0], isUrl: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isUrl: false });
  }

  return parts.length > 0 ? parts : [{ text, isUrl: false }];
}
