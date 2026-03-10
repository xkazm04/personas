export type TriggerHealth = 'healthy' | 'degraded' | 'failing' | 'unknown';

export const HEALTH_STYLES: Record<TriggerHealth, string> = {
  healthy: 'bg-emerald-400 animate-[health-pulse_2s_ease-in-out_infinite]',
  degraded: 'bg-amber-400',
  failing: 'bg-red-400 animate-[health-pulse_1.5s_ease-in-out_infinite]',
  unknown: 'bg-muted-foreground/20',
};

export const HEALTH_TITLES: Record<TriggerHealth, string> = {
  healthy: 'Healthy — last 3 runs succeeded',
  degraded: 'Degraded — 1 recent failure',
  failing: 'Failing — 2+ consecutive failures',
  unknown: 'No execution history',
};

// Trigger-type color to SVG stroke color mapping
export const TRIGGER_RING_COLORS: Record<string, string> = {
  'text-amber-400': '#fbbf24',
  'text-teal-400': '#2dd4bf',
  'text-blue-400': '#60a5fa',
  'text-emerald-400': '#34d399',
  'text-purple-400': '#c084fc',
  'text-cyan-400': '#22d3ee',
};

// Radial Countdown Ring constants
export const RING_SIZE = 36;
export const RING_STROKE = 3;
export const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
export const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
