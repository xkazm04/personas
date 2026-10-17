/**
 * A store that did not open is "store unreadable", not "map only" with zero facets (lot B, direction 5): the row's
 * chip says so, and the checklist reads "not read" where an unopened store left zeros behind.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { storeUnreadable } from '../readiness';
import { ProductRow } from '../picker/ProductRow';
import { product } from './lensFixtures';

describe('storeUnreadable', () => {
  it('is true only when the store reported an error', () => {
    expect(storeUnreadable(product())).toBe(false);
    expect(storeUnreadable(product({ error: 'file is not a database' }))).toBe(true);
  });
});

describe('a product whose store did not open', () => {
  it('says store unreadable and shows the error text, with no zero counts', () => {
    render(<ul><ProductRow p={product({ projectId: 'p-broken', error: 'file is not a database', features: 0, lenses: 0, measuredFacets: 0, lastRunAt: undefined })} /></ul>);
    const row = screen.getByTestId('blueprint-product-p-broken');
    expect(row.getAttribute('data-level')).toBe('unreadable');
    expect(row.textContent).toContain('Store unreadable');
    expect(row.textContent).toContain('file is not a database');
    expect(row.textContent).not.toMatch(/map only/i);
    const values = [...row.querySelectorAll('.pj-check .v')].map((v) => v.textContent);
    expect(values.filter((v) => v === 'not read')).toHaveLength(4);
    expect(values).not.toContain('0');
  });

  it('keeps the honest zero for a store that opened and holds nothing', () => {
    render(<ul><ProductRow p={product({ projectId: 'p-bare', measuredFacets: 0, features: 0 })} /></ul>);
    const row = screen.getByTestId('blueprint-product-p-bare');
    expect(row.getAttribute('data-level')).toBe('map-only');
    expect([...row.querySelectorAll('.pj-check .v')].map((v) => v.textContent)).toContain('0');
  });
});
