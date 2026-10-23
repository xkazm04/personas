/**
 * The composite operator picker and the file-watcher event chips read their
 * copy from the catalog.
 *
 * The operator field rendered "Operator", "ALL (AND)", "All conditions must
 * match"... as English literals in all 14 locales while the six op_* keys sat
 * translated and unread (and the label was the literal ternary
 * `t.triggers.op_all_label ? 'Operator' : 'Operator'`). The event chips printed
 * the raw engine tokens. Rendered here against the Czech catalog so an English
 * literal cannot pass by coincidence.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import csTriggers from '@/i18n/section-locales/cs/triggers.json';
import enCommon from '@/i18n/section-locales/en/common.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { triggers: csTriggers, common: enCommon },
    tx: (s: string) => s,
    language: 'cs',
  }),
}));

const { CompositeConfig } = await import('../configs/CompositeConfig');
const { FileWatcherConfig } = await import('../configs/FileWatcherConfig');

describe('trigger config copy comes from the catalog', () => {
  it('composite operator label, options and descriptions are translated', () => {
    render(
      <CompositeConfig
        compositeConditions={[{ event_type: 'a' }, { event_type: 'b' }]}
        setCompositeConditions={() => {}}
        compositeOperator="all"
        setCompositeOperator={() => {}}
        windowSeconds="60"
        setWindowSeconds={() => {}}
        validationError={null}
        setValidationError={() => {}}
      />,
    );
    expect(screen.getByText(csTriggers.operator_colon.replace(/\s*[:：]\s*$/, ''))).toBeTruthy();
    for (const label of [csTriggers.op_all_label, csTriggers.op_any_label, csTriggers.op_sequence_label]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: csTriggers.op_all_label }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByText('ALL (AND)')).toBeNull();
    expect(screen.queryByText('Operator')).toBeNull();
  });

  it('file-watcher event chips are translated, not raw engine tokens', () => {
    render(
      <FileWatcherConfig
        watchPaths={['/tmp']}
        setWatchPaths={() => {}}
        watchEvents={['modify']}
        setWatchEvents={() => {}}
        watchRecursive
        setWatchRecursive={() => {}}
        globFilter=""
        setGlobFilter={() => {}}
        validationError={null}
        setValidationError={() => {}}
      />,
    );
    const fw = csTriggers.file_watcher;
    for (const label of [fw.event_create, fw.event_modify, fw.event_delete]) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'modify' })).toBeNull();
  });
});
