import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Listbox } from '../Listbox';

const ITEMS = ['Alpha', 'Beta', 'Gamma'];

function Harness({ searchable = false }: { searchable?: boolean }) {
  return (
    <Listbox
      ariaLabel="Pick"
      itemCount={ITEMS.length}
      searchable={searchable}
      renderTrigger={({ toggle }) => <button type="button" onClick={toggle}>trigger</button>}
    >
      {({ focusIndex }) => ITEMS.map((n, i) => (
        <div key={n} role="option" aria-selected={i === focusIndex} data-n={n}>{n}</div>
      ))}
    </Listbox>
  );
}

describe('Listbox announces the arrow-key highlight', () => {
  it('points aria-activedescendant on the focused trigger at the highlighted option', () => {
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'trigger' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    const id = trigger.getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('Beta');
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.getElementById(trigger.getAttribute('aria-activedescendant')!)?.textContent).toBe('Alpha');
  });

  it('puts aria-activedescendant on the search input in searchable mode', async () => {
    render(<Harness searchable />);
    fireEvent.click(screen.getByRole('button', { name: 'trigger' }));
    const input = await screen.findByRole('textbox');
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const id = input.getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    expect(document.getElementById(id!)?.textContent).toBe('Alpha'); // type-ahead focuses the first match
  });
});
