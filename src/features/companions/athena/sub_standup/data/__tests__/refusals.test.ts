import { describe, expect, it } from 'vitest';

import type { StandupEvent } from '@/lib/bindings/StandupEvent';
import { refusalsFrom } from '../useStandupLive';

const ev = (id: string, kind: StandupEvent['kind'], detail?: Record<string, unknown>): StandupEvent => ({
  id, standupId: 's', at: 1, kind, projectId: 'p', summary: `summary ${id}`, detail,
});

describe('refusalsFrom (WP1 stop events)', () => {
  it('reads the headless-master refusal by item, newest first, and ignores other stops', () => {
    const out = refusalsFrom([
      ev('e3', 'stop', { itemId: 'i1', reason: 'headless_master', note: 'held until 09:00' }),
      ev('e2', 'stop', { itemId: 'i1', reason: 'headless_master', note: 'older' }),
      ev('e1', 'stop', { itemId: 'i2', reason: 'operator' }),
      ev('e0', 'dispatch', { itemId: 'i3', reason: 'headless_master' }),
      ev('e4', 'stop', { itemId: 'i4', reason: 'headless_master' }),
    ]);
    expect(out).toEqual({ i1: 'held until 09:00', i4: 'summary e4' });
  });
});
