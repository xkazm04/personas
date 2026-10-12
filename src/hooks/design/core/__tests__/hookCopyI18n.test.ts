import { describe, it, expect } from 'vitest';
import { getActiveTranslations, interpolate } from '@/i18n/useTranslation';

describe('hook-emitted status copy lives in the errors catalog', () => {
  it('resolves every hook-emitted key and interpolates placeholders', () => {
    const e = getActiveTranslations().errors;
    expect(e.stream_timeout).toBeTruthy();
    expect(e.operation_cancelled).toBeTruthy();
    expect(interpolate(e.oauth_completed, { provider: 'Google' })).toContain('Google');
    expect(interpolate(e.ai_search_coverage, { searched: 3, total: 9 })).toContain('9');
    expect(interpolate(e.ai_search_failed, { detail: 'boom' })).toContain('boom');
  });
});
