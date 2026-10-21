import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';

import { DeployPopover } from '../DeployPopover';

vi.mock('../ImproveContext', () => ({
  useImprove: () => ({ getRaw: () => ({ project: { name: 'Proj' } }) }),
}));
vi.mock('../ImproveClassicPanel', () => ({
  hasClassicContent: () => true,
  ImproveClassicPanel: () => <button type="button">inside</button>,
}));

const rect = { top: 100, bottom: 120, left: 50, right: 90, width: 40, height: 20, x: 50, y: 100, toJSON: () => ({}) } as DOMRect;

function Host() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>trigger</button>
      {open && <DeployPopover slug="p" rowKey="ci" anchor={rect} onClose={() => setOpen(false)} />}
    </>
  );
}

describe('anchored passport popovers (DeployPopover)', () => {
  it('moves focus into the dialog on open and back to the trigger on Escape', () => {
    render(<Host />);
    const trigger = screen.getByText('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
