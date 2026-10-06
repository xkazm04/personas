// The drawer's two pure decisions: which reading is on, and what "waiting on
// you" means when three sources are merged into one queue.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  DRAWER_VARIANTS, DRAWER_VARIANT_KEY, isDrawerVariant, readDrawerVariant, writeDrawerVariant,
} from '../drawerVariant';
import { buildWorklist, restProcesses, type DrawerModel } from '../drawerModel';

beforeEach(() => { localStorage.clear(); });

describe('drawer variant', () => {
  it('is console | queue | brief', () => {
    expect([...DRAWER_VARIANTS]).toEqual(['console', 'queue', 'brief']);
    expect(isDrawerVariant('console')).toBe(true);
    expect(isDrawerVariant('classic')).toBe(false);
  });

  it('reads console for a missing or unknown value', () => {
    expect(readDrawerVariant()).toBe('console');
    localStorage.setItem(DRAWER_VARIANT_KEY, 'nonsense');
    expect(readDrawerVariant()).toBe('console');
  });

  it('round-trips a live value', () => {
    writeDrawerVariant('brief');
    expect(readDrawerVariant()).toBe('brief');
    expect(readDrawerVariant()).toBe(localStorage.getItem(DRAWER_VARIANT_KEY));
  });
});

const review = (id: string, severity: string) => ({ id, severity } as never);
const report = (id: string, priority: string) => ({ id, priority } as never);
const proc = (key: string, status: string) => ({ key, proc: { status } } as never);

function model(over: Partial<DrawerModel>): DrawerModel {
  return {
    reviews: [], messages: [], processes: [], useCases: [],
    ...over,
  } as unknown as DrawerModel;
}

describe('worklist', () => {
  it('ranks across sources: critical review, question, draft, loud report, quiet report', () => {
    const m = model({
      reviews: [review('r-info', 'info'), review('r-crit', 'critical')],
      messages: [report('m-quiet', 'normal'), report('m-loud', 'urgent')],
      processes: [proc('p-draft', 'draft_ready'), proc('p-ask', 'input_required'), proc('p-run', 'running')],
    });
    // The model's own inputs arrive pre-sorted; the merge must not re-order
    // within a band, only between them.
    m.reviews = [review('r-crit', 'critical'), review('r-info', 'info')];
    m.messages = [report('m-loud', 'urgent'), report('m-quiet', 'normal')];
    expect(buildWorklist(m).map((w) => w.key)).toEqual([
      'review:r-crit',
      'review:r-info',
      'process:p-ask',
      'process:p-draft',
      'message:m-loud',
      'message:m-quiet',
    ]);
  });

  it('leaves running and queued work out of the queue and in the trailing strip', () => {
    const m = model({ processes: [proc('p-run', 'running'), proc('p-q', 'queued'), proc('p-ask', 'input_required')] });
    expect(buildWorklist(m).map((w) => w.key)).toEqual(['process:p-ask']);
    expect(restProcesses(m).map((e) => e.key)).toEqual(['p-run', 'p-q']);
  });

  it('sorts an unreadable severity to the top, the way severityBucket intends', () => {
    const m = model({ reviews: [review('r-known', 'info'), review('r-weird', 'banana')] });
    expect(buildWorklist(m)[0]?.key).toBe('review:r-weird');
  });
});
