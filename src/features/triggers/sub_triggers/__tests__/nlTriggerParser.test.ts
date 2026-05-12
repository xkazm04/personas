import { describe, it, expect } from 'vitest';
import { parseNaturalLanguageTrigger } from '../nlTriggerParser';

describe('nlTriggerParser', () => {
  describe('schedule rule', () => {
    it('"hourly" → cron 0 * * * *', () => {
      // The schedule rule's "every <unit>" pattern requires a digit
      // ("every 5 minutes"), so bare "every hour" actually misses. Pin the
      // word "hourly" which the rule matches via /\b(hourly|...)\b/.
      const r = parseNaturalLanguageTrigger('run hourly');
      expect(r?.triggerType).toBe('schedule');
      expect(r?.formOverrides.scheduleMode).toBe('cron');
      expect(r?.formOverrides.cronExpression).toBe('0 * * * *');
    });

    it('"daily" → cron 0 9 * * *', () => {
      const r = parseNaturalLanguageTrigger('run daily');
      expect(r?.formOverrides.cronExpression).toBe('0 9 * * *');
    });

    it('"at 9am" → cron 0 9 * * *', () => {
      const r = parseNaturalLanguageTrigger('run at 9am');
      expect(r?.formOverrides.cronExpression).toBe('0 9 * * *');
    });

    it('"at 9pm" → cron 0 21 * * * (12-hour PM conversion)', () => {
      const r = parseNaturalLanguageTrigger('run at 9pm');
      expect(r?.formOverrides.cronExpression).toBe('0 21 * * *');
    });

    it('"at 12pm" → cron 0 12 * * * (noon stays at 12)', () => {
      const r = parseNaturalLanguageTrigger('schedule run at 12pm');
      expect(r?.formOverrides.cronExpression).toBe('0 12 * * *');
    });

    it('"at 12am" → cron 0 0 * * * (midnight maps to 0)', () => {
      const r = parseNaturalLanguageTrigger('schedule run at 12am');
      expect(r?.formOverrides.cronExpression).toBe('0 0 * * *');
    });

    it('"at 14:30" → cron 30 14 * * * (24-hour with minutes)', () => {
      const r = parseNaturalLanguageTrigger('schedule at 14:30');
      expect(r?.formOverrides.cronExpression).toBe('30 14 * * *');
    });

    it('"at 9am Monday" → cron 0 9 * * 1 (day-of-week)', () => {
      const r = parseNaturalLanguageTrigger('every Monday at 9am');
      expect(r?.formOverrides.cronExpression).toBe('0 9 * * 1');
    });

    it('"every weekday" → cron with dow 1-5', () => {
      const r = parseNaturalLanguageTrigger('run every weekday at 9am');
      expect(r?.formOverrides.cronExpression).toBe('0 9 * * 1-5');
    });

    it('"every weekend" → cron with dow 0,6', () => {
      const r = parseNaturalLanguageTrigger('run every weekend at 10am');
      expect(r?.formOverrides.cronExpression).toBe('0 10 * * 0,6');
    });

    it('"every 5 minutes" → interval 300', () => {
      const r = parseNaturalLanguageTrigger('run every 5 minutes');
      expect(r?.formOverrides.scheduleMode).toBe('interval');
      expect(r?.formOverrides.interval).toBe('300');
    });

    it('"every 2 hours" → interval 7200', () => {
      const r = parseNaturalLanguageTrigger('run every 2 hours');
      expect(r?.formOverrides.interval).toBe('7200');
    });

    it('"every 1 day" → interval 86400', () => {
      const r = parseNaturalLanguageTrigger('run every 1 day');
      expect(r?.formOverrides.interval).toBe('86400');
    });

    it('"every 5 seconds" clamps to 60s with a warning', () => {
      const r = parseNaturalLanguageTrigger('run every 5 seconds');
      expect(r?.formOverrides.interval).toBe('60');
      expect(r?.warnings).toEqual([
        expect.objectContaining({
          code: 'interval_clamped',
        }),
      ]);
      // The clamp message should mention the original "5 seconds" so the user
      // knows what was rewritten.
      expect(r?.warnings[0]?.message).toContain('5 second');
      expect(r?.warnings[0]?.message).toContain('60s');
    });

    it('"every 30 seconds" clamps to 60s with a single warning (deduped)', () => {
      // The schedule rule calls parseInterval in extract AND label; the parser
      // dedupes warnings by (code|message) so the UI sees one warning, not two.
      const r = parseNaturalLanguageTrigger('run every 30 seconds');
      expect(r?.formOverrides.interval).toBe('60');
      expect(r?.warnings).toHaveLength(1);
    });

    it('"every 60 seconds" passes through without a warning', () => {
      const r = parseNaturalLanguageTrigger('run every 60 seconds');
      expect(r?.formOverrides.interval).toBe('60');
      expect(r?.warnings).toEqual([]);
    });
  });

  describe('weekday parsing', () => {
    it.each([
      ['monday', '1'],
      ['tuesday', '2'],
      ['wednesday', '3'],
      ['thursday', '4'],
      ['friday', '5'],
      ['saturday', '6'],
      ['sunday', '0'],
    ])('"%s" maps to dow %s', (day, dow) => {
      const r = parseNaturalLanguageTrigger(`every ${day} at 8am`);
      expect(r?.formOverrides.cronExpression).toBe(`0 8 * * ${dow}`);
    });
  });

  describe('non-schedule rules', () => {
    it('webhook keyword → webhook trigger', () => {
      const r = parseNaturalLanguageTrigger('trigger via webhook');
      expect(r?.triggerType).toBe('webhook');
    });

    it('"save .py file" → file_watcher with *.py glob', () => {
      // Parser regex requires singular "file" (no \b-friendly plural). Tests
      // pin the actual behavior; switching to plural would silently un-match.
      const r = parseNaturalLanguageTrigger('save .py file in /tmp');
      expect(r?.triggerType).toBe('file_watcher');
      expect(r?.formOverrides.globFilter).toBe('*.py');
      expect(r?.formOverrides.watchPaths).toEqual(['/tmp']);
    });

    it('"clipboard URL" → clipboard with URL pattern', () => {
      const r = parseNaturalLanguageTrigger('when I copy a URL to clipboard');
      expect(r?.triggerType).toBe('clipboard');
      expect(r?.formOverrides.clipboardPattern).toBe('https?://\\S+');
    });
  });

  describe('edge cases', () => {
    it('empty input returns null', () => {
      expect(parseNaturalLanguageTrigger('')).toBeNull();
    });

    it('input shorter than 3 chars returns null', () => {
      expect(parseNaturalLanguageTrigger('ab')).toBeNull();
    });

    it('completely unrelated input returns null', () => {
      expect(parseNaturalLanguageTrigger('the quick brown fox jumps')).toBeNull();
    });

    it('first-match-wins ordering: file_watcher beats schedule', () => {
      // "watch a file in /tmp every hour" matches BOTH schedule (every hour)
      // and file_watcher (watch ... file). Rules are ordered by specificity —
      // file_watcher comes first in RULES, so it wins.
      const r = parseNaturalLanguageTrigger('watch a file in /tmp every hour');
      expect(r?.triggerType).toBe('file_watcher');
    });
  });
});
