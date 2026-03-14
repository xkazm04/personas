import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GhostedCellRenderer } from '../GhostedCellRenderer';

// Stub watermark icon for tests
function StubIcon({ className }: { className?: string }) {
  return <svg data-testid="watermark-icon" className={className} />;
}

describe('GhostedCellRenderer', () => {
  it('renders the label text', () => {
    render(<GhostedCellRenderer label="Tasks" watermark={StubIcon} watermarkColor="text-violet-400" />);
    expect(screen.getByText('Tasks')).toBeTruthy();
  });

  it('renders label with reduced opacity class', () => {
    render(<GhostedCellRenderer label="Tasks" watermark={StubIcon} watermarkColor="text-violet-400" />);
    const label = screen.getByText('Tasks');
    expect(label.className).toContain('text-foreground/20');
  });

  it('renders label with uppercase tracking style', () => {
    render(<GhostedCellRenderer label="Tasks" watermark={StubIcon} watermarkColor="text-violet-400" />);
    const label = screen.getByText('Tasks');
    expect(label.className).toContain('uppercase');
    expect(label.className).toContain('tracking-');
  });

  it('renders an empty content area with min-height', () => {
    const { container } = render(<GhostedCellRenderer label="Tasks" watermark={StubIcon} watermarkColor="text-violet-400" />);
    const contentArea = container.querySelector('.min-h-\\[52px\\]');
    expect(contentArea).toBeTruthy();
    // Content area should be empty (no children)
    expect(contentArea!.children.length).toBe(0);
  });

  it('renders with rounded-xl border classes', () => {
    const { container } = render(<GhostedCellRenderer label="Tasks" watermark={StubIcon} watermarkColor="text-violet-400" />);
    const outer = container.firstElementChild!;
    expect(outer.className).toContain('rounded-xl');
    expect(outer.className).toContain('border');
  });

  it('uses explicit transition property list (not transition-all)', () => {
    const { container } = render(<GhostedCellRenderer label="Tasks" watermark={StubIcon} watermarkColor="text-violet-400" />);
    const outer = container.firstElementChild!;
    expect(outer.className).toContain('transition-[');
    expect(outer.className).not.toContain('transition-all');
  });

  it('renders watermark icon at very low opacity', () => {
    const { container } = render(<GhostedCellRenderer label="Apps & Services" watermark={StubIcon} watermarkColor="text-cyan-400" />);
    const iconWrapper = container.querySelector('[class*="opacity-\\[0.08\\]"]');
    expect(iconWrapper).toBeTruthy();
  });

  it('renders watermark with the provided watermarkColor', () => {
    render(<GhostedCellRenderer label="Apps & Services" watermark={StubIcon} watermarkColor="text-cyan-400" />);
    const icon = screen.getByTestId('watermark-icon');
    // SVG elements in jsdom use SVGAnimatedString for className; use getAttribute
    expect(icon.getAttribute('class')).toContain('text-cyan-400');
  });

  it('applies border-card-border/20 for subtle outline', () => {
    const { container } = render(<GhostedCellRenderer label="Tasks" watermark={StubIcon} watermarkColor="text-violet-400" />);
    const outer = container.firstElementChild!;
    expect(outer.className).toContain('border-card-border/20');
  });
});
