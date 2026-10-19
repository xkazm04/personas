import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/devTools/devTools', () => ({}));

import { resolveQueueBody } from '../useTaskQueue';

describe('resolveQueueBody', () => {
  it('a failed first page is an error, never an empty queue', () => {
    expect(resolveQueueBody({ loading: false, error: 'database is locked', rowCount: 0 })).toBe('error');
  });

  it('an answered empty page is empty', () => {
    expect(resolveQueueBody({ loading: false, error: null, rowCount: 0 })).toBe('empty');
  });

  it('loaded rows stay on screen through a failed or pending refresh', () => {
    expect(resolveQueueBody({ loading: false, error: 'timeout', rowCount: 3 })).toBe('list');
    expect(resolveQueueBody({ loading: true, error: null, rowCount: 3 })).toBe('list');
  });

  it('a first load in flight is loading', () => {
    expect(resolveQueueBody({ loading: true, error: null, rowCount: 0 })).toBe('loading');
  });
});
