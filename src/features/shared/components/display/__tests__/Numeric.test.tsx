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

  it('compact unit shows abbreviated figure with full-precision title', () => {
    render(<Numeric value={12_345} unit="compact" />);
    const el = screen.getByText('12.3K');
    expect(el.getAttribute('title')).toBe('12,345');
  });

  it('compact unit omits the title when nothing was abbreviated', () => {
    render(<Numeric value={1234} unit="compact" />);
    const el = screen.getByText('1,234');
    expect(el.getAttribute('title')).toBe('1,234');
  });

  it('an explicit title overrides the compact auto-title', () => {
    render(<Numeric value={12_345} unit="compact" title="exact: 12345" />);
    expect(screen.getByText('12.3K').getAttribute('title')).toBe('exact: 12345');
  });
});
