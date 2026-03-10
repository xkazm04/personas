import type { PlaybackSpeed, TimeRange } from '@/hooks/realtime/useTimelineReplay';

export const SPEEDS: PlaybackSpeed[] = [2, 4, 8, 16, 32, 64];

export const RANGE_OPTIONS: { value: TimeRange; label: string }[] = [
  { value: '1d', label: '24h' },
  { value: '7d', label: '7 days' },
];

export const DENSITY_BINS = 60;
export const MIN_OPACITY = 0.1;
export const MAX_OPACITY = 0.4;

export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

export function formatDate(ms: number): string {
  const d = new Date(ms);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${month}/${day} ${formatTimestamp(ms)}`;
}
