// @vitest-environment node
/**
 * An IPC rejection is a serialized AppError OBJECT, never an Error, so the
 * `e instanceof Error ? e.message : String(e)` ladder rendered
 * "[object Object]". The slot must show the backend's reason or the registry's
 * sentence for it.
 */
import { describe, expect, it } from 'vitest';
import en from '@/i18n/locales/en.json';
import type { Translations } from '@/i18n/useTranslation';
import { inlineErrorCopy } from '../inlineErrorCopy';

const t: Translations = en;

describe('inlineErrorCopy', () => {
  it('reads the message out of a serialized AppError', () => {
    const copy = inlineErrorCopy(t, { error: 'Event type "deploy_done" already has listeners', kind: 'validation' });
    expect(copy).not.toContain('[object Object]');
    expect(copy).toContain('deploy_done');
  });

  it('keeps an Error message and a plain string', () => {
    expect(inlineErrorCopy(t, new Error('channel already relayed'))).toBe('channel already relayed');
    expect(inlineErrorCopy(t, 'channel already relayed')).toBe('channel already relayed');
  });

  it('falls back when the rejection carries no text', () => {
    expect(inlineErrorCopy(t, {}, 'Could not create relay')).toBe('Could not create relay');
    expect(inlineErrorCopy(t, null).length).toBeGreaterThan(0);
  });
});
