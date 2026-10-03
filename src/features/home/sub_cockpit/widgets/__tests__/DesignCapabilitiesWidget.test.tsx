import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignCapabilitiesWidget } from '../DesignCapabilitiesWidget';

describe('DesignCapabilitiesWidget', () => {
  it('renders the static capability list (8 rows)', () => {
    render(<DesignCapabilitiesWidget config={{}} />);
    const items = document.querySelectorAll('[data-testid="companion-design-capabilities-table"] .row-hover-lift');
    expect(items.length).toBe(8);
  });

  it('renders the optional intro line when provided', () => {
    render(
      <DesignCapabilitiesWidget
        config={{
          intro: "Here's what I can help you design today — pick whichever angle fits.",
        }}
      />,
    );
    expect(
      screen.getByText(/Here's what I can help you design today/),
    ).toBeInTheDocument();
  });

  it('omits intro paragraph when intro is empty', () => {
    const { container } = render(
      <DesignCapabilitiesWidget config={{ intro: '' }} />,
    );
    // The intro is the tile's lead paragraph; the rows carry no paragraph of their own.
    expect(container.querySelector('[data-testid="design-capabilities-intro"]')).toBeNull();
    expect(container.querySelectorAll('p').length).toBe(0);
  });

  it('names the example column once and gives every row its own example', () => {
    render(<DesignCapabilitiesWidget config={{}} />);
    // The "Try:" prefix used to be repeated into all 8 cells; it is the COLUMN HEAD now, so the
    // cells carry the example alone. The head says it once, the rows say it eight times over.
    expect(screen.getByText('Try:')).toBeInTheDocument();
    const cells = document.querySelectorAll(
      '[data-testid="companion-design-capabilities-table"] .row-hover-lift > div:nth-child(2)',
    );
    expect(cells.length).toBe(8);
    for (const cell of cells) expect((cell.textContent ?? '').length).toBeGreaterThan(0);
  });
});
