import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SectionCard } from '../SectionCard';

describe('SectionCard collapsible header', () => {
  it('announces its open state and flips it on toggle', () => {
    render(
      <SectionCard collapsible title="Sync options">
        <p>body</p>
      </SectionCard>,
    );
    const toggle = screen.getByRole('button', { name: /Sync options/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('starts closed when defaultCollapsed', () => {
    render(
      <SectionCard collapsible title="Folders" defaultCollapsed>
        <p>body</p>
      </SectionCard>,
    );
    expect(screen.getByRole('button', { name: /Folders/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('a static card renders no disclosure', () => {
    render(
      <SectionCard title="Static">
        <p>body</p>
      </SectionCard>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
