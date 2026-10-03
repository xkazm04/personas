/**
 * The System Check model (kit batch home-3). What is worth asserting here is the thing the owner
 * called out: status is drawn by MEANING, not by hue, and the six sections no longer carry a
 * hardcoded palette step. So the tests pin the closed status -> Tone x Glyph mapping, the
 * worst-wins roll-up, and the one predicate the triage surface filters on.
 */
import { describe, expect, it } from 'vitest';

import type { HealthCheckItem } from '@/api/system/system';
import type { Translations } from '@/i18n/generated/types';
import type { HealthCheckStatus } from '@/lib/bindings/HealthCheckStatus';

import {
  HEALTH_SECTION_IDS, bySeverity, needsAttention, sectionLabel, statusMark,
  statusSegments, statusWord, tally, worstStatus,
} from '../healthModel';

// The model reads six keys of one section; the proxy's full shape is irrelevant to it, and the
// invariant that makes this cast safe is that every read below is one of the keys declared here.
const t = {
  system_health: {
    status_ok: 'Passing',
    status_warn: 'Warning',
    status_error: 'Failing',
    status_inactive: 'Not configured',
    status_info: 'For information',
    category_local: 'Local Environment',
    category_environment: 'Environment',
    category_agents: 'Agents',
    category_cloud: 'Cloud Deployment',
    category_account: 'Account',
    category_subscriptions: 'Subscription Health',
  },
} as unknown as Translations;

const item = (id: string, status: HealthCheckStatus): HealthCheckItem =>
  ({ id, label: id, status, detail: null, installable: false });

describe('statusMark / statusWord', () => {
  it.each([
    ['ok', 'success', 'solid'],
    ['warn', 'warning', 'solid'],
    ['error', 'error', 'solid'],
    ['inactive', 'info', 'hollow'],
    ['info', 'neutral', 'soft'],
  ] as const)('%s is drawn by meaning: %s/%s', (status, tone, glyph) => {
    const mark = statusMark(t, status);
    expect(mark.tone).toBe(tone);
    expect(mark.glyph).toBe(glyph);
  });

  it('"not configured" reads info-blue, never a role colour (Gate 5)', () => {
    expect(statusMark(t, 'inactive').tone).toBe('info');
  });

  it('carries the word as the mark\'s accessible name, which is why there is no Status column', () => {
    expect(statusMark(t, 'error').label).toBe('Failing');
    expect(statusWord(t, 'inactive')).toBe('Not configured');
  });
});

describe('worstStatus', () => {
  it('an error beats a warning beats a not-configured beats a fact', () => {
    expect(worstStatus([item('a', 'ok'), item('b', 'warn'), item('c', 'error')])).toBe('error');
    expect(worstStatus([item('a', 'ok'), item('b', 'warn'), item('c', 'inactive')])).toBe('warn');
    expect(worstStatus([item('a', 'ok'), item('b', 'inactive'), item('c', 'info')])).toBe('inactive');
    expect(worstStatus([item('a', 'ok'), item('b', 'info')])).toBe('info');
  });

  it('all passing is passing; an empty set has nothing to say', () => {
    expect(worstStatus([item('a', 'ok'), item('b', 'ok')])).toBe('ok');
    expect(worstStatus([])).toBe('info');
  });
});

describe('needsAttention', () => {
  it('is the operator\'s work: broken, ageing, or not set up yet', () => {
    expect(['error', 'warn', 'inactive'].map((s) => needsAttention(item('x', s as HealthCheckStatus)))).toEqual([true, true, true]);
  });

  it('is not a passing check and not a bare fact', () => {
    expect(needsAttention(item('x', 'ok'))).toBe(false);
    expect(needsAttention(item('x', 'info'))).toBe(false);
  });
});

describe('tally', () => {
  it('counts the four figures the triage strip draws, plus the work', () => {
    const counts = tally([item('a', 'ok'), item('b', 'ok'), item('c', 'warn'), item('d', 'error'), item('e', 'inactive'), item('f', 'info')]);
    expect(counts).toMatchObject({ ok: 2, warn: 1, error: 1, inactive: 1, info: 1, total: 6, attention: 3 });
  });
});

describe('statusSegments', () => {
  it('draws one unit per check, worst first, and skips the statuses that are absent', () => {
    const segs = statusSegments([item('a', 'ok'), item('b', 'ok'), item('c', 'error')]);
    expect(segs).toEqual([
      { n: 1, tone: 'error', glyph: 'solid' },
      { n: 2, tone: 'success', glyph: 'solid' },
    ]);
  });

  it('nothing to draw draws nothing (UnitStrip renders its own empty placeholder)', () => {
    expect(statusSegments([])).toEqual([]);
  });
});

describe('bySeverity', () => {
  it('sorts worst first, so a capped list still shows the work', () => {
    const sorted = bySeverity([item('ok', 'ok'), item('warn', 'warn'), item('err', 'error'), item('setup', 'inactive')]);
    expect(sorted.map((i) => i.id)).toEqual(['err', 'warn', 'setup', 'ok']);
  });
});

describe('sectionLabel', () => {
  it('names all six sections from the catalog, never from the backend\'s English label', () => {
    expect(HEALTH_SECTION_IDS.map((id) => sectionLabel(t, id))).toEqual([
      'Local Environment', 'Environment', 'Agents', 'Cloud Deployment', 'Account', 'Subscription Health',
    ]);
  });

  it('falls back to the id for a section the catalog does not know', () => {
    expect(sectionLabel(t, 'circuit_breaker')).toBe('circuit_breaker');
  });
});
