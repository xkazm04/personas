import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { en } from '@/i18n/en';
import { BlastRadiusPanel } from '../BlastRadiusPanel';
import type { BlastRadius } from '../credentialGraph';

/**
 * The simulation switch is named by what it controls, from the catalog. It
 * used to be named "Enable simulation mode" / "Disable simulation mode" in
 * English in every locale, a name that also changed with its own state.
 */
const blast: BlastRadius = {
  credentialId: 'cred-1',
  credentialName: 'Stripe key',
  affectedAgents: [],
  affectedEvents: [],
  severity: 'low',
};

describe('BlastRadiusPanel simulation switch', () => {
  it('carries the catalog name and reports its state through aria-checked', () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <BlastRadiusPanel blast={blast} onClose={() => {}} simulationMode={false} onToggleSimulation={onToggle} />,
    );
    const name = en.vault.dependencies.simulate_revocation;
    const toggle = screen.getByRole('switch', { name });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <BlastRadiusPanel blast={blast} onClose={() => {}} simulationMode onToggleSimulation={onToggle} />,
    );
    expect(screen.getByRole('switch', { name }).getAttribute('aria-checked')).toBe('true');
  });
});
