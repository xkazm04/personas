import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'templates'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { TemplateSearchFilterRow } from '../TemplateSearchFilterRow';

const connectors = [
  { name: 'slack', count: 4 },
  { name: 'gmail', count: 2 },
];

function renderRow(overrides: Partial<Parameters<typeof TemplateSearchFilterRow>[0]> = {}) {
  const onConnectorFilterChange = vi.fn();
  render(
    <TemplateSearchFilterRow
      sortBy="recent"
      onSortByChange={() => {}}
      sortDir="desc"
      onSortDirChange={() => {}}
      total={6}
      loadedCount={6}
      selectedCategory={null}
      connectorFilter={[]}
      onCategoryFilterChange={() => {}}
      onConnectorFilterChange={onConnectorFilterChange}
      availableConnectors={connectors}
      {...overrides}
    />,
  );
  return { onConnectorFilterChange };
}

describe('connector facet on the gallery filter row', () => {
  it('mounts the connector dropdown when connectors are available', () => {
    renderRow();
    expect(screen.getByRole('button', { name: /connectors_label/ })).toBeTruthy();
  });

  it('adds a connector facet from the dropdown', () => {
    const { onConnectorFilterChange } = renderRow();
    fireEvent.click(screen.getByRole('button', { name: /connectors_label/ }));
    fireEvent.click(screen.getByText('Slack'));
    expect(onConnectorFilterChange).toHaveBeenCalledWith(['slack']);
  });

  it('removes an already-selected connector facet', () => {
    const { onConnectorFilterChange } = renderRow({ connectorFilter: ['slack'] });
    fireEvent.click(screen.getByRole('button', { name: /connectors_label/ }));
    // The active chip also reads 'Slack'; the dropdown option is the later one.
    const labels = screen.getAllByText('Slack');
    fireEvent.click(labels[labels.length - 1]!);
    expect(onConnectorFilterChange).toHaveBeenCalledWith([]);
  });

  it('stays hidden when the catalog has no connectors', () => {
    renderRow({ availableConnectors: [] });
    expect(screen.queryByRole('button', { name: /connectors_label/ })).toBeNull();
  });
});
