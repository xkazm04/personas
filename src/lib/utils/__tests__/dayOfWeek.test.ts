import { describe, it, expect } from 'vitest';
import { DAY_NAME_TO_NUM, findDayOfWeekInText } from '../dayOfWeek';

describe('day-of-week vocabulary', () => {
  it('maps every short and long name to its POSIX digit', () => {
    expect(DAY_NAME_TO_NUM.sun).toBe(0);
    expect(DAY_NAME_TO_NUM.sunday).toBe(0);
    expect(DAY_NAME_TO_NUM.sat).toBe(6);
    expect(DAY_NAME_TO_NUM.saturday).toBe(6);
  });
});

describe('findDayOfWeekInText', () => {
  it('recognises the range shorthands first', () => {
    expect(findDayOfWeekInText('every weekday at 9')).toBe('1-5');
    expect(findDayOfWeekInText('on the weekend')).toBe('0,6');
  });

  it('resolves a single day from short or long form', () => {
    expect(findDayOfWeekInText('run on Monday')).toBe('1');
    expect(findDayOfWeekInText('run on mon')).toBe('1');
    expect(findDayOfWeekInText('every Sunday')).toBe('0');
    expect(findDayOfWeekInText('every sat')).toBe('6');
    expect(findDayOfWeekInText('plural: mondays')).toBe('1');
  });

  it('returns null when no day is mentioned', () => {
    expect(findDayOfWeekInText('every hour')).toBeNull();
    expect(findDayOfWeekInText('')).toBeNull();
  });

  // Regression guard. The names were sorted longest-first and the first match
  // ANYWHERE won, so "run Tuesday, skip Wednesday" resolved to Wednesday purely
  // because the word is longer — while the docstring claimed length only broke
  // ties "at the same position". The first day mentioned must win.
  it('returns the FIRST day mentioned, not the longest name in the string', () => {
    expect(findDayOfWeekInText('run Tuesday, skip Wednesday')).toBe('2');
    expect(findDayOfWeekInText('schedule for mon, not wednesday')).toBe('1');
    expect(findDayOfWeekInText('wednesday then tuesday')).toBe('3');
    expect(findDayOfWeekInText('fri before saturday')).toBe('5');
  });
});
