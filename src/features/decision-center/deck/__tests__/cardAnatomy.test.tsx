/**
 * The card's head and folds (mandate-lanes WP1):
 *  - every kind, in every one of the four shapes, gets the eyebrow, the ask as
 *    title, a context line and BOTH halves of the outcome pair, from the catalog;
 *  - council and companion approval say plainly they never admit on their own;
 *  - the fold plan folds only what is long, and its preview is a readable line.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DecisionKind } from '../../model/decisionModel';
import { item } from '../../__tests__/rosterFixtures';
import { CardHeader } from '../CardHeader';
import { EVIDENCE_FOLD_LINES, foldPlan, previewOf } from '../foldPlan';

const KINDS: DecisionKind[] = ['review', 'question', 'approval', 'policy', 'evolution', 'goal', 'idea', 'incident', 'council', 'report', 'message'];

function head(kind: DecisionKind) {
  const it = item({
    id: `${kind}:1`, kind, title: `The ask for ${kind}`,
    source: { label: 'Dev Clone', sublabel: 'Personas' },
    verdictLabels: { accept: 'Approve', reject: 'Send back', skip: 'Later' },
  });
  return render(<CardHeader item={it} titleId={`t-${kind}`} />);
}

describe('CardHeader anatomy', () => {
  it.each(KINDS)('%s: eyebrow, the ask, a context line and the outcome pair', (kind) => {
    const { unmount } = head(kind);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(`The ask for ${kind}`);
    expect(screen.getByTestId('deck-context').textContent).toMatch(/from Dev Clone in Personas$/);
    const yes = screen.getByTestId('deck-yes-band').textContent ?? '';
    const no = screen.getByTestId('deck-no-band').textContent ?? '';
    expect(yes).toMatch(/^If you /);
    expect(no).toMatch(/^If you /);
    // Two different consequences, never an empty or undefined half.
    expect(no).not.toBe(yes);
    expect(`${yes}${no}`).not.toMatch(/undefined/);
    unmount();
  });

  it('council and companion approval say they never admit on their own', () => {
    const council = head('council');
    expect(screen.getByTestId('deck-no-band').textContent).toContain('A council verdict never admits work on its own.');
    council.unmount();
    head('approval');
    expect(screen.getByTestId('deck-no-band').textContent).toContain('Athena never carries it out on her own.');
  });

  it('the no side uses the verb the dock prints as the negative', () => {
    const report = head('report');
    expect(screen.getByTestId('deck-no-band').textContent).toMatch(/^If you leave it for later/);
    report.unmount();
    const chat = head('message');
    expect(screen.getByTestId('deck-no-band').textContent).toMatch(/^If you mark it done/);
    chat.unmount();
    head('idea');
    expect(screen.getByTestId('deck-no-band').textContent).toMatch(/^If you send back/);
  });
});

describe('foldPlan', () => {
  it('folds only long sections', () => {
    const short = item({ id: 'review:1', kind: 'review', evidence: 'a\nb', reasoning: 'Short.' });
    expect(foldPlan(short)).toEqual({ body: null, reasoning: null, evidence: null });

    const lines = Array.from({ length: EVIDENCE_FOLD_LINES + 1 }, (_, i) => `row ${i}`).join('\n');
    const long = item({ id: 'review:2', kind: 'review', evidence: lines, reasoning: 'x '.repeat(200), body: 'y '.repeat(400) });
    const plan = foldPlan(long);
    expect(plan.evidence).toEqual({ count: EVIDENCE_FOLD_LINES + 1, preview: 'row 0' });
    expect(plan.reasoning?.count).toBe(1);
    // A long case folds only on a question card, whose fields must stay in view.
    expect(plan.body).toBeNull();
    const question = item({ id: 'question:1', kind: 'question', body: 'para one\n\npara two '.repeat(40), input: { fields: [], deferred: false } });
    expect(foldPlan(question).body?.count).toBeGreaterThan(1);
  });

  it('previews the first line with a word in it, markdown marks stripped', () => {
    expect(previewOf('{\n  "run": "r-1"\n}')).toBe('"run": "r-1"');
    expect(previewOf('## Heading\n\nbody')).toBe('Heading');
    expect(previewOf('---\n- **bold** item')).toBe('bold item');
    expect(previewOf('z'.repeat(200)).endsWith('…')).toBe(true);
  });
});
