// The save dot is the only sign a note is unsaved or failed. It carried an
// aria-label on a role-less span, which assistive tech does not expose.
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';

import { preloadSectionsAsync } from '@/i18n/useTranslation';

import { SaveDot } from '../parts/SaveDot';

describe('SaveDot', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['notepad']);
  });

  it('names each unsaved state to assistive tech', () => {
    const { rerender } = render(<SaveDot state="dirty" />);
    expect(screen.getByRole('img', { name: 'Unsaved changes' })).toBeTruthy();
    rerender(<SaveDot state="error" />);
    expect(screen.getByRole('img').getAttribute('aria-label')).toBeTruthy();
  });

  it('renders nothing for a clean note', () => {
    const { container } = render(<SaveDot state="clean" />);
    expect(container.firstChild).toBeNull();
  });
});
