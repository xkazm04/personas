// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { fmtDate } from '../executionMetricsHelpers';
import { useI18nStore } from '@/stores/i18nStore';

const original = useI18nStore.getState().language;
afterEach(() => useI18nStore.setState({ language: original }));

describe('fmtDate', () => {
  it('follows the active UI language instead of a hardcoded en-US', () => {
    useI18nStore.setState({ language: 'en' });
    expect(fmtDate('2026-10-12')).toBe('Oct 12');
    useI18nStore.setState({ language: 'de' });
    expect(fmtDate('2026-10-12')).not.toBe('Oct 12');
    expect(fmtDate('2026-10-12')).toContain('12');
  });
});
