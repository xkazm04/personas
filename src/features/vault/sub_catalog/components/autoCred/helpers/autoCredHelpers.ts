import { useState, useEffect } from 'react';
import type { BrowserLogEntry } from './types';
import type { LucideIcon } from 'lucide-react';
import { Loader2, Cog, Hand, ExternalLink } from 'lucide-react';
import type { Translations } from '@/i18n/en';

type AutoCredExtraKey = keyof Translations['vault']['auto_cred_extra'];

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
  labelKey: AutoCredExtraKey;
  sublabelKey: AutoCredExtraKey;
  guidedSublabelKey: AutoCredExtraKey;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  borderColor: string;
  pulse: boolean;
}

export const STATE_CONFIG: Record<SessionState, StateConfig> = {
  connecting: {
    labelKey: 'state_connecting_label',
    sublabelKey: 'state_connecting_sublabel',
    guidedSublabelKey: 'state_connecting_guided',
    icon: Loader2,
    color: 'text-foreground',
    bgColor: 'bg-secondary/20',
    borderColor: 'border-primary/10',
    pulse: false,
  },
  working: {
    labelKey: 'state_working_label',
    sublabelKey: 'state_working_sublabel',
    guidedSublabelKey: 'state_working_guided',
    icon: Cog,
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/5',
    borderColor: 'border-cyan-500/20',
    pulse: false,
  },
  action_required: {
    labelKey: 'state_action_required_label',
    sublabelKey: 'state_action_required_sublabel',
    guidedSublabelKey: 'state_action_required_guided',
    icon: Hand,
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/8',
    borderColor: 'border-amber-500/30',
    pulse: true,
  },
  opening_url: {
    labelKey: 'state_opening_url_label',
    sublabelKey: 'state_opening_url_sublabel',
    guidedSublabelKey: 'state_opening_url_guided',
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

// -- Phase derivation for log timeline ------------------------------------

export function deriveEntryPhase(group: GroupedEntry): SessionState {
  if (group.kind === 'action_block') return 'working';
  const t = group.entry.type;
  if (t === 'warning' || t === 'input_request') return 'action_required';
  if (t === 'url') return 'opening_url';
  return 'working';
}

export const PHASE_LABEL_KEYS: Record<SessionState, AutoCredExtraKey> = {
  connecting: 'phase_connecting',
  working: 'phase_working',
  action_required: 'phase_action_required',
  opening_url: 'phase_opening_url',
};

// -- Rich message URL splitting ------------------------------------------

/**
 * Canonical URL-extraction regex (markdown-aware).
 *
 * Matches `http://` or `https://` followed by any run of non-whitespace
 * characters, *stopping* before common markdown trailing punctuation
 * (`)`, `>`, `]`, `"`, `'`, `` ` ``, `*`, `_`) so embedded URLs in markdown
 * prose don't pick up surrounding bracket/emphasis chars.
 *
 * Three earlier inline copies used the looser `/https?:\/\/[^\s)]+/` —
 * which is fine for plain text but produced false positives in markdown
 * setup-instructions. Wave 5 unified all four call sites onto this regex.
 *
 * Has the `g` flag for use with `matchAll` / `exec` loops. Reset
 * `lastIndex` (or use `URL_PATTERN_SOURCE` / `extractFirstUrl`) for
 * one-shot first-match extraction.
 */
export const URL_REGEX = /https?:\/\/[^\s)>\]"'`*_]+/g;

/**
 * Extract the first URL from `text`, or `null` if none/empty.
 *
 * Uses {@link URL_REGEX}'s pattern in non-global mode so it stops at the
 * first match without sharing `lastIndex` state.
 */
export function extractFirstUrl(text?: string | null): string | null {
  if (!text) return null;
  const match = text.match(/https?:\/\/[^\s)>\]"'`*_]+/);
  return match ? match[0] : null;
}

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
