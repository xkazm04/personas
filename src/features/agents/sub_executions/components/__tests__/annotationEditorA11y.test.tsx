/**
 * Every control in the annotation editor has an accessible name: the tag input,
 * the note textarea and the icon-only add button.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const t = {
  common: { add: 'common.add' },
  agents: {
    activity: new Proxy({}, { get: (_o, key) => `activity.${String(key)}` }),
  },
};
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
}));
vi.mock('@/lib/silentCatch', () => ({ toastCatch: () => vi.fn() }));

import { AnnotationEditor } from '../AnnotationEditor';

describe('AnnotationEditor accessible names', () => {
  it('names the tag input, note textarea and add button', () => {
    render(
      <AnnotationEditor executionId="e" personaId="p" annotation={null} onSave={vi.fn()} />,
    );
    expect(screen.getByRole('textbox', { name: 'activity.annotation_tags_label' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'activity.annotation_note_label' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common.add' })).toBeTruthy();
  });
});
