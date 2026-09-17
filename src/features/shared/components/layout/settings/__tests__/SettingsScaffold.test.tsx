import { describe, it, expect } from 'vitest';
import { render, fireEvent, within } from '@testing-library/react';
import { SettingsScaffold, type SettingsSection } from '../SettingsScaffold';

const sections: SettingsSection[] = [
  { id: 'engine', label: 'Engine', content: <p>engine body</p> },
  { id: 'limits', label: 'Limits', content: <p>limits body</p> },
  { id: 'appearance', label: 'Appearance', content: <p>appearance body</p> },
];

describe('SettingsScaffold section index', () => {
  it('renders a jumplist that is visible only below md, and a rail only at md and up', () => {
    const { container } = render(
      <SettingsScaffold sections={sections} navAriaLabel="Settings sections" />,
    );
    const jumplist = container.querySelector('[data-settings-jumplist]');
    expect(jumplist).toBeTruthy();
    expect(jumplist!.className).toContain('md:hidden');

    const rail = container.querySelector('nav');
    expect(rail).toBeTruthy();
    expect(rail!.className).toContain('hidden');
    expect(rail!.className).toContain('md:block');
  });

  it('lists every section in the jumplist', () => {
    const { container } = render(
      <SettingsScaffold sections={sections} navAriaLabel="Settings sections" />,
    );
    // Both indexes carry the same accessible name, which is correct: only one
    // of them is in the a11y tree at a time (the other is display:none). jsdom
    // applies no CSS, so scope the query to the jumplist.
    const jumplist = container.querySelector('[data-settings-jumplist]') as HTMLElement;
    const trigger = jumplist.querySelector('[aria-label="Settings sections"]') as HTMLElement;
    expect(trigger).toBeTruthy();

    fireEvent.click(trigger);
    for (const s of sections) {
      expect(within(document.body).getAllByText(s.label).length).toBeGreaterThan(0);
    }
    // Every section is reachable by its deep-link anchor too.
    for (const s of sections) {
      expect(document.getElementById(s.id)).toBeTruthy();
    }
  });

  it('renders no index at all when showNav is false', () => {
    const { container } = render(
      <SettingsScaffold sections={sections} navAriaLabel="Settings sections" showNav={false} />,
    );
    expect(container.querySelector('[data-settings-jumplist]')).toBeNull();
    expect(container.querySelector('nav')).toBeNull();
  });
});
