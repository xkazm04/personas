import { describe, expect, it } from 'vitest';
import {
  formatFileSize,
  formatDurationShort,
  formatTimecode,
  formatDurationHuman,
  formatMMSS,
  formatRulerTime,
} from '../format';

describe('formatFileSize', () => {
  it('formats bytes in B for sub-KB', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
  });

  it('formats kilobytes with one decimal', () => {
    expect(formatFileSize(1024)).toBe('1.0 KB');
    expect(formatFileSize(2048 + 512)).toBe('2.5 KB');
  });

  it('formats megabytes with one decimal', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1.0 MB');
    expect(formatFileSize(1024 * 1024 * 3 + 512 * 1024)).toBe('3.5 MB');
  });

  it('formats gigabytes with two decimals', () => {
    expect(formatFileSize(1024 ** 3)).toBe('1.00 GB');
    expect(formatFileSize(1024 ** 3 * 2.5)).toBe('2.50 GB');
  });
});

describe('formatDurationShort (MM:SS.s)', () => {
  it('pads minutes and seconds', () => {
    expect(formatDurationShort(0)).toBe('00:00.0');
    expect(formatDurationShort(9)).toBe('00:09.0');
    expect(formatDurationShort(75.4)).toBe('01:15.4');
  });

  it('clamps negative values to zero', () => {
    expect(formatDurationShort(-5)).toBe('00:00.0');
  });
});

describe('formatTimecode (MM:SS.cc)', () => {
  it('renders hundredths', () => {
    expect(formatTimecode(0)).toBe('00:00.00');
    expect(formatTimecode(75.42)).toBe('01:15.42');
  });

  it('clamps negative values to zero', () => {
    expect(formatTimecode(-1)).toBe('00:00.00');
  });

  it('does not round seconds upward past 59', () => {
    // 59.99 should render as 00:59.99, not 01:00.00 (Math.floor on cs).
    expect(formatTimecode(59.999)).toBe('00:59.99');
  });
});

describe('formatDurationHuman', () => {
  it('returns Ns for sub-minute durations', () => {
    expect(formatDurationHuman(0)).toBe('0s');
    expect(formatDurationHuman(45)).toBe('45s');
  });

  it('returns M:SS for minute-plus durations', () => {
    expect(formatDurationHuman(60)).toBe('1:00');
    expect(formatDurationHuman(75)).toBe('1:15');
    expect(formatDurationHuman(125)).toBe('2:05');
  });
});

describe('formatMMSS', () => {
  it('always pads both fields and shows the minute', () => {
    expect(formatMMSS(0)).toBe('00:00');
    expect(formatMMSS(7)).toBe('00:07');
    expect(formatMMSS(75)).toBe('01:15');
  });
});

describe('formatRulerTime', () => {
  it('uses M:SS for whole-second values', () => {
    expect(formatRulerTime(0)).toBe('0:00');
    expect(formatRulerTime(65)).toBe('1:05');
  });

  it('uses M:SS.s for sub-second values', () => {
    expect(formatRulerTime(65.4)).toBe('1:05.4');
  });
});
