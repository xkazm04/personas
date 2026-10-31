import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { ColorRow } from '../ColorRow';

/**
 * Escape closes the colour popup through useClickOutside, which unmounts the focused hex input
 * and left document.activeElement on <body>: a keyboard user lost their place across 9 rows.
 */
describe('colour row popup returns focus to its opener', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('Escape with focus in the hex field puts focus back on the swatch button', () => {
    render(<ColorRow label="Primary" value="#336699" derivedValue={undefined} onChange={() => {}} />);
    const trigger = screen.getByTitle('Pick Primary');
    fireEvent.click(trigger);
    const region = screen.getByRole('region', { name: 'Primary color picker' });
    const hex = within(region).getByRole('textbox');
    act(() => hex.focus());
    expect(document.activeElement).toBe(hex);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('the popup region is not announced as a menu', () => {
    render(<ColorRow label="Primary" value="#336699" derivedValue={undefined} onChange={() => {}} />);
    expect(screen.getByTitle('Pick Primary').getAttribute('aria-haspopup')).not.toBe('true');
  });
});
