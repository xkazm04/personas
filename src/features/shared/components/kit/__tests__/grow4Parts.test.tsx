/** The parts the Home review earned (kit grow-4): the emphasis recipe, row columns, Stack,
 *  ContextCard fill / figure / body, the Tile mark, KitButton describedBy and the calm ghost. */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextCard, ListRow, Rows } from '../index';

describe('the emphasis recipe (grow-4 part 5)', () => {
  it('a ListRow name is 500 by default: the tinted title above it carries the 600', () => {
    render(<Rows count={1} empty={{ title: 'none' }}><ListRow name="Invoice Reconciler" /></Rows>);
    const name = screen.getByText('Invoice Reconciler');
    expect(name.className).toContain('k-medium');
    expect(name.className).not.toContain('k-strong');
  });

  it('the 600 exception is explicit: a caller opts in through nameClass', () => {
    render(<Rows count={1} empty={{ title: 'none' }}><ListRow name="Lone name" nameClass="typo-body k-strong" /></Rows>);
    expect(screen.getByText('Lone name').className).toContain('k-strong');
  });

  it('a ContextCard title follows the same recipe', () => {
    render(<ContextCard title="Authentication" />);
    expect(screen.getByText('Authentication').className).toContain('k-medium');
  });

  it('the empty band follows it too, so one rule covers the kit', () => {
    render(<Rows count={0} empty={{ title: 'Nothing here' }}>{null}</Rows>);
    expect(screen.getByText('Nothing here').className).toContain('k-medium');
  });
});
