import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const labGetResultEvents = vi.fn();
vi.mock('@/api/agents/lab', () => ({
  labGetResultEvents: (...a: unknown[]) => labGetResultEvents(...a),
}));

import { LabEventStream } from '../LabEventStream';

describe('LabEventStream - an IPC rejection reads as a sentence, not [object Object]', () => {
  it('regression: a serialized AppError rejection is resolved before it renders', async () => {
    // invokeWithTimeout rejects with the backend's serialized AppError object, never an Error.
    labGetResultEvents.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    const { container } = render(<LabEventStream resultId="res-1" resultKind="arena" />);
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await waitFor(() => expect(labGetResultEvents).toHaveBeenCalled());
    const failure = await screen.findByText(/Failed to load events/, { selector: 'div' });
    expect(failure.textContent).not.toContain('[object Object]');
  });

  it('regression: a failed load is not retried in a loop', async () => {
    labGetResultEvents.mockReset();
    labGetResultEvents.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    const { container } = render(<LabEventStream resultId="res-2" resultKind="arena" />);
    const details = container.querySelector('details')!;
    details.open = true;
    fireEvent(details, new Event('toggle'));
    await screen.findByText(/Failed to load events/, { selector: 'div' });
    await new Promise((r) => setTimeout(r, 50));
    // jsdom may also dispatch its own toggle event, so allow the re-open retry
    // but require the count to hold still (a loop keeps climbing).
    const settled = labGetResultEvents.mock.calls.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(labGetResultEvents).toHaveBeenCalledTimes(settled);
    expect(settled).toBeLessThanOrEqual(2);
  });
});
