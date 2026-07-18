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
  it('passes through honest backend-probed status tokens', () => {
    expect(mapGitlabStatus('active')).toBe('active');
    expect(mapGitlabStatus('file-based')).toBe('file-based');
    expect(mapGitlabStatus('failed')).toBe('failed');
    expect(mapGitlabStatus('unknown')).toBe('unknown');
  });

  it('never renders a false green — unrecognized/empty/null collapse to unknown', () => {
    expect(mapGitlabStatus('deploying')).toBe('unknown');
    expect(mapGitlabStatus('')).toBe('unknown');
    expect(mapGitlabStatus(null)).toBe('unknown');
    expect(mapGitlabStatus(undefined)).toBe('unknown');
  });
});
