import { describe, it, expect } from 'vitest';
import { makeIssueId } from './useHealthCheck';

describe('makeIssueId', () => {
  it('is deterministic for identical inputs', () => {
    const a = makeIssueId('persona-1', 'error', 'Missing credential for slack');
    const b = makeIssueId('persona-1', 'error', 'Missing credential for slack');
    expect(a).toBe(b);
  });

  it('produces a stable hex prefix shape', () => {
    const id = makeIssueId('persona-1', 'warning', 'Cron schedule is undefined');
    expect(id).toMatch(/^hc_[0-9a-f]{16}$/);
  });

  it('isolates IDs across personas with the same issue text', () => {
    const a = makeIssueId('persona-A', 'error', 'auth failed');
    const b = makeIssueId('persona-B', 'error', 'auth failed');
    expect(a).not.toBe(b);
  });

  it('treats severity changes as a new identity', () => {
    const a = makeIssueId('persona-1', 'warning', 'Cron schedule is undefined');
    const b = makeIssueId('persona-1', 'error', 'Cron schedule is undefined');
    expect(a).not.toBe(b);
  });

  it('treats description changes as a new identity', () => {
    const a = makeIssueId('persona-1', 'info', 'Could not fetch config warnings');
    const b = makeIssueId('persona-1', 'info', 'Could not fetch config warning');
    expect(a).not.toBe(b);
  });

  it('survives unicode in the description without throwing', () => {
    const a = makeIssueId('persona-1', 'info', 'スケジュール未定義 ⏰');
    const b = makeIssueId('persona-1', 'info', 'スケジュール未定義 ⏰');
    expect(a).toBe(b);
    expect(a).toMatch(/^hc_[0-9a-f]{16}$/);
  });
});
