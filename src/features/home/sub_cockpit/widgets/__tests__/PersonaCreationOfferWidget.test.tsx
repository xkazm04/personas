import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const setAthenaPrefill = vi.fn();
const setSidebarSection = vi.fn();
const startGuidance = vi.fn();

vi.mock('@/stores/systemStore', () => {
  const hook = () => undefined;
  (hook as unknown as { getState: () => unknown }).getState = () => ({
    setAthenaPrefill,
    setSidebarSection,
  });
  return { useSystemStore: hook };
});

vi.mock('@/features/companions/athena/athenaStore', () => {
  const hook = () => undefined;
  (hook as unknown as { getState: () => unknown }).getState = () => ({ startGuidance });
  return { useAthenaStore: hook };
});

import { PersonaCreationOfferWidget } from '../PersonaCreationOfferWidget';

/**
 * The prefill handoff is a write: it seeds the build entry and moves the user
 * to another section. Both halves have to happen, and the intent Athena
 * captured has to survive the trip - a route with an empty prefill silently
 * throws the whole conversation away.
 */
describe('PersonaCreationOfferWidget', () => {
  beforeEach(() => {
    cleanup();
    setAthenaPrefill.mockReset();
    setSidebarSection.mockReset();
    startGuidance.mockReset();
  });

  it('carries the intent into the prefill and routes to personas', () => {
    render(
      <PersonaCreationOfferWidget config={{ intent: '  triage inbound support tickets  ' }} />,
    );
    fireEvent.click(screen.getByTestId('companion-offer-build'));

    expect(setAthenaPrefill).toHaveBeenCalledTimes(1);
    expect(setAthenaPrefill.mock.calls[0][0]).toMatchObject({
      intent: 'triage inbound support tickets',
      autoLaunch: false,
      mode: 'interactive',
    });
    expect(setSidebarSection).toHaveBeenCalledWith('personas');
  });

  it('never auto-launches a build from a chat card', () => {
    render(<PersonaCreationOfferWidget config={{ intent: 'anything' }} />);
    fireEvent.click(screen.getByTestId('companion-offer-build'));
    expect(setAthenaPrefill.mock.calls[0][0]).toMatchObject({ autoLaunch: false });
  });

  it('starts the guided walkthrough instead, with no prefill or navigation', () => {
    render(<PersonaCreationOfferWidget config={{ intent: 'anything' }} />);
    fireEvent.click(screen.getByTestId('companion-offer-show'));

    expect(startGuidance).toHaveBeenCalledWith('persona_creation');
    expect(setAthenaPrefill).not.toHaveBeenCalled();
    expect(setSidebarSection).not.toHaveBeenCalled();
  });
});
