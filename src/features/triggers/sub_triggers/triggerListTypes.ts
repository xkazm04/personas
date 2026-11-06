export type TriggerHealth = 'healthy' | 'degraded' | 'failing' | 'unknown';

export const HEALTH_STYLES: Record<TriggerHealth, string> = {
  healthy: 'bg-status-success animate-[health-pulse_2s_ease-in-out_infinite]',
  degraded: 'bg-status-warning',
  failing: 'bg-status-error animate-[health-pulse_1.5s_ease-in-out_infinite]',
  unknown: 'bg-muted-foreground/20',
};

export const HEALTH_TITLES: Record<TriggerHealth, string> = {
  healthy: 'Healthy -- last 3 runs succeeded',
  degraded: 'Degraded -- 1 recent failure',
  failing: 'Failing -- 2+ consecutive failures',
  unknown: 'No execution history',
};

// Trigger-type color to SVG stroke color mapping
export const TRIGGER_RING_COLORS: Record<string, string> = {
  'text-status-warning': '#fbbf24',
  'text-role-external': '#2dd4bf',
  'text-status-info': '#60a5fa',
  'text-status-success': '#34d399',
  'text-role-agent': '#c084fc',
};

// Radial Countdown Ring constants
export const RING_SIZE = 36;
export const RING_STROKE = 3;
export const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
