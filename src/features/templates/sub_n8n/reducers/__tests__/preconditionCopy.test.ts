// @vitest-environment node
/**
 * The wizard's step-precondition errors reach `state.error` through sessionReducer and were
 * English in every locale. The catalog is mocked with each leaf replaced by its own key path,
 * so a literal fails the assertions and a catalog lookup passes them.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const mark = (node: unknown, path: string): unknown =>
    typeof node === 'string'
      ? path
      : Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, mark(v, path ? `${path}.${k}` : k)]));
  const t = mark(en, '');
  return { getActiveTranslations: () => t };
});

import { checkStepPrecondition } from '../navigationReducer';

const N = 'templates.n8n.';
const empty = { parsedResult: null, draft: null, draftJsonError: null };

describe('checkStepPrecondition speaks through the catalog', () => {
  it('names a catalog key for each failing step', () => {
    expect(checkStepPrecondition('analyze', empty)).toBe(`${N}precond_analyze_no_parse`);
    expect(checkStepPrecondition('transform', empty)).toBe(`${N}precond_transform_no_parse`);
    expect(checkStepPrecondition('edit', empty)).toBe(`${N}precond_edit_no_draft`);
    expect(checkStepPrecondition('confirm', empty)).toBe(`${N}precond_confirm_no_draft`);
    const draft = {} as never;
    expect(checkStepPrecondition('confirm', { ...empty, draft, draftJsonError: 'bad' })).toBe(`${N}precond_confirm_json_errors`);
  });

  it('returns null when the prerequisites are met', () => {
    expect(checkStepPrecondition('upload', empty)).toBeNull();
    expect(checkStepPrecondition('analyze', { ...empty, parsedResult: {} as never })).toBeNull();
  });
});
