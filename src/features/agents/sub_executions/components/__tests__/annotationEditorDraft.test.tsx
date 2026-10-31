/**
 * A draft typed before the saved annotation loads must survive the load; an
 * untouched editor still follows the annotation, and switching execution resets.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';

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

const saved = (over: Partial<ExecutionAnnotation> = {}): ExecutionAnnotation =>
  // Test fixture: only the fields the editor reads are populated.
  ({ id: 'a1', execution_id: 'e1', tags: ['x'], note: 'server note', starred: false, ...over }) as ExecutionAnnotation;

const noteBox = () => screen.getByRole('textbox', { name: 'activity.annotation_note_label' }) as HTMLTextAreaElement;
const ui = (annotation: ExecutionAnnotation | null, executionId = 'e1') => (
  <AnnotationEditor executionId={executionId} personaId="p" annotation={annotation} onSave={vi.fn()} />
);

describe('AnnotationEditor draft vs load', () => {
  it('keeps a draft typed before the annotation lands', () => {
    const { rerender } = render(ui(null));
    fireEvent.change(noteBox(), { target: { value: 'my draft' } });
    rerender(ui(saved()));
    expect(noteBox().value).toBe('my draft');
  });

  it('follows the annotation when nothing was typed', () => {
    const { rerender } = render(ui(null));
    rerender(ui(saved()));
    expect(noteBox().value).toBe('server note');
  });

  it('resets when the execution changes', () => {
    const { rerender } = render(ui(saved()));
    fireEvent.change(noteBox(), { target: { value: 'draft' } });
    rerender(ui(saved({ id: 'a2', execution_id: 'e2', note: 'other' }), 'e2'));
    expect(noteBox().value).toBe('other');
  });
});
