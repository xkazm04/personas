import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DesignCapabilitiesWidget } from '../DesignCapabilitiesWidget';

describe('DesignCapabilitiesWidget', () => {
  it('renders the static capability list (8 rows)', () => {
    render(<DesignCapabilitiesWidget config={{}} />);
    const items = screen.getAllByRole('listitem');
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
    const paragraphs = container.querySelectorAll('p');
    // each list row has one description + example p, so 16 paragraphs total for 8 rows
    // an intro p would push that to 17. Confirm strictly: no paragraph not inside li.
    const introOnlyParagraphs = Array.from(paragraphs).filter(
      (p) => p.parentElement?.tagName !== 'LI',
    );
    expect(introOnlyParagraphs.length).toBe(0);
  });

  it('every row carries the example prompt prefix', () => {
    render(<DesignCapabilitiesWidget config={{}} />);
    // 8 rows × 1 example each → ≥8 occurrences of "Try:" or its localized equivalent
    const tryMatches = screen.getAllByText((_, node) =>
      Boolean(node?.textContent?.includes('Try:')),
    );
    // The role=listitem nodes contain "Try:" via the example line.
    expect(tryMatches.length).toBeGreaterThanOrEqual(8);
  });
});
