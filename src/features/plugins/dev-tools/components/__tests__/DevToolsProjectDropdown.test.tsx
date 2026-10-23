/**
 * invokeWithTimeout rejects with a serialized AppError OBJECT, never an Error.
 * The dropdown stored `String(err)` and rendered it, so a failed project load
 * showed "[object Object]" in the open menu.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/devTools/devTools', () => ({
  listProjects: vi.fn(() => Promise.reject({ error: 'database is locked', kind: 'Database' })),
}));

import { DevToolsProjectDropdown } from '../DevToolsProjectDropdown';

describe('DevToolsProjectDropdown load failure', () => {
  it('renders a readable message for an IPC AppError rejection', async () => {
    render(<DevToolsProjectDropdown value={null} onSelect={() => {}} />);
    const trigger = await screen.findByRole('button');
    await waitFor(() => expect(trigger).not.toHaveTextContent(/loading/i));
    fireEvent.click(trigger);
    await waitFor(() => expect(document.body.textContent).toMatch(/\S/));
    // Trigger + open menu both show the failure, so the menu really opened.
    expect(screen.getAllByText('Failed to load projects').length).toBe(2);
    expect(document.body.textContent).not.toContain('[object Object]');
  });
});
