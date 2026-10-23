import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, renderHook, waitFor } from '@testing-library/react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

function review(id: string, connectors: string[]): PersonaDesignReview {
  // The picker reads only these fields; the rest of the row is irrelevant here.
  const row: Partial<PersonaDesignReview> = {
    id,
    test_case_name: `Template ${id}`,
    instruction: `Do ${id}`,
    connectors_used: JSON.stringify(connectors),
    design_result: null,
  };
  return row as PersonaDesignReview;
}

// Five starters; only the fifth uses the app the user approves.
const POOL = [
  review('t1', []),
  review('t2', []),
  review('t3', ['gmail']),
  review('t4', ['slack']),
  review('t5', ['obsidian']),
];

vi.mock('@/api/overview/reviews', () => ({
  getTrendingTemplates: () => Promise.resolve(POOL),
  listDesignReviews: () => Promise.resolve([]),
}));
vi.mock('@/api/system/desktop', () => ({
  discoverDesktopApps: () => Promise.resolve([]),
  getDesktopConnectorManifest: vi.fn(),
  approveDesktopCapabilities: vi.fn(),
}));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { useSystemStore } from '@/stores/systemStore';
import { useOnboardingState } from '../useOnboardingState';
import { TemplatePickerStep } from '../TemplatePickerStep';
import { pickStarterTemplates, STARTER_TEMPLATES_SHOWN } from '../templateRecommendation';

describe('starter templates are ranked by approved apps BEFORE the trim', () => {
  beforeEach(() => {
    useSystemStore.setState({ onboardingActive: true });
  });

  it('an app-matching template from the back of the pool is offered and badged', async () => {
    const { result } = renderHook(() => useOnboardingState());
    await waitFor(() => expect(result.current.templateLoadState.phase).toBe('loaded'));

    const { container } = render(
      <TemplatePickerStep
        templates={result.current.templates}
        loadState={result.current.templateLoadState}
        selectedId={null}
        approvedApps={new Set(['desktop_obsidian'])}
        onSelect={vi.fn()}
        onRetry={vi.fn()}
      />,
    );
    const cards = container.querySelectorAll('[data-testid^="template-card-"]');
    expect(cards.length).toBe(STARTER_TEMPLATES_SHOWN);
    expect(cards[0]!.getAttribute('data-testid')).toBe('template-card-t5');
    expect(cards[0]!.getAttribute('data-recommended')).toBe('true');
  });

  it('with no approved apps the pool order (zero-credential first) decides', () => {
    const picked = pickStarterTemplates(POOL, new Set());
    expect(picked.map((m) => m.review.id)).toEqual(['t1', 't2', 't3']);
  });
});
