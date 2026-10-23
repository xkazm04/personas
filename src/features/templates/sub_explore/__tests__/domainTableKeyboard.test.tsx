import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DomainTable } from '../level2/DomainTable';
import type { ExploreItem, ExploreRecipe } from '../useExploreCatalog';

const item: ExploreItem = {
  id: 'email-digest', name: 'Email Morning Digest', blurb: '', domainId: 'operations',
  category: 'productivity', serviceFlow: ['Gmail'], color: '#000', weight: 0.2,
};
const recipe: ExploreRecipe = {
  id: 'r1', name: 'Digest at 8am', blurb: '', domainId: 'operations', category: 'productivity',
  sourceTemplateId: 'email-digest', tags: [], toolCount: 1, weight: 0.2,
};

describe('DomainTable rows from the keyboard', () => {
  it('opens a template or recipe row with Enter or Space', () => {
    const onSelect = vi.fn();
    const onSelectRecipe = vi.fn();
    render(<DomainTable templates={[item]} recipes={[recipe]} accent="#000" onSelect={onSelect} onSelectRecipe={onSelectRecipe} />);

    const templateRow = screen.getByTestId('explore-row-template-email-digest');
    expect(templateRow.tabIndex).toBe(0);
    fireEvent.keyDown(templateRow, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(item);

    fireEvent.keyDown(screen.getByTestId('explore-row-recipe-r1'), { key: ' ' });
    expect(onSelectRecipe).toHaveBeenCalledWith(recipe);
  });

  it('exposes the sort state on the column headers', () => {
    render(<DomainTable templates={[item]} recipes={[recipe]} accent="#000" />);
    const header = (name: string) => screen.getByRole('button', { name }).closest('th')!;
    expect(header('Name').getAttribute('aria-sort')).toBe('ascending');
    expect(header('Tools').getAttribute('aria-sort')).toBe('none');

    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(header('Name').getAttribute('aria-sort')).toBe('descending');
  });
});
