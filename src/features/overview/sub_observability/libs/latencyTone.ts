import { latencyToHealth, type HealthStatus } from '@/lib/design/statusTokens';
import type { Tone } from '@/features/shared/components/kit';

const HEALTH_TONE: Record<HealthStatus, Tone> = { healthy: 'success', info: 'info', warning: 'warning', critical: 'error', neutral: 'neutral' };

/** A latency's kit tone: its latencyToHealth band (under 50 ms, 200 ms, 1 s) as a status tone. */
export const latencyTone = (ms: number): Tone => HEALTH_TONE[latencyToHealth(ms)];
