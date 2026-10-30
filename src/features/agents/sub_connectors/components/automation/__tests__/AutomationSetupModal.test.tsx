import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const handleClose = vi.fn();
vi.mock('../../../libs/useAutomationSetup', () => ({
  useAutomationSetup: () => ({ phase: 'idle', editAutomation: null, handleClose, design: {} }),
}));
vi.mock('../AutomationTriggerStep', () => ({ AutomationTriggerStep: () => null }));

import { AutomationSetupModal } from '../AutomationSetupModal';

describe('AutomationSetupModal header', () => {
  // The header's X was an icon-only button with no accessible name.
  it('has a named close control that closes the modal', () => {
    const onClose = vi.fn();
    render(<AutomationSetupModal open personaId="p1" onClose={onClose} onComplete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(handleClose).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
