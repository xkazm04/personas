/**
 * What the recipes table costs at catalog scale.
 *
 * The catalog is fetched whole into `pipelineStore` and is expected to pass
 * 1000 entries, so the two things that decide whether this surface stays usable
 * are (a) how many rows reach the DOM and (b) whether appending a page
 * re-renders the rows already there. Both are invisible in a screenshot and
 * both are one careless prop away from silently coming back, which is why they
 * are asserted here rather than described in a comment.
 *
 * `ConnectorIcon` is mocked with a spy and every fixture row is given its OWN
 * connector slug, so the labels the spy receives name exactly which rows
 * rendered. That turns "the rows are memoised" from a claim into a measurement
 * — and, unlike a call COUNT, it stays correct if a cell ever renders a
 * different number of icons.
 */
import { afterEach, beforeAll, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Recipe, Eligibility } from '../../types';

const iconSpy = vi.fn();

vi.mock('@/lib/connectors/connectorMeta', () => ({
  ConnectorIcon: (props: { meta: { label: string } }) => {
    iconSpy(props.meta.label);
    return <span data-testid="connector-icon" />;
  },
  getConnectorMeta: (name: string) => ({ label: name, color: '#888888', iconUrl: null, Icon: () => null }),
}));

import { RecipesTableResults } from '../RecipesTableResults';

// jsdom reports every layout box as 0, which would make the table look
// permanently scrolled to its bottom and page the whole catalog in at once.
// Model a real scroller instead — and note that `scrollHeight` must GROW with
// the rows: a fixed value stays "at the bottom" after a page is appended, so
// the loader never stops. That is a property of the stub, not of the table, and
// getting it wrong is what makes an infinite-scroll test lie in both
// directions.
const ROW_PX = 40;
const CHROME_PX = 200;
const CLIENT_HEIGHT = 400;

const contentHeight = () =>
  document.querySelectorAll('[data-testid^="recipe-row-"]').length * ROW_PX + CHROME_PX;

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return contentHeight(); },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() { return CLIENT_HEIGHT; },
  });
});

afterEach(() => {
  cleanup();
  iconSpy.mockClear();
});

