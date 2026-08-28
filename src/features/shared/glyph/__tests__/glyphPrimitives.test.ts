import { describe, it, expect } from 'vitest';
import { humanizeCron } from '../cron';
import { stackOffset } from '../helpers';
import { parseChannels, channelIcon, channelTint } from '../channels';
import { TRIGGER_ICONS, triggerIcon, triggerDetail } from '../triggers';
import { TRIGGER_KINDS } from '@/lib/utils/platform/triggerConstants';

describe('humanizeCron', () => {
  it('humanizes the single-valued shapes it claims to know', () => {
    expect(humanizeCron('*/5 * * * *')).toBe('Every 5 min');
    expect(humanizeCron('0 */6 * * *')).toBe('Every 6h');
    expect(humanizeCron('0 9 * * *')).toBe('Daily · 09:00');
    expect(humanizeCron('0 8 * * 1-5')).toBe('Weekdays · 08:00');
    expect(humanizeCron('30 7 * * 0,6')).toBe('Weekends · 07:30');
    expect(humanizeCron('0 9 * * 1')).toBe('Mon · 09:00');
    expect(humanizeCron('0 9 * * 1-3')).toBe('Mon/Tue/Wed · 09:00');
  });

  it('falls through to the raw cron rather than misrepresenting a schedule', () => {
    // Not a 5-field cron.
    expect(humanizeCron('0 9 * *')).toBe('0 9 * *');
    // Monthly — day-of-month is pinned, no phrasing for it.
    expect(humanizeCron('0 0 1 * *')).toBe('0 0 1 * *');
  });

  it('never collapses a multi-run time field to one clock time', () => {
    // Regression: `parseInt("0,30")` is 0, so a minute list used to render as
    // "Daily · 09:00" and silently drop the 09:30 run.
    expect(humanizeCron('0,30 9 * * *')).toBe('0,30 9 * * *');
    expect(humanizeCron('0-15 9 * * *')).toBe('0-15 9 * * *');
    expect(humanizeCron('*/10 9 * * *')).toBe('*/10 9 * * *');
    // The hour side of the same rule (already guarded — pinned here so it stays).
    expect(humanizeCron('0 9,17 * * *')).toBe('0 9,17 * * *');
    expect(humanizeCron('0 9-17 * * *')).toBe('0 9-17 * * *');
  });
});

describe('stackOffset', () => {
  it('alternates above/below from the centre anchor', () => {
    expect([0, 1, 2, 3, 4, 5].map(stackOffset)).toEqual([0, -1, 1, -2, 2, -3]);
  });
});

describe('parseChannels', () => {
  it('splits a concatenated summary into typed descriptors', () => {
    expect(parseChannels('slack: team · email: daily digest')).toEqual([
      { type: 'slack', description: 'team' },
      { type: 'email', description: 'daily digest' },
    ]);
  });

  it('keeps colons inside the description', () => {
    expect(parseChannels('webhook: POST https://x/y: hook')).toEqual([
      { type: 'webhook', description: 'POST https://x/y: hook' },
    ]);
  });

  it('is empty for absent input and drops typeless segments', () => {
    expect(parseChannels(undefined)).toEqual([]);
    expect(parseChannels('')).toEqual([]);
    expect(parseChannels(' · slack: team')).toEqual([{ type: 'slack', description: 'team' }]);
  });

  it('resolves icon and tint case-insensitively with a fallback', () => {
    expect(channelIcon('SLACK')).toBe(channelIcon('slack'));
    expect(channelTint('Telegram')).toBe('#229ED9');
    expect(channelTint('carrier-pigeon')).toBe('#60a5fa');
  });
});

describe('trigger vocabulary', () => {
  // Derived from TRIGGER_KINDS (the generated `TriggerKind` binding the SQL
  // CHECK and the Rust door validator also derive from), NOT from the icon
  // map's own keys — a test that reads the implementation's list can never
  // notice the list is short.
  it('gives every storable trigger kind a dedicated icon', () => {
    const generic = triggerIcon('__not_a_trigger_kind__');
    for (const kind of TRIGGER_KINDS) {
      expect(TRIGGER_ICONS[kind], `no icon for trigger kind "${kind}"`).toBeDefined();
      expect(triggerIcon(kind), `"${kind}" falls back to the generic icon`).not.toBe(generic);
    }
  });

  it('keeps the legacy `event` alias pointing at the `event_listener` icon', () => {
    expect(triggerIcon('event')).toBe(triggerIcon('event_listener'));
  });
});

describe('triggerDetail', () => {
  it('humanizes a schedule trigger cron', () => {
    expect(triggerDetail({ trigger_type: 'schedule', config: { cron: '0 9 * * *' } }))
      .toBe('Daily · 09:00');
  });

  it('falls back to the description when there is no cron', () => {
    expect(triggerDetail({ trigger_type: 'webhook', description: 'on push' })).toBe('on push');
    expect(triggerDetail({ trigger_type: 'schedule', config: {}, description: 'ad hoc' }))
      .toBe('ad hoc');
    expect(triggerDetail({ trigger_type: 'manual' })).toBe('');
  });
});
