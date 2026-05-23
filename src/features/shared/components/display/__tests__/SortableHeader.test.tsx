import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Minimal i18n mock: `tx` performs `{token}` interpolation so we can assert the
// composed, descriptive aria-label rather than a raw template.
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      shared: {
        sort_by: 'Sort by {label}',
        sort_active_asc: 'Sorted by {label}, ascending. Activate to sort descending.',
        sort_active_desc: 'Sorted by {label}, descending. Activate to sort ascending.',
      },
    },
    tx: (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)),
  }),
}));

import { SortableHeader } from '../SortableHeader';

function renderInTable(ui: React.ReactElement) {
  return render(<table><thead><tr>{ui}</tr></thead></table>);
}

describe('SortableHeader', () => {
  it('emits aria-sort="none" and "Sort by" label when inactive', () => {
    renderInTable(
      <SortableHeader label="Name" active={false} dir="asc" onSort={() => {}} />,
    );
    const cell = screen.getByRole('columnheader');
    expect(cell.getAttribute('aria-sort')).toBe('none');
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe('Sort by Name');
  });

  it('emits aria-sort="ascending" with a descriptive next-action label', () => {
    renderInTable(
      <SortableHeader label="Name" active dir="asc" onSort={() => {}} />,
    );
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('ascending');
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(
      'Sorted by Name, ascending. Activate to sort descending.',
    );
  });

  it('emits aria-sort="descending" with a descriptive next-action label', () => {
    renderInTable(
      <SortableHeader label="Created" active dir="desc" onSort={() => {}} />,
    );
    expect(screen.getByRole('columnheader').getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByRole('button').getAttribute('aria-label')).toBe(
      'Sorted by Created, descending. Activate to sort ascending.',
    );
  });

  it('calls onSort when the header button is clicked', () => {
    const onSort = vi.fn();
    renderInTable(
      <SortableHeader label="Name" active={false} dir="asc" onSort={onSort} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onSort).toHaveBeenCalledTimes(1);
  });

  it('renders an explicit role="columnheader" div for grid (as="div")', () => {
    render(<SortableHeader as="div" label="Size" active dir="desc" onSort={() => {}} />);
    const cell = screen.getByRole('columnheader');
    expect(cell.tagName).toBe('DIV');
    expect(cell.getAttribute('aria-sort')).toBe('descending');
  });
});
