import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

// The 1–N answer shortcut sends immediately and cannot be undone. Its guard used
// to cover modifiers and text fields only — so a digit typed while the version
// menu or the build-settings panel was open reached onAnswer, because a menu
// button is not a text field. These pin the shortcut to the moment it belongs to.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { studio: new Proxy({} as Record<string, string>, { get: (_, k) => String(k) }) },
    tx: (s: string) => s,
  }),
}));

const StudioDecision = (await import('../StudioDecision')).default;

const OPTIONS = ['Warm', 'Cool', 'Mono'];

/** Mount a trigger shaped like Studio's three popovers (tab picker, settings,
 *  version history) in the given state. */
function mountPopoverTrigger(expanded: boolean): HTMLElement {
  const btn = document.createElement('button');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.setAttribute('aria-expanded', String(expanded));
  document.body.appendChild(btn);
  return btn;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('the decision shortcut', () => {
  it('answers on a bare digit when nothing is in the way', () => {
    const onAnswer = vi.fn();
    render(<StudioDecision question="Which palette?" options={OPTIONS} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: '2' });

    expect(onAnswer).toHaveBeenCalledWith('Cool');
  });

  it('declines while a Studio popover is open', () => {
    const onAnswer = vi.fn();
    mountPopoverTrigger(true);
    render(<StudioDecision question="Which palette?" options={OPTIONS} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: '2' });

    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('arms again once that popover closes', () => {
    const onAnswer = vi.fn();
    const trigger = mountPopoverTrigger(true);
    render(<StudioDecision question="Which palette?" options={OPTIONS} onAnswer={onAnswer} />);

    fireEvent.keyDown(window, { key: '1' });
    expect(onAnswer).not.toHaveBeenCalled();

    trigger.setAttribute('aria-expanded', 'false');
    fireEvent.keyDown(window, { key: '1' });

    expect(onAnswer).toHaveBeenCalledWith('Warm');
  });

  it('still declines inside a text field and under a modifier', () => {
    const onAnswer = vi.fn();
    render(<StudioDecision question="Which palette?" options={OPTIONS} onAnswer={onAnswer} />);

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    fireEvent.keyDown(window, { key: '3' });
    expect(onAnswer).not.toHaveBeenCalled();

    input.blur();
    fireEvent.keyDown(window, { key: '3', ctrlKey: true });
    expect(onAnswer).not.toHaveBeenCalled();
  });
});
