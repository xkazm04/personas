import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Numeric } from '../Numeric';

describe('Numeric', () => {
  it('always applies tabular lining figures', () => {
    render(<Numeric value={1234} />);
    const el = screen.getByText('1,234');
    expect(el.getAttribute('style')).toContain('tabular-nums lining-nums');
  });

  it('formats value via the shared unit formatter', () => {
    render(<Numeric value={42.5} unit="percent" />);
    expect(screen.getByText('42.5%')).toBeTruthy();
  });

  it('formats ms durations and usd cost', () => {
    const { rerender } = render(<Numeric value={4200} unit="ms" />);
    expect(screen.getByText('4s')).toBeTruthy();
    rerender(<Numeric value={1.5} unit="usd" />);
    expect(screen.getByText('$1.50')).toBeTruthy();
  });

  it('renders pre-formatted children verbatim and ignores value/unit', () => {
    render(
      <Numeric value={999} unit="usd">
        custom
      </Numeric>,
    );
    expect(screen.getByText('custom')).toBeTruthy();
    expect(screen.queryByText('$999.00')).toBeNull();
  });

  it('adds text-right for right-aligned columns', () => {
    render(<Numeric value={5} align="right" />);
    expect(screen.getByText('5').className).toContain('text-right');
  });

  it('renders as the requested element', () => {
    render(<Numeric value={7} as="td" />);
    const el = screen.getByText('7');
    expect(el.tagName).toBe('TD');
  });
});
