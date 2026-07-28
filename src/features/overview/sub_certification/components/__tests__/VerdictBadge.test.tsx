import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VerdictBadge, VERDICT_CONFIG } from '../VerdictBadge';
import en from '@/i18n/locales/en.json';

// Parity guard: VERDICT_CONFIG is now the single source of truth for both the
// StatusBadge accent color and the `status_tokens.verdict` i18n token key. If
// a verdict is added to one without the other, this test fails instead of the
// badge silently degrading (unstyled `slate` accent, or an untranslated raw
// token rendered to the user).
describe('VerdictBadge — verdict/i18n token parity', () => {
  it('VERDICT_CONFIG token keys cover exactly the same set as status_tokens.verdict', () => {
    const configTokenKeys = Object.values(VERDICT_CONFIG)
      .map((c) => c.tokenKey)
      .sort();
    const i18nTokenKeys = Object.keys(en.status_tokens.verdict).sort();
    expect(configTokenKeys).toEqual(i18nTokenKeys);
  });

  it('renders a translated label and the mapped accent for each known verdict', () => {
    render(<VerdictBadge verdict="PRODUCTION" />);
    expect(screen.getByText('Production')).toBeTruthy();
  });

  it('falls back to slate accent for an unrecognized verdict', () => {
    render(<VerdictBadge verdict="SOMETHING_NEW" />);
    // Unknown verdict: tokenLabel falls back to the raw (derived) token key.
    expect(screen.getByText('something_new')).toBeTruthy();
  });
});
