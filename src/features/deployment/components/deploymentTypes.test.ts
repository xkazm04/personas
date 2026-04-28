import { describe, it, expect } from 'vitest';
import { mapCloudStatus, mapGitlabStatus } from './deploymentTypes';

describe('mapCloudStatus', () => {
  it('passes through known statuses verbatim', () => {
    expect(mapCloudStatus('active')).toBe('active');
    expect(mapCloudStatus('paused')).toBe('paused');
    expect(mapCloudStatus('failed')).toBe('failed');
  });

  it('returns unknown for unrecognized strings (forward-compat)', () => {
    expect(mapCloudStatus('deploying')).toBe('unknown');
    expect(mapCloudStatus('degraded')).toBe('unknown');
    expect(mapCloudStatus('')).toBe('unknown');
    expect(mapCloudStatus('ACTIVE')).toBe('unknown'); // case-sensitive
  });

  it('returns unknown for null and undefined', () => {
    expect(mapCloudStatus(null)).toBe('unknown');
    expect(mapCloudStatus(undefined)).toBe('unknown');
  });
});

describe('mapGitlabStatus', () => {
  it('treats every present agent row as active', () => {
    expect(mapGitlabStatus({ id: 1, name: 'foo' })).toBe('active');
    expect(mapGitlabStatus({})).toBe('active');
    expect(mapGitlabStatus(null)).toBe('active');
  });
});
