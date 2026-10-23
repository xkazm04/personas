import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const handleReset = vi.fn(async () => {});
vi.mock('../libs/useByomSettings', () => ({
  useByomSettings: () => ({
    loaded: true,
    isDirty: false,
    isSaving: false,
    hasBlockingErrors: false,
    topLevelWarnings: [],
    corruptPolicyError: 'bad json',
    policy: { enabled: true, allowed_providers: [], blocked_providers: [], routing_rules: [], compliance_rules: [] },
    activeSection: 'keys',
    setActiveSection: vi.fn(),
    handleReset,
    handleSave: vi.fn(),
    discardChanges: vi.fn(),
    toggleEnabled: vi.fn(),
  }),
}));
vi.mock('../components/ByomApiKeyManager', () => ({ ByomApiKeyManager: () => null }));
vi.mock('@/hooks/utility/interaction/useUnsavedGuard', () => ({
  useUnsavedGuard: () => ({ isOpen: false, isSaving: false, saveError: null, resolve: vi.fn() }),
}));

import ByomSettings from '../components/ByomSettings';

describe('BYOM policy reset', () => {
  beforeEach(() => handleReset.mockClear());

  it('asks before deleting the policy, from both Reset buttons', async () => {
    render(<ByomSettings />);
    const openers = screen.getAllByRole('button', { name: /^reset/i });
    expect(openers.length).toBe(2);
    for (const btn of openers) {
      fireEvent.click(btn);
      expect(handleReset).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole('button', { name: /cancel/i }));
      expect(handleReset).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull());
    }
    fireEvent.click(openers[0]!);
    await screen.findByRole('button', { name: /cancel/i });
    const all = screen.getAllByRole('button', { name: /reset policy/i });
    fireEvent.click(all[all.length - 1]!);
    await waitFor(() => expect(handleReset).toHaveBeenCalledTimes(1));
  });
});
