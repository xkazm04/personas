// Types, constants, and motion presets shared across the ucPicker
// files. The use-case picker is the production UI for the adoption
// wizard's capability-and-trigger step; every file in this folder is
// prefixed with `uc` so the module is easy to locate from anywhere in
// the codebase.

import type { LucideIcon } from 'lucide-react';
import type { ConnectorMeta } from '@/features/shared/components/display/ConnectorMeta';

// ─── Destinations ──────────────────────────────────────────────────────

export type DestId = 'app_notif' | 'in_app' | string;
export const APP_NOTIF: DestId = 'app_notif';
export const IN_APP: DestId = 'in_app';

export interface Destination {
  id: DestId;
  label: string;
  shortLabel: string;
  kind: 'default' | 'channel';
  icon?: LucideIcon | React.FC<{ className?: string }>;
  meta?: ConnectorMeta;
}

// ─── Trigger display model ─────────────────────────────────────────────
// Computed view-layer representation of a TriggerSelection; the time
// card branches on `mode` to pick its variant (clock / event / manual).

export interface TriggerDisplay {
  primary: string;          // huge label: MON / DAILY / HOURLY / MANUAL / ON EVENT
  secondary: string;        // time string or event tail: 09:00 / :00 / EVENT_NAME
  detail: string;           // small caption: every week / every day / run on demand
  mode: 'time' | 'event' | 'manual' | 'both';
  hour: number;             // 0–23 — drives the clock hour hand angle
  weekday: number | null;   // 0=Sun…6=Sat, null if not weekly
}

// ─── Event stamp classifier ───────────────────────────────────────────

export type StampKind = 'up' | 'down' | 'hold' | 'scan' | 'gem' | 'spike' | 'bolt';

// ─── Content overlays (fallbacks for fixture ids) ──────────────────────
// Production use cases from real templates won't match these ids — the
// picker falls back to the UseCaseOption's own fields when the id is not
// in one of these maps.

export const UC_SUBTITLE: Record<string, string> = {
  uc_signals:            'Composes buy / sell / hold signals from RSI, MACD, and earnings data',
  uc_congressional_scan: 'Matches congressional stock disclosures against watched sectors',
  uc_gems:               'Surfaces under-covered names passing technical + catalyst thresholds',
};

export const UC_DESCRIPTION: Record<string, string> = {
  uc_signals:
    "Scores each ticker's technical stack (RSI, MACD), earnings, and sector rotation into a composite and emits stocks.signals.{buy,sell,hold}.",
  uc_congressional_scan:
    "Pulls weekly congressional disclosures and cross-checks them against watched sectors.",
  uc_gems:
    "Discovers under-covered names passing a configurable tech-score and catalyst filter.",
};

export const UC_CODE: Record<string, string> = {
  uc_signals:            'SGN',
  uc_congressional_scan: 'CDC',
  uc_gems:               'GEM',
};

// ─── Event sources ────────────────────────────────────────────────────

export const COMMON_PERSONA_EVENTS = [
  'system.persona.started',
  'system.persona.completed',
  'system.execution.succeeded',
  'system.execution.failed',
  'scheduler.tick.hourly',
  'scheduler.tick.daily',
];

export const MESSAGING_SERVICE_TYPES = [
  'personas_messages',
  'slack',
  'discord',
  'telegram',
  'microsoft_teams',
];

export const MESSAGING_CATEGORY = 'messaging';

// ─── Motion presets ───────────────────────────────────────────────────

export const FADE = { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

export const HEIGHT_FADE = {
  initial: { height: 0, opacity: 0 },
  animate: { height: 'auto', opacity: 1 },
  exit:    { height: 0, opacity: 0 },
  transition: { duration: 0.22, ease: FADE.ease },
};
