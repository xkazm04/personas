// A healing run that fails must not draw its steps as done: the failure lands on the step the
// run had reached, and the steps after it were never reached ("Completed" stays pending).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AiHealingPhase, AiHealingState } from '@/hooks/execution/useAiHealingStream';
import { AiHealingStreamOverlay } from '../AiHealingStreamOverlay';
import enJson from '@/i18n/locales/en.json';

const state = (phase: AiHealingPhase): AiHealingState => ({
  phase, lines: [], lastLine: '', diagnosis: null, fixesApplied: [], shouldRetry: false, executionId: null,
});

const steps = (c: HTMLElement) =>
  [...c.querySelectorAll('[data-step-state]')].map((el) => el.getAttribute('data-step-state'));

describe('AiHealingStreamOverlay step states', () => {
  it('a run that completes draws every step done', () => {
    const { container } = render(<AiHealingStreamOverlay healing={state('completed')} onDismiss={() => {}} />);
    expect(steps(container)).toEqual(['done', 'done', 'done']);
  });

  it('a run that fails while applying marks that step failed and leaves Completed pending', () => {
    const { container, rerender } = render(<AiHealingStreamOverlay healing={state('diagnosing')} onDismiss={() => {}} />);
    rerender(<AiHealingStreamOverlay healing={state('applying')} onDismiss={() => {}} />);
    rerender(<AiHealingStreamOverlay healing={state('failed')} onDismiss={() => {}} />);
    expect(steps(container)).toEqual(['done', 'failed', 'pending']);
  });

  it('a run that fails while diagnosing fails the first step only', () => {
    const { container, rerender } = render(<AiHealingStreamOverlay healing={state('diagnosing')} onDismiss={() => {}} />);
    rerender(<AiHealingStreamOverlay healing={state('failed')} onDismiss={() => {}} />);
    expect(steps(container)).toEqual(['failed', 'pending', 'pending']);
  });
});

// The status word, the step labels and the collapse control come from the catalog, not literals.
describe('AiHealingStreamOverlay copy', () => {
  const o = enJson.overview.ai_healing_overlay;

  it('draws the status and step labels from the catalog', () => {
    const { container, rerender } = render(<AiHealingStreamOverlay healing={state('applying')} onDismiss={() => {}} />);
    expect(container.textContent).toContain(o.status_in_progress);
    expect(container.textContent).toContain(o.step_applying);
    rerender(<AiHealingStreamOverlay healing={state('failed')} onDismiss={() => {}} />);
    expect(container.textContent).toContain(o.status_failed);
  });

  it('names the collapse control through the catalog and keeps no hand-rolled spinner', () => {
    const { container } = render(<AiHealingStreamOverlay healing={state('applying')} onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: o.collapse })).toBeTruthy();
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(container.querySelector('[title]')).toBeNull();
  });
});
