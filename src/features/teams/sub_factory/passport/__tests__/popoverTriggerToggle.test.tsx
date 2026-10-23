import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import { WarningBadge } from '../WarningBadge';
import { RowInfoLabel } from '../passportWidgets';

/**
 * Pressing an open popover's own trigger closes it.
 *
 * Both popovers are portalled away from their trigger and dismissed by a
 * hand-rolled document `mousedown` listener that only knew the PANEL. A press
 * on the trigger was therefore "outside": mousedown closed the panel and the
 * click that followed toggled it straight back open, so the trigger could
 * never close what it opened (anchored-popover.md P3, Gap 3). Both now use
 * `useClickOutside([trigger, panel], ...)`.
 */
function press(el: HTMLElement) {
  fireEvent.mouseDown(el);
  fireEvent.mouseUp(el);
  fireEvent.click(el);
}

async function settle() {
  // The old listeners attached on a 0 ms timer; let it run.
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

describe('portalled popover triggers', () => {
  it('WarningBadge: a second press on the badge closes the list', async () => {
    render(
      <WarningBadge
        projectName="Alpha"
        items={[{ groupId: 'g', kpiId: 'k', name: 'Latency', current: 9, target: 5, unit: 'ms' }]}
      />,
    );
    const trigger = screen.getByRole('button', { name: /off-track/ });
    press(trigger);
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeNull();

    press(trigger);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('RowInfoLabel: a second press on the label closes its meaning popup', async () => {
    render(<RowInfoLabel label="Tests" info="How much of the code a test exercises." />);
    const trigger = screen.getByRole('button');
    press(trigger);
    await settle();
    expect(screen.queryByRole('dialog')).not.toBeNull();

    press(trigger);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a press outside both trigger and panel still closes', async () => {
    render(<RowInfoLabel label="Tests" info="meaning" />);
    press(screen.getByRole('button'));
    await settle();
    fireEvent.mouseDown(document.body);
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
