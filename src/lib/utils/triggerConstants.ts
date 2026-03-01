import { Clock, Webhook, Play, Zap, Link, RefreshCw, Radio } from 'lucide-react';

export interface TriggerTypeMeta {
  Icon: typeof Clock;
  color: string;
}

export const TRIGGER_TYPE_META: Record<string, TriggerTypeMeta> = {
  schedule: { Icon: Clock, color: 'text-amber-400' },
  polling: { Icon: RefreshCw, color: 'text-teal-400' },
  webhook: { Icon: Webhook, color: 'text-blue-400' },
  manual: { Icon: Play, color: 'text-emerald-400' },
  chain: { Icon: Link, color: 'text-purple-400' },
  event_listener: { Icon: Radio, color: 'text-cyan-400' },
};

export const DEFAULT_TRIGGER_META: TriggerTypeMeta = { Icon: Zap, color: 'text-purple-400' };

// ── Typed trigger config discriminated union ────────────────────────────

export interface ScheduleConfig {
  type: 'schedule';
  cron?: string;
  interval_seconds?: number;
  event_type?: string;
}

export interface PollingConfig {
  type: 'polling';
  url?: string;
  headers?: Record<string, string>;
  content_hash?: string;
  interval_seconds?: number;
  event_type?: string;
  /** Legacy field: credential event ID for linked polling */
  event_id?: string;
  /** Legacy field: endpoint URL (alias for url) */
  endpoint?: string;
}

export interface WebhookConfig {
  type: 'webhook';
  webhook_secret?: string;
  event_type?: string;
}

export interface ChainConfig {
  type: 'chain';
  source_persona_id?: string;
  condition?: { type: string; status?: string };
  event_type?: string;
}

export interface ManualConfig {
  type: 'manual';
  event_type?: string;
}

export interface EventListenerConfig {
  type: 'event_listener';
  listen_event_type?: string;
  source_filter?: string;
}

export type TriggerConfig =
  | ScheduleConfig
  | PollingConfig
  | WebhookConfig
  | ChainConfig
  | ManualConfig
  | EventListenerConfig;

/**
 * Parse a trigger's raw config JSON into a typed discriminated union.
 *
 * The discriminant comes from `triggerType` (the `trigger_type` column), not
 * from the JSON itself, mirroring the Rust `PersonaTrigger::parse_config()`.
 */
export function parseTriggerConfig(
  triggerType: string,
  config: string | object | null | undefined,
): TriggerConfig {
  const raw = parseRawConfig(config);

  switch (triggerType) {
    case 'schedule':
      return {
        type: 'schedule',
        cron: raw.cron as string | undefined,
        interval_seconds: raw.interval_seconds as number | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'polling':
      return {
        type: 'polling',
        url: raw.url as string | undefined,
        headers: raw.headers as Record<string, string> | undefined,
        content_hash: raw.content_hash as string | undefined,
        interval_seconds: raw.interval_seconds as number | undefined,
        event_type: raw.event_type as string | undefined,
        event_id: raw.event_id as string | undefined,
        endpoint: raw.endpoint as string | undefined,
      };
    case 'webhook':
      return {
        type: 'webhook',
        webhook_secret: raw.webhook_secret as string | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'chain':
      return {
        type: 'chain',
        source_persona_id: raw.source_persona_id as string | undefined,
        condition: raw.condition as { type: string; status?: string } | undefined,
        event_type: raw.event_type as string | undefined,
      };
    case 'event_listener':
      return {
        type: 'event_listener',
        listen_event_type: raw.listen_event_type as string | undefined,
        source_filter: raw.source_filter as string | undefined,
      };
    case 'manual':
      return {
        type: 'manual',
        event_type: raw.event_type as string | undefined,
      };
    default:
      return { type: 'manual', event_type: raw.event_type as string | undefined };
  }
}

/** Internal: parse raw JSON/object/string into a plain object. */
function parseRawConfig(config: string | object | null | undefined): Record<string, unknown> {
  if (!config) return {};
  if (typeof config === 'object') return config as Record<string, unknown>;
  try {
    return JSON.parse(config);
  } catch {
    return {};
  }
}
