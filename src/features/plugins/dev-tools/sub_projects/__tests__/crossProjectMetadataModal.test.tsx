import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { useToastStore } from '@/stores/toastStore';

// A failed "Generate" must tell the operator why. The rejection is an AppError
// object, so `err instanceof Error` was always false and the toast always read
// the hardcoded English 'Generation failed'.

const generateCrossProjectMetadata = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/devTools', () => ({
  generateCrossProjectMetadata,
  getCrossProjectMetadata: vi.fn(async () => null),
}));
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import { CrossProjectMetadataModal } from '../CrossProjectMetadataModal';

beforeEach(() => {
  vi.clearAllMocks();
  useToastStore.setState({ toasts: [] });
});

describe('Cross-project map generation failure', () => {
  it('toasts the backend reason, not a hardcoded fallback', async () => {
    generateCrossProjectMetadata.mockRejectedValue({ error: 'No projects with a context map yet', kind: 'validation' });
    render(<CrossProjectMetadataModal open onClose={() => {}} />);
    fireEvent.click(await screen.findByText(en.plugins.dev_tools.generate));
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(0));
    const messages = useToastStore.getState().toasts.map((x) => x.message);
    expect(messages).toContain('No projects with a context map yet');
    expect(messages).not.toContain('Generation failed');
  });
});
