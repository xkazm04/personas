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
});
