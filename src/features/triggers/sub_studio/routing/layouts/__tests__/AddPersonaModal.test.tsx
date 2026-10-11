import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Persona } from '@/lib/bindings/Persona';
import { AddPersonaModal } from '../AddPersonaModal';

vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  const { default: t } = await import('@/i18n/locales/en.json');
  return { ...actual, useTranslation: () => ({ t }) };
});
vi.mock('@/features/agents/components/PersonaIcon', () => ({ PersonaIcon: () => <span /> }));

// Only the fields AddPersonaModal reads; the rest of the binding is irrelevant here.
function persona(id: string, name: string, designContext: string | null): Persona {
  return { id, name, description: null, icon: null, color: null, home_team_id: null, design_context: designContext } as Persona;
}

const SCOPED = persona('p-scoped', 'Scoped Scout', JSON.stringify({ useCases: [{ id: 'uc-1', title: 'Triage', enabled: true }] }));
const PLAIN = persona('p-plain', 'Plain Pal', null);

function renderModal(open: boolean, onAdd = vi.fn(), eventLabel = 'event_x') {
  const props = { personas: [SCOPED, PLAIN], teams: [], alreadyActiveIds: new Set<string>(), onAdd, onClose: vi.fn() };
  const view = render(<AddPersonaModal open={open} eventLabel={eventLabel} {...props} />);
  return {
    onAdd,
    reopen: (label: string) => {
      view.rerender(<AddPersonaModal open={false} eventLabel={eventLabel} {...props} />);
      view.rerender(<AddPersonaModal open eventLabel={label} {...props} />);
    },
  };
}

describe('AddPersonaModal per-open state', () => {
  it('reopens on the persona list, not the previous persona capability step', () => {
    const { reopen } = renderModal(true);
    fireEvent.click(screen.getByRole('button', { name: /Scoped Scout/ }));
    expect(screen.getByText('Scope "Scoped Scout" to…')).toBeTruthy();

    reopen('event_y');

    expect(screen.queryByText('Scope "Scoped Scout" to…')).toBeNull();
    expect(screen.getByText('Connect persona to "event_y"')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Plain Pal/ })).toBeTruthy();
  });

  it('clears the search between opens', () => {
    const { reopen } = renderModal(true);
    const input = screen.getByRole('textbox') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'plain' } });
    expect(screen.queryByRole('button', { name: /Scoped Scout/ })).toBeNull();

    reopen('event_y');

    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: /Scoped Scout/ })).toBeTruthy();
  });
});
