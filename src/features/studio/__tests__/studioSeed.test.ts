import { describe, expect, it } from 'vitest';
import { answerNote, buildSeed, isStopOnly } from '../studioSeed';
import { setupSteps } from '../guide/guideModel';
import type { SiteSketch } from '@/lib/bindings/SiteSketch';

const SKETCH: SiteSketch = {
  summary: 'A bakery that takes pickup orders.',
  pages: [
    { title: 'Home', route: '/', regions: [{ title: 'Top bar', purpose: 'brand' }, { title: "Today's bake", purpose: 'fresh' }] },
    { title: 'Order', route: '/order', regions: [{ title: 'Basket', purpose: '' }] },
  ],
  goals: [{ title: 'Daily menu', note: '' }, { title: 'Order ahead', note: '' }],
  questions: [
    { question: 'What is the bakery called?', options: [], why: 'brand' },
    { question: 'Pickup only?', options: ['Yes', 'Delivery too'], why: '' },
  ],
};

describe('the seed turn', () => {
  it('without a sketch is the plain plan-and-build seed, told not to wait for the server', () => {
    const s = buildSeed({ vision: 'A bakery site', sketch: null, answers: {} });
    expect(s).toContain('A bakery site');
    expect(s).toContain('emit your BUILD_PLAN');
    expect(s).toContain('do not wait for it');
    expect(s).not.toContain('first sketch');
  });

  it('carries the sketch, the answers so far, and the questions still open', () => {
    const s = buildSeed({ vision: 'A bakery site', sketch: SKETCH, answers: { 1: 'Yes' } });
    expect(s).toContain('Page "Home" (/): Top bar, Today\'s bake');
    expect(s).toContain('Draft goals: Daily menu → Order ahead');
    expect(s).toContain('Pickup only? → Yes');
    expect(s).toMatch(/Do NOT ask them again[\s\S]*What is the bakery called\?/);
    expect(s).not.toMatch(/\n\n\n/);
  });

  it('turns a late answer into a note', () => {
    expect(answerNote('Pickup only?', 'Yes')).toBe('Answer to your early question "Pickup only?": Yes');
  });
});

describe('the setup timeline', () => {
  it('runs the sketch and the scaffold at the same time', () => {
    const steps = setupSteps({ sketchState: 'loading', created: false, phase: null, planning: false, planned: false });
    expect(steps.map((s) => s.state)).toEqual(['running', 'running', 'pending', 'pending']);
  });

  it('overlaps the preview boot with the first planning step', () => {
    const steps = setupSteps({ sketchState: 'ready', created: true, phase: 'starting', planning: true, planned: false });
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'running', 'running']);
  });

  it('reports a failed sketch and a failed boot honestly', () => {
    const steps = setupSteps({ sketchState: 'failed', created: true, phase: 'error', planning: false, planned: false });
    expect(steps[0]!.state).toBe('failed');
    expect(steps[2]!.state).toBe('failed');
  });
});

describe('a mid-turn stop word', () => {
  it('is recognised alone, never inside a real instruction', () => {
    for (const t of ['stop', 'Stop!', '  wait ', 'hold on', 'never mind.', 'cancel']) expect(isStopOnly(t)).toBe(true);
    for (const t of ['stop using blue', 'actually, use blue', 'wait for the menu first', 'go']) expect(isStopOnly(t)).toBe(false);
  });
});
