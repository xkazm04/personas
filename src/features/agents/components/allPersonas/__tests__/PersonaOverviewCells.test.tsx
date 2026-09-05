import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FavoriteCell } from '../PersonaOverviewCells';
import type { Persona } from '@/lib/bindings/Persona';

const persona = { id: 'p1', name: 'Scribe' } as unknown as Persona;

describe('FavoriteCell accessible name', () => {
  it('names the favorite toggle for assistive tech', () => {
    // The button is icon-only and its label lived solely in a Tooltip, which
    // wires aria-describedby - a DESCRIPTION, not a name. A screen reader
    // announced "button" and nothing else on the roster's star control.
    render(<FavoriteCell persona={persona} isFavorite={false} onToggle={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /favou?rite|star/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('reports the pressed state when the persona is a favorite', () => {
    render(<FavoriteCell persona={persona} isFavorite onToggle={vi.fn()} />);
    expect(screen.getByRole('button', { name: /favou?rite|star/i })).toHaveAttribute('aria-pressed', 'true');
  });
});
