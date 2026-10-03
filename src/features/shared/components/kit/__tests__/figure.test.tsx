/**
 * Figure (doctrine 6c): the kit's frame for a drawn figure. What is asserted here is the frame's
 * CONTRACT, not any drawing - the geometry it declares, the states in that geometry, the
 * announcement a drawing that is `aria-hidden` cannot make for itself, the ink it derives, and the
 * callout rail that keeps the labels out of the drawing.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { Figure, KitHost } from '../index';

const draw = <svg data-testid="drawing" aria-hidden="true" />;

const mount = (ui: React.ReactElement) => render(<KitHost>{ui}</KitHost>);

describe('Figure', () => {
  it('declares a px height as the plot variable, and an aspect when given one instead', () => {
    const { container, rerender } = mount(<Figure label="f" height={250}>{draw}</Figure>);
    const fig = container.querySelector('.k-figure')!;
    expect(fig.className).toContain('k-figure--h');
    expect(fig.getAttribute('style')).toContain('--fig-h: 250px');

    rerender(<KitHost><Figure label="f" aspect={4}>{draw}</Figure></KitHost>);
    const fig2 = container.querySelector('.k-figure')!;
    expect(fig2.className).toContain('k-figure--aspect');
    expect(fig2.getAttribute('style')).toContain('--fig-aspect: 4');
  });

  it('names the figure and announces the description a hidden drawing cannot', () => {
    mount(<Figure label="This machine" desc="Twelve of fourteen checks pass.">{draw}</Figure>);
    const fig = screen.getByLabelText('This machine');
    const id = fig.getAttribute('aria-describedby')!;
    expect(id).toBeTruthy();
    expect(document.getElementById(id)!.textContent).toBe('Twelve of fourteen checks pass.');
  });

  it('derives its ink from the tone, so a figure stylesheet reads tokens instead of re-mixing', () => {
    const { container } = mount(<Figure label="f" height={100} tone="agent">{draw}</Figure>);
    expect(container.querySelector('.k-figure')!.getAttribute('style')).toContain('--fig-ink: var(--role-agent)');
  });

  it('holds the frame geometry while loading and drops the drawing, never the space', () => {
    const { container } = mount(<Figure label="f" height={180} state="loading">{draw}</Figure>);
    const fig = container.querySelector('.k-figure')!;
    expect(fig.getAttribute('aria-busy')).toBe('true');
    expect(fig.getAttribute('style')).toContain('--fig-h: 180px');
    expect(screen.queryByTestId('drawing')).toBeNull();
    expect(container.querySelector('.k-ghost')).not.toBeNull();
  });

  it('renders the kit empty band instead of the drawing when empty', () => {
    render(<KitHost><Figure label="f" height={180} state="empty" empty={{ title: 'Nothing measured yet' }}>{draw}</Figure></KitHost>);
    expect(screen.getByText('Nothing measured yet')).toBeTruthy();
    expect(screen.queryByTestId('drawing')).toBeNull();
  });

  it('puts the labels in the rail on one track per callout, outside the drawing', () => {
    const { container } = mount(
      <Figure label="f" height={200} callouts={[
        { id: 'a', label: 'Local', figure: '4/4' },
        { id: 'b', label: 'Cloud', figure: '1/2' },
      ]}>{draw}</Figure>,
    );
    const fig = container.querySelector('.k-figure')!;
    expect(fig.getAttribute('style')).toContain('--fig-cols: 2');
    expect(container.querySelectorAll('.k-figure__callout')).toHaveLength(2);
    // Full type size, through a token on the element: the whole reason a label is not in the SVG.
    expect(container.querySelector('.k-figure__name')!.className).toContain('typo-body');
    expect(screen.getByText('4/4')).toBeTruthy();
  });

  it('a callout with onPress is the figure control: pressed state, its own name, and it presses', () => {
    const onPress = vi.fn();
    mount(
      <Figure label="f" height={200} callouts={[
        { id: 'a', label: 'Local', figure: '4/4', name: 'Local, passing, 4 of 4 checks pass', pressed: true, onPress, testId: 'pier-a' },
        { id: 'b', label: 'Cloud', figure: '-', disabled: true, onPress },
      ]}>{draw}</Figure>,
    );
    const a = screen.getByTestId('pier-a');
    expect(a.getAttribute('aria-pressed')).toBe('true');
    expect(a.getAttribute('aria-label')).toBe('Local, passing, 4 of 4 checks pass');
    fireEvent.click(a);
    expect(onPress).toHaveBeenCalledTimes(1);

    const b = screen.getByRole('button', { name: /Cloud/ });
    expect((b as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(b);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('drops the rail in a state that owns the frame, so no control hangs over a ghost', () => {
    const { container } = mount(
      <Figure label="f" height={200} state="loading" callouts={[{ id: 'a', label: 'Local', onPress: () => {} }]}>{draw}</Figure>,
    );
    expect(container.querySelector('.k-figure__rail')).toBeNull();
  });
});
