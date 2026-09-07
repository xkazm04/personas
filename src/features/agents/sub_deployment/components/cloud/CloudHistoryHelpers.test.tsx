import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { classifyExecutionStatus, statusIcon } from './CloudHistoryHelpers';

describe('classifyExecutionStatus: one table, explicit unknown', () => {
  it.each([
    ['completed', 'completed'],
    ['failed', 'failed'],
    // The cloud runner treats `error` as terminal failure (runner.rs); the
    // UI must not paint it as still running.
    ['error', 'failed'],
    ['cancelled', 'cancelled'],
    ['canceled', 'cancelled'],
    ['pending', 'in_flight'],
    ['queued', 'in_flight'],
    ['running', 'in_flight'],
  ])('%s -> %s', (raw, cls) => {
    expect(classifyExecutionStatus(raw)).toBe(cls);
  });

  it('lands an unmapped or missing status in unknown, never in in_flight', () => {
    expect(classifyExecutionStatus('timed_out')).toBe('unknown');
    expect(classifyExecutionStatus('')).toBe('unknown');
    expect(classifyExecutionStatus(null)).toBe('unknown');
    expect(classifyExecutionStatus(undefined)).toBe('unknown');
  });
});

describe('statusIcon renders the class, not the raw string', () => {
  it('shows a terminal failure glyph for error, not the in-flight dot', () => {
    const { container } = render(statusIcon('error'));
    expect(container.querySelector('svg')).toBeTruthy();
    expect(container.querySelector('.animate-ping, [data-status-class="unknown"]')).toBeNull();
  });

  it('renders an unknown status as its own glyph carrying the raw string', () => {
    const { container } = render(statusIcon('timed_out'));
    const glyph = container.querySelector('[data-status-class="unknown"]');
    expect(glyph).toBeTruthy();
    expect(glyph!.getAttribute('aria-label')).toBe('timed_out');
  });

  it('renders in-flight statuses as the liveness dot with no svg', () => {
    const { container } = render(statusIcon('running'));
    expect(container.querySelector('svg')).toBeNull();
    expect(container.querySelector('[data-status-class="unknown"]')).toBeNull();
  });
});
