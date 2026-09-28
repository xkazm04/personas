import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignCapabilitiesWidget } from '../DesignCapabilitiesWidget';

describe('DesignCapabilitiesWidget', () => {
  it('renders the static capability list (8 rows)', () => {
    render(<DesignCapabilitiesWidget config={{}} />);
    const items = document.querySelectorAll('[data-kit="ListRow"]');
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

  it('every row carries the example prompt prefix', () => {
    render(<DesignCapabilitiesWidget config={{}} />);
    // 8 rows × 1 example each → ≥8 occurrences of "Try:" or its localized equivalent
    const tryMatches = screen.getAllByText((_, node) =>
      Boolean(node?.textContent?.includes('Try:')),
    );
    // Every capability row carries its "Try:" example line.
    expect(tryMatches.length).toBeGreaterThanOrEqual(8);
  });
});
