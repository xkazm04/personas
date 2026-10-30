import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FavoriteCell, NameCell } from '../PersonaOverviewCells';
import type { Persona } from '@/lib/bindings/Persona';

const persona = { id: 'p1', name: 'Scribe' } as unknown as Persona;

describe('NameCell rename affordance', () => {
  // The Director is located by (name, trust_origin = system) at boot and in
  // useDirector, so renaming it re-seeded a second Director. The backend now
  // refuses the rename; the roster must not offer it.
  it('does not offer a rename for a system persona', () => {
    const director = { id: 'd1', name: 'Director', trust_origin: 'system' } as unknown as Persona;
    render(<NameCell persona={director} onClick={vi.fn()} />);
    expect(screen.getByText('Director')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /rename/i, hidden: true })).toBeNull();
  });

  it('still offers a rename for an ordinary persona', () => {
    const user = { id: 'u1', name: 'Scribe', trust_origin: 'user' } as unknown as Persona;
    render(<NameCell persona={user} onClick={vi.fn()} />);
    expect(screen.getByRole('button', { name: /rename/i, hidden: true })).toBeInTheDocument();
  });
});

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
