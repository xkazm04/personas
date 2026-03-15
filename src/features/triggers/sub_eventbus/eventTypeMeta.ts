import {
  CheckCircle2, XCircle, AlertTriangle, Webhook, Cloud, Unplug,
  FileEdit, Rocket, Clock, Link, Zap,
} from 'lucide-react';

export const COMMON_EVENT_TYPES = [
  'file_changed',
  'build_complete',
  'deploy',
  'test_passed',
  'test_failed',
  'error',
  'alert',
  'schedule_fired',
  'webhook_received',
  'cloud_webhook',
];

export interface EventTypeMeta {
  Icon: typeof CheckCircle2;
  /** Tailwind text color class */
  text: string;
  /** Tailwind bg tint class */
  bg: string;
  /** Tailwind border class */
  border: string;
}

export const EVENT_TYPE_META: Record<string, EventTypeMeta> = {
  // Success events -- green
  build_complete:   { Icon: CheckCircle2,  text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  test_passed:      { Icon: CheckCircle2,  text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  chain_completed:  { Icon: Link,          text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  deploy:           { Icon: Rocket,        text: 'text-emerald-400', bg: 'bg-emerald-500/12', border: 'border-emerald-500/20' },
  // Error events -- red
  test_failed:      { Icon: XCircle,       text: 'text-red-400',     bg: 'bg-red-500/12',     border: 'border-red-500/20' },
  error:            { Icon: XCircle,       text: 'text-red-400',     bg: 'bg-red-500/12',     border: 'border-red-500/20' },
  // Alert events -- amber
  alert:            { Icon: AlertTriangle, text: 'text-amber-400',   bg: 'bg-amber-500/12',   border: 'border-amber-500/20' },
  // Webhook events -- blue
  webhook_received: { Icon: Webhook,       text: 'text-blue-400',    bg: 'bg-blue-500/12',    border: 'border-blue-500/20' },
  cloud_webhook:    { Icon: Cloud,         text: 'text-blue-400',    bg: 'bg-blue-500/12',    border: 'border-blue-500/20' },
  smee_webhook:     { Icon: Unplug,        text: 'text-purple-400',  bg: 'bg-purple-500/12',  border: 'border-purple-500/20' },
  // Schedule events -- amber/clock
  schedule_fired:   { Icon: Clock,         text: 'text-amber-400',   bg: 'bg-amber-500/12',   border: 'border-amber-500/20' },
  // File events -- cyan
  file_changed:     { Icon: FileEdit,      text: 'text-cyan-400',    bg: 'bg-cyan-500/12',    border: 'border-cyan-500/20' },
};

export const DEFAULT_EVENT_META: EventTypeMeta = {
  Icon: Zap, text: 'text-violet-400', bg: 'bg-violet-500/12', border: 'border-violet-500/20',
};
