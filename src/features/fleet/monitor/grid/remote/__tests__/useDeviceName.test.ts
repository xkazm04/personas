import { describe, expect, it } from 'vitest';
import { resolveDeviceName } from '../useDeviceName';

describe('resolveDeviceName', () => {
  const owned = [{ peerId: 'peer-a', displayName: 'Studio Desktop' }];
  const targets = [{ peerId: 'peer-b', displayName: 'Travel Laptop' }];

  it('prefers the paired-devices list, then the dispatch targets', () => {
    expect(resolveDeviceName('peer-a', owned, targets)).toBe('Studio Desktop');
    expect(resolveDeviceName('peer-b', owned, targets)).toBe('Travel Laptop');
  });

  it('falls back to a short peer id, never an empty chip', () => {
    expect(resolveDeviceName('7c1e9a04deadbeef', owned, targets)).toBe('7c1e9a04');
    expect(resolveDeviceName('peer-a', [{ peerId: 'peer-a', displayName: '  ' }], [])).toBe('peer-a');
  });
});