const makeRecipes = (count: number, prefix = 'r'): Recipe[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`,
    slug: `${prefix}-${i}`,
    name: `Recipe ${String(i).padStart(3, '0')}`,
    summary: 'summary',
    description: 'description',
    tags: [],
    category: 'automation',
    version: '1.0.0',
    // Unique per row so the icon spy identifies WHICH rows rendered.
    requiredConnectors: [`${prefix}-conn-${i}`],
    iconConnector: `${prefix}-conn-${i}`,
  } as unknown as Recipe));

/** Distinct row indices the icon spy has seen since it was last cleared. */
const renderedRowIndices = () =>
  [...new Set(iconSpy.mock.calls.map(([label]: [string]) => Number(String(label).split('-').pop())))].sort((a, b) => a - b);

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_MAP = new Map<string, Eligibility>();
const noop = () => {};

function renderTable(recipes: Recipe[]) {
  return render(
    <RecipesTableResults
      recipes={recipes}
      eligibilityMap={EMPTY_MAP}
      personaSelected={false}
      adoptedRecipeIds={EMPTY_SET}
      staleRecipeIds={EMPTY_SET}
      onOpenDetail={noop}
    />,
  );
}

const rowCount = () => screen.queryAllByTestId(/^recipe-row-/).length;

/** Drive the table's own scroller to its bottom and let the rAF-throttled
 *  handler run. */
async function scrollToBottom() {
  const scroller = document.querySelector('.overflow-auto') as HTMLElement;
  expect(scroller).toBeTruthy();
  scroller.scrollTop = contentHeight() - CLIENT_HEIGHT;
  fireEvent.scroll(scroller);
}

describe('RecipesTableResults paging', () => {
  it('renders only the first page, not the whole catalog', () => {
    renderTable(makeRecipes(60));
    expect(rowCount()).toBe(20);
  });

  it('appends the next page when the scroller reaches the end', async () => {
    renderTable(makeRecipes(60));
    expect(rowCount()).toBe(20);

    await scrollToBottom();
    await waitFor(() => expect(rowCount()).toBe(40));

    await scrollToBottom();
    await waitFor(() => expect(rowCount()).toBe(60));
  });

  it('stops at the total and never over-fetches', async () => {
    renderTable(makeRecipes(25));
    await scrollToBottom();
    await waitFor(() => expect(rowCount()).toBe(25));

    // Already exhausted — another end-reach must be a no-op, not a throw or a
    // count that creeps past the data.
    await scrollToBottom();
    await waitFor(() => expect(rowCount()).toBe(25));
  });

  it('resets to page one when the filtered list changes', async () => {
    const { rerender } = renderTable(makeRecipes(60));
    await scrollToBottom();
    await waitFor(() => expect(rowCount()).toBe(40));

    // A filter narrowing the set hands down a different array. Staying 40 rows
    // deep in a list the user just replaced is the bug this guards.
    rerender(
      <RecipesTableResults
        recipes={makeRecipes(60, 'other')}
        eligibilityMap={EMPTY_MAP}
        personaSelected={false}
        adoptedRecipeIds={EMPTY_SET}
        staleRecipeIds={EMPTY_SET}
        onOpenDetail={noop}
      />,
    );
    await waitFor(() => expect(rowCount()).toBe(20));
  });

  it('does not re-render the rows already on screen when a page is appended', async () => {
    renderTable(makeRecipes(60));
    expect(renderedRowIndices()).toEqual(Array.from({ length: 20 }, (_, i) => i));
    iconSpy.mockClear();

    await scrollToBottom();
    await waitFor(() => expect(rowCount()).toBe(40));

    // Only rows 20-39 may have rendered. If `RecipeRow`'s memo is defeated — an
    // unstable `eligibility` literal, a per-row closure for `onOpenDetail` —
    // rows 0-19 reappear here and every page costs the whole list again.
    expect(renderedRowIndices()).toEqual(Array.from({ length: 20 }, (_, i) => i + 20));
  });
});

describe('RecipesTableResults sorting', () => {
  it('orders versions numerically, not lexically', async () => {
    const recipes = [
      { ...makeRecipes(1, 'a')[0]!, id: 'a', slug: 'a', name: 'A', version: '9.0.0' },
      { ...makeRecipes(1, 'b')[0]!, id: 'b', slug: 'b', name: 'B', version: '10.0.0' },
      { ...makeRecipes(1, 'c')[0]!, id: 'c', slug: 'c', name: 'C', version: '2.0.0' },
    ] as Recipe[];
    renderTable(recipes);

    // Ascending by version. Plain `localeCompare` puts "10.0.0" before "2.0.0";
    // the collator is configured `numeric` precisely so it does not.
    fireEvent.click(screen.getByRole('button', { name: /version/i }));
    await waitFor(() => {
      const order = screen.getAllByTestId(/^recipe-row-/).map((el) => el.getAttribute('data-testid'));
      expect(order).toEqual(['recipe-row-c', 'recipe-row-a', 'recipe-row-b']);
    });
  });

  it('toggles direction when the same column is clicked twice', async () => {
    renderTable(makeRecipes(3));
    const header = screen.getByRole('button', { name: /recipe/i });
    const first = () => screen.getAllByTestId(/^recipe-row-/)[0]!.getAttribute('data-testid');

    // The table opens sorted by name ascending, so the FIRST click on that same
    // column flips to descending rather than re-applying ascending.
    expect(first()).toBe('recipe-row-r-0');

    fireEvent.click(header);
    await waitFor(() => expect(first()).toBe('recipe-row-r-2'));

    fireEvent.click(header);
    await waitFor(() => expect(first()).toBe('recipe-row-r-0'));
  });

  it('exposes the active column to assistive tech via aria-sort', async () => {
    renderTable(makeRecipes(3));
    fireEvent.click(screen.getByRole('button', { name: /category/i }));
    await waitFor(() => {
      const sorted = document.querySelectorAll('th[aria-sort="ascending"]');
      expect(sorted).toHaveLength(1);
    });
  });
});
