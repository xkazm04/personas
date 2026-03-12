import { useState, useEffect } from 'react';
import type { BrowserLogEntry } from './types';
import type { LucideIcon } from 'lucide-react';
import { Loader2, Cog, Hand, ExternalLink } from 'lucide-react';

// -- Derived session state -----------------------------------------------

export type SessionState = 'connecting' | 'working' | 'action_required' | 'opening_url';

export function deriveSessionState(logs: BrowserLogEntry[]): SessionState {
  if (logs.length === 0) return 'connecting';
  for (let i = logs.length - 1; i >= 0; i--) {
    const entry = logs[i]!;
    if (entry.type === 'warning' || entry.type === 'input_request') return 'action_required';
    if (entry.type === 'url') return 'opening_url';
    if (entry.type === 'action' || entry.type === 'info') return 'working';
  }
  return 'working';
}

export interface StateConfig {
  label: string;
  sublabel: string;
  guidedSublabel: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  borderColor: string;
  pulse: boolean;
}

export const STATE_CONFIG: Record<SessionState, StateConfig> = {
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
    sublabel: 'Browser automation in progress -- no action needed',
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

// -- Elapsed timer -------------------------------------------------------

export function useElapsed(startTs: number | null) {
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

// -- Grouped log entries -------------------------------------------------

export type GroupedEntry =
  | { kind: 'action_block'; entries: BrowserLogEntry[] }
  | { kind: 'single'; entry: BrowserLogEntry };

export function groupLogEntries(logs: BrowserLogEntry[]): GroupedEntry[] {
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

// -- Rich message URL splitting ------------------------------------------

export const URL_REGEX = /https?:\/\/[^\s)>\]"'`*_]+/g;

export interface TextPart {
  text: string;
  isUrl: boolean;
}

export function splitByUrls(text: string): TextPart[] {
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

// -- Log copy formatter --------------------------------------------------

export function formatLogsForCopy(logs: BrowserLogEntry[]): string {
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
