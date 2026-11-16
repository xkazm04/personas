import {
  CheckCircle2, XCircle, AlertTriangle, Webhook, Cloud, Unplug,
  FileEdit, Rocket, Clock, Link, Zap, ScanSearch, Radar, BadgeCheck,
} from 'lucide-react';

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
  build_complete:   { Icon: CheckCircle2,  text: 'text-status-success', bg: 'bg-status-success/12', border: 'border-status-success/20' },
  test_passed:      { Icon: CheckCircle2,  text: 'text-status-success', bg: 'bg-status-success/12', border: 'border-status-success/20' },
  chain_completed:  { Icon: Link,          text: 'text-status-success', bg: 'bg-status-success/12', border: 'border-status-success/20' },
  deploy:           { Icon: Rocket,        text: 'text-status-success', bg: 'bg-status-success/12', border: 'border-status-success/20' },
  // Error events -- red
  test_failed:      { Icon: XCircle,       text: 'text-status-error',     bg: 'bg-status-error/12',     border: 'border-status-error/20' },
  error:            { Icon: XCircle,       text: 'text-status-error',     bg: 'bg-status-error/12',     border: 'border-status-error/20' },
  // Alert events -- amber
  alert:            { Icon: AlertTriangle, text: 'text-status-warning',   bg: 'bg-status-warning/12',   border: 'border-status-warning/20' },
  // Webhook events -- blue
  webhook_received: { Icon: Webhook,       text: 'text-status-info',    bg: 'bg-status-info/12',    border: 'border-status-info/20' },
  cloud_webhook:    { Icon: Cloud,         text: 'text-status-info',    bg: 'bg-status-info/12',    border: 'border-status-info/20' },
  smee_webhook:     { Icon: Unplug,        text: 'text-role-agent',  bg: 'bg-role-agent/12',  border: 'border-role-agent/20' },
  // Schedule events -- amber/clock
  schedule_fired:   { Icon: Clock,         text: 'text-status-warning',   bg: 'bg-status-warning/12',   border: 'border-status-warning/20' },
  // File events -- cyan
  file_changed:     { Icon: FileEdit,      text: 'text-role-external',    bg: 'bg-role-external/12',    border: 'border-role-external/20' },
  // System ops -- dev-tools context-scan lifecycle (amber starting, emerald done)
  'dev_tools.context_scan_started':   { Icon: ScanSearch, text: 'text-status-warning',   bg: 'bg-status-warning/12',   border: 'border-status-warning/20' },
  'dev_tools.context_scan_completed': { Icon: ScanSearch, text: 'text-status-success', bg: 'bg-status-success/12', border: 'border-status-success/20' },
  // Findings loop — a sensor raised something / a verdict landed on shipped work.
  'signal.raised':                    { Icon: Radar,      text: 'text-role-agent',  bg: 'bg-role-agent/12',  border: 'border-role-agent/20' },
  'signal.verified':                  { Icon: BadgeCheck, text: 'text-status-info',     bg: 'bg-status-info/12',     border: 'border-status-info/20' },
};

export const DEFAULT_EVENT_META: EventTypeMeta = {
  Icon: Zap, text: 'text-role-agent', bg: 'bg-role-agent/12', border: 'border-role-agent/20',
};
