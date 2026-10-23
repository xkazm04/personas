import { describe, it, expect } from 'vitest';
import { formatTimeRangeLabel, resolveTimeRange } from '@/lib/types/timeRange';

const templates = { oneDay: 'Posledni den', manyDays: (n: number) => `Poslednich ${n} dni` };

describe('time range label', () => {
  it('takes rolling-days copy from the caller, not from English literals', () => {
    expect(formatTimeRangeLabel({ kind: 'rolling-days', days: 1 }, templates, 'cs')).toBe('Posledni den');
    expect(formatTimeRangeLabel({ kind: 'rolling-days', days: 30 }, templates, 'cs')).toBe('Poslednich 30 dni');
  });

  it('renders custom range ends through the requested locale', () => {
    const label = formatTimeRangeLabel(
      { kind: 'custom', startDate: '2026-03-01', endDate: '2026-03-05' },
      templates,
      'cs',
    );
    expect(label).toBe(
      `${new Date('2026-03-01T00:00:00').toLocaleDateString('cs', { month: 'short', day: 'numeric' })} - ${new Date('2026-03-05T00:00:00').toLocaleDateString('cs', { month: 'short', day: 'numeric' })}`,
    );
    expect(label).not.toMatch(/Mar/);
  });

  it('resolveTimeRange returns dates only', () => {
    const r = resolveTimeRange({ kind: 'custom', startDate: '2026-03-01', endDate: '2026-03-05' });
    expect(r).toEqual({ startDate: '2026-03-01', endDate: '2026-03-05' });
  });
});
