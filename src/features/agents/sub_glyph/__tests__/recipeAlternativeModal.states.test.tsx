/**
 * RecipeAlternativeModal async states: a pending get_recipe shows a ghost body
 * (LoadingSpinner renders nothing), and a failed one offers a retry that
 * re-fetches instead of leaving the user with only "close".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, { get: (_o, section) => leaf(String(section)) });
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
}));
vi.mock('@/features/shared/components/modals', () => ({
  BaseModal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const getRecipe = vi.fn();
vi.mock('@/api/recipes/recipes', () => ({ getRecipe: (...a: unknown[]) => getRecipe(...a) }));

import { RecipeAlternativeModal } from '../RecipeAlternativeModal';

const props = { recipeId: 'r1', recipeName: 'R', matchScore: 0.5, onClose: vi.fn(), onSelect: vi.fn() };

beforeEach(() => { vi.clearAllMocks(); });

describe('RecipeAlternativeModal async states', () => {
  it('renders a ghost body while get_recipe is pending', () => {
    getRecipe.mockReturnValue(new Promise(() => {}));
    render(<RecipeAlternativeModal {...props} />);
    expect(screen.getByTestId('recipe-alternative-loading')).toBeTruthy();
  });

  it('offers a retry on failure that fetches again', async () => {
    getRecipe.mockRejectedValueOnce(new Error('boom'));
    getRecipe.mockReturnValue(new Promise(() => {}));
    render(<RecipeAlternativeModal {...props} />);
    const retry = await screen.findByTestId('recipe-alternative-retry');
    fireEvent.click(retry);
    await waitFor(() => expect(getRecipe).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId('recipe-alternative-loading')).toBeTruthy();
  });
});
