import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';
import { AutomationCardActions } from '../AutomationCardActions';

const automation = { id: 'a1', name: 'Nightly sync', deploymentStatus: 'active' } as unknown as PersonaAutomation;

function renderActions() {
  const onEdit = vi.fn();
  const onToggleStatus = vi.fn();
  const onDelete = vi.fn();
  render(<AutomationCardActions automation={automation} onEdit={onEdit} onToggleStatus={onToggleStatus} onDelete={onDelete} />);
  return { onEdit, onToggleStatus, onDelete };
}

describe('AutomationCardActions menu', () => {
  it('announces itself as a menu trigger and exposes the options as menu items', () => {
    renderActions();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('menu')).toBeTruthy();
    // Edit, Pause (active automation), Delete.
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('closes on Escape and on a click outside', () => {
    renderActions();
    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('routes pause through onToggleStatus and closes', () => {
    const { onToggleStatus } = renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'Actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /pause/i }));
    expect(onToggleStatus).toHaveBeenCalledWith('a1', 'paused');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});
