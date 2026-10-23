import { describe, it, expect } from 'vitest';
import { buildCreateExposureInput } from '../exposureInput';

describe('buildCreateExposureInput', () => {
  it('fails closed: new exposures require auth (not advertised to unauthenticated LAN peers)', () => {
    const input = buildCreateExposureInput({
      resourceType: 'persona', resourceId: 'p1', displayName: 'P', accessLevel: 'read', tags: '',
    });
    expect(input.requires_auth).toBe(true);
  });

  it('only an explicit opt-in opens an exposure to unauthenticated peers', () => {
    const base = { resourceType: 'persona', resourceId: 'p1', displayName: 'P', accessLevel: 'read', tags: '' } as const;
    expect(buildCreateExposureInput({ ...base, openToUnauthenticatedPeers: false }).requires_auth).toBe(true);
    expect(buildCreateExposureInput({ ...base, openToUnauthenticatedPeers: undefined }).requires_auth).toBe(true);
    expect(buildCreateExposureInput({ ...base, openToUnauthenticatedPeers: true }).requires_auth).toBe(false);
  });

  it('splits and trims tags', () => {
    const input = buildCreateExposureInput({
      resourceType: 'persona', resourceId: 'p1', displayName: 'P', accessLevel: 'read', tags: 'a, b ,,c',
    });
    expect(input.tags).toEqual(['a', 'b', 'c']);
  });
});
