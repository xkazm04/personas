import { describe, expect, it } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { decisionTitle, firstSentence, humanizeToken, TITLE_MAX } from './decisionTitle';

function item(over: Partial<TeamChannelItem> = {}): TeamChannelItem {
  return {
    id: 'i1', kind: 'step', at: '2026-09-20T10:00:00Z', personaId: 'p1', label: 'step_done',
    body: null, assignmentId: null, stepId: null, extra: null, replyTo: null,
    deliberationId: null, importance: null, consumers: null, ...over,
  };
}

describe('decisionTitle', () => {
  it('step: lifecycle verb + the step title, no detail', () => {
    const d = decisionTitle(item({ label: 'step_failed', body: 'Test and merge the PR' }));
    expect(d).toEqual({ verb: 'step_failed', title: 'Test and merge the PR', detail: null });
  });

  it('step: an unknown lifecycle kind has no verb', () => {
    expect(decisionTitle(item({ label: 'athena_review_resolution', body: 'x' })).verb).toBeNull();
  });

  it('event: the payload line is the title; a bodiless event falls back to its type', () => {
    expect(decisionTitle(item({ kind: 'event', label: 'signal.raised', extra: null })).title).toBe('Signal raised');
    const d = decisionTitle(item({ kind: 'event', label: 'pr.opened', extra: '{"summary":"Opened PR for retry prompt"}' }));
    expect(d.title).toBe('Opened PR for retry prompt');
    expect(d.detail).toBeNull();
  });

  it('memory: splits the read model join into title and content', () => {
    const d = decisionTitle(item({
      kind: 'memory', label: 'decision',
      body: 'Human accepted: Tokens have two homes — ## Summary\nlib/design holds the sources.',
    }));
    expect(d.title).toBe('Human accepted: Tokens have two homes');
    expect(d.detail).toBe('## Summary\nlib/design holds the sources.');
  });

  it('memory: a bare title (title == content) has no detail', () => {
    expect(decisionTitle(item({ kind: 'memory', label: 'fact', body: 'Ship on Fridays' })).detail).toBeNull();
  });

  it('deliberation: first sentence as title, the whole turn as detail', () => {
    const body = 'Architecture verdict on v0.4.3 is APPROVE. The dual-guard fix in `display.ts:29-34` is the only change.';
    const d = decisionTitle(item({ kind: 'persona', label: 'Architect', deliberationId: 'd1', body }));
    expect(d.title).toBe('Architecture verdict on v0.4.3 is APPROVE.');
    expect(d.detail).toBe(body);
  });

  it('deliberation: a one-sentence resolution is its own title', () => {
    const body = 'Deliberation resolved — proposed: “Execute v0.4.3 Release” (awaiting your approval).';
    const d = decisionTitle(item({ kind: 'system', label: 'system', deliberationId: 'd1', body }));
    expect(d.title).toBe(body);
    expect(d.detail).toBeNull();
  });
});

describe('firstSentence', () => {
  it('drops the emoji ornament and the colon that introduces a block', () => {
    expect(firstSentence('🛠 Ran “Scheduled Architecture Review”:\n\nI will execute…')).toBe('Ran “Scheduled Architecture Review”');
  });

  it('strips markdown and clips long lines on a word boundary', () => {
    const t = firstSentence(`**${'word '.repeat(60)}**`);
    expect(t.length).toBeLessThanOrEqual(TITLE_MAX + 1);
    expect(t.endsWith('…')).toBe(true);
    expect(t).not.toContain('*');
  });
});

describe('humanizeToken', () => {
  it('turns machine tokens into words', () => {
    expect(humanizeToken('dev_tools.context_scan_completed')).toBe('Dev tools context scan completed');
  });
});
