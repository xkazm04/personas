/**
 * Every icon-only button in the persona selectors has an accessible name.
 * Four were bare `<X />` glyphs: the selector's clear-search, the modal's close
 * and clear-search, and the column filter's clear-filter. A screen reader
 * announced each as "button".
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Persona } from '@/lib/bindings/Persona';
import { PersonaColumnFilter } from '../PersonaColumnFilter';
import { PersonaSelector } from '../PersonaSelector';
import { PersonaSelectorModal } from '../PersonaSelectorModal';

// Only the fields the selectors read; a fixture, not a stored row.
const personas: Persona[] = Array.from({ length: 6 }, (_, i): Persona => ({
  id: `p-${i}`,
  name: `Agent ${i}`,
  description: null,
  icon: null,
  color: null,
}) as Partial<Persona> as Persona);

describe('persona selector icon buttons', () => {
  it('names the modal close and clear-search buttons', () => {
    render(<PersonaSelectorModal value="" onChange={vi.fn()} personas={personas} defaultOpen />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Agent' } });
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('is keyboard operable: arrows move, Enter picks, Escape closes', () => {
    const onChange = vi.fn();
    render(<PersonaSelector value="" onChange={onChange} personas={personas} />);
    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // Searchable popup focuses row 0 ("All"); two ArrowDowns reach the second persona.
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('p-1');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(screen.getAllByRole('button')[0]!);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('names the column filter clear button', () => {
    render(<PersonaColumnFilter value="p-1" onChange={vi.fn()} personas={personas} />);
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });
});
