import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { RebuildModal } from '../RebuildModal';
import { TemplatePreviewModal } from '../TemplatePreviewModal';

const review = (): PersonaDesignReview =>
  ({
    id: 'r1',
    test_case_id: 'tpl-1',
    test_case_name: 'Morning digest',
    instruction: 'Summarise the overnight inbox',
    design_result: null,
    use_case_flows: null,
    test_run_id: 'seed-category-v1',
  }) as unknown as PersonaDesignReview;

/** Buttons a screen reader would announce with no name at all. */
function unnamedButtons(): HTMLElement[] {
  return screen.getAllByRole('button').filter((b) =>
    !b.getAttribute('aria-label') && !(b.textContent ?? '').trim());
}

describe('gallery modal close controls', () => {
  it('the rebuild modal X is announced as Close', () => {
    render(
      <RebuildModal isOpen onClose={vi.fn()} review={review()} phase="idle" lines={[]} error={null}
        onStartRebuild={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(unnamedButtons()).toEqual([]);
    expect(screen.getByRole('button', { name: en.common.close })).toBeTruthy();
  });

  it('the preview modal X is announced as Close', () => {
    render(
      <TemplatePreviewModal isOpen onClose={vi.fn()} review={review()} phase="idle" lines={[]} error={null}
        hasStarted={false} onStartPreview={vi.fn()} onRetryPreview={vi.fn()} />,
    );
    expect(unnamedButtons()).toEqual([]);
    // The header X and the footer Close button.
    expect(screen.getAllByRole('button', { name: en.common.close })).toHaveLength(2);
  });
});
