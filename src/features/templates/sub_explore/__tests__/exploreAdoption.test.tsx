import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: en,
    tx: (s: string, vars: Record<string, string | number>) =>
      s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? `{${k}}`)),
  }),
}));

const listDesignReviewsPaginated = vi.fn();
vi.mock('@/api/overview/reviews', () => ({
  listDesignReviewsPaginated: (...a: unknown[]) => listDesignReviewsPaginated(...a),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (sel: (s: Record<string, unknown>) => unknown) => sel({ addToast }),
}));

// The wizard drags in the whole build-session stack; this spec is about which
// review Explore hands it.
const adoptProps: Record<string, unknown>[] = [];
vi.mock('@/features/templates/sub_generated/adoption/AdoptionWizardModal', () => ({
  default: (props: Record<string, unknown>) => {
    adoptProps.push(props);
    return props.isOpen ? <div data-testid="adopt-wizard" data-review={String((props.review as { id?: string })?.id)} /> : null;
  },
}));

vi.mock('../atlas/BentoGrid', () => ({
  BentoGrid: ({ onPick }: { onPick: (d: string) => void }) => (
    <button type="button" data-testid="pick-domain" onClick={() => onPick('support')}>domain</button>
  ),
}));

vi.mock('../level2/DomainLevel2', () => ({
  DomainLevel2: ({ onSelect, onSelectRecipe }: {
    onSelect?: (i: { id: string; name: string }) => void;
    onSelectRecipe?: (r: { sourceTemplateId: string | null; name: string }) => void;
  }) => (
    <div>
      <button type="button" data-testid="pick-template" onClick={() => onSelect?.({ id: 'email-digest', name: 'Email Morning Digest' })}>t</button>
      <button type="button" data-testid="pick-recipe-linked" onClick={() => onSelectRecipe?.({ sourceTemplateId: 'email-digest', name: 'Digest at 8am' })}>r1</button>
      <button type="button" data-testid="pick-recipe-orphan" onClick={() => onSelectRecipe?.({ sourceTemplateId: null, name: 'Orphan recipe' })}>r2</button>
    </div>
  ),
}));

import ExploreView from '../ExploreView';

const review = (over: Partial<PersonaDesignReview> = {}) =>
  ({ id: 'review-1', test_case_id: 'email-digest', test_case_name: 'Email Morning Digest', ...over }) as PersonaDesignReview;

async function openDomain() {
  render(<ExploreView />);
  fireEvent.click(screen.getByTestId('pick-domain'));
}

describe('Explore pick opens adoption', () => {
  beforeEach(() => {
    adoptProps.length = 0;
    addToast.mockClear();
    listDesignReviewsPaginated.mockReset();
  });

  it('opens the wizard on the review whose test_case_id is the picked catalog id', async () => {
    listDesignReviewsPaginated.mockResolvedValue({
      items: [review({ id: 'other', test_case_id: 'something-else' }), review()],
      total: 2,
    });
    await openDomain();
    fireEvent.click(screen.getByTestId('pick-template'));

    await waitFor(() => expect(screen.getByTestId('adopt-wizard')).toBeTruthy());
    expect(screen.getByTestId('adopt-wizard').getAttribute('data-review')).toBe('review-1');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('resolves a recipe through its source template', async () => {
    listDesignReviewsPaginated.mockResolvedValue({ items: [review()], total: 1 });
    await openDomain();
    fireEvent.click(screen.getByTestId('pick-recipe-linked'));

    await waitFor(() => expect(screen.getByTestId('adopt-wizard')).toBeTruthy());
    expect(listDesignReviewsPaginated).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'Digest at 8am' }),
    );
  });

  it('says so instead of opening when the catalog id has no seeded review', async () => {
    listDesignReviewsPaginated.mockResolvedValue({ items: [review({ test_case_id: 'nope' })], total: 1 });
    await openDomain();
    fireEvent.click(screen.getByTestId('pick-template'));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addToast.mock.calls[0]![0]).toContain('Email Morning Digest');
    expect(screen.queryByTestId('adopt-wizard')).toBeNull();
  });

  it('refuses a recipe with no source template without an IPC round-trip', async () => {
    await openDomain();
    fireEvent.click(screen.getByTestId('pick-recipe-orphan'));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(listDesignReviewsPaginated).not.toHaveBeenCalled();
    expect(screen.queryByTestId('adopt-wizard')).toBeNull();
  });

  it('surfaces a lookup failure as an error toast, not a dead pick', async () => {
    listDesignReviewsPaginated.mockRejectedValue(new Error('ipc down'));
    await openDomain();
    fireEvent.click(screen.getByTestId('pick-template'));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    expect(addToast.mock.calls[0]![1]).toBe('error');
  });
});
