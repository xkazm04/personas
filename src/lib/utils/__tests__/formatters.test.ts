import { describe, it, expect } from 'vitest';
import {
  formatPercent,
  formatCount,
  formatNumeric,
} from '../formatters';

describe('formatPercent', () => {
  it('treats the input as a percentage magnitude by default', () => {
    expect(formatPercent(42.5)).toBe('42.5%');
    expect(formatPercent(100)).toBe('100.0%');
  });

  it('converts a 0–1 ratio when fromRatio is set', () => {
    expect(formatPercent(0.425, { fromRatio: true })).toBe('42.5%');
    expect(formatPercent(1, { fromRatio: true })).toBe('100.0%');
  });

  it('honors a fixed precision so columns stay aligned', () => {
    expect(formatPercent(7, { precision: 0 })).toBe('7%');
    expect(formatPercent(7, { precision: 2 })).toBe('7.00%');
  });

  it('renders an em dash for null / NaN', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent(NaN)).toBe('—');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1234)).toBe('1,234');
    expect(formatCount(1234567)).toBe('1,234,567');
  });

  it('renders an em dash for null / NaN', () => {
    expect(formatCount(null)).toBe('—');
    expect(formatCount(NaN)).toBe('—');
  });
});

describe('formatNumeric', () => {
  it('dispatches ms / s durations', () => {
    expect(formatNumeric(4200, 'ms')).toBe('4s');
    expect(formatNumeric(90, 's')).toBe('1m 30s');
  });

  it('dispatches usd cost', () => {
    expect(formatNumeric(1.5, 'usd')).toBe('$1.50');
  });

  it('dispatches percent and ratio', () => {
    expect(formatNumeric(42.5, 'percent')).toBe('42.5%');
    expect(formatNumeric(0.425, 'ratio')).toBe('42.5%');
  });

  it('dispatches count / plain with grouping', () => {
    expect(formatNumeric(1234, 'count')).toBe('1,234');
    expect(formatNumeric(1234, 'plain')).toBe('1,234');
    expect(formatNumeric(1234)).toBe('1,234');
  });

  it('renders an em dash for null / NaN regardless of unit', () => {
    expect(formatNumeric(null, 'usd')).toBe('—');
    expect(formatNumeric(NaN, 'percent')).toBe('—');
  });
});
