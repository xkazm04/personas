import { Clock, Webhook, Play, Zap } from 'lucide-react';

export interface TriggerTypeMeta {
  Icon: typeof Clock;
  color: string;
}

export const TRIGGER_TYPE_META: Record<string, TriggerTypeMeta> = {
  schedule: { Icon: Clock, color: 'text-amber-400' },
  polling: { Icon: Clock, color: 'text-amber-400' },
  webhook: { Icon: Webhook, color: 'text-blue-400' },
  manual: { Icon: Play, color: 'text-emerald-400' },
};

export const DEFAULT_TRIGGER_META: TriggerTypeMeta = { Icon: Zap, color: 'text-purple-400' };

/**
 * Safely parse a trigger config value which may be a JSON string, an object, or null.
 * Returns a parsed object (or empty object on null / parse failure).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTriggerConfig(config: string | object | null | undefined): Record<string, any> {
  if (!config) return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (typeof config === 'object') return config as Record<string, any>;
  try {
    return JSON.parse(config);
  } catch {
    return {};
  }
}
