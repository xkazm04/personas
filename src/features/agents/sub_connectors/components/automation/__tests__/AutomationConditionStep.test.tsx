import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AutomationConditionStep } from '../AutomationConditionStep';
import { TIMEOUT_SECS_MAX, TIMEOUT_SECS_MIN } from '../../../libs/useAutomationSetup';

function renderStep() {
  return render(
    <AutomationConditionStep
      designResult={{}}
      name="x" setName={() => {}}
      platform="custom" githubRepo={null}
      hasPlatformCredential={false} platformCredentials={[]} platformCredentialId={null}
      showAdvanced={true} setShowAdvanced={() => {}}
      inputSchema="" setInputSchema={() => {}}
      fallbackMode="connector" setFallbackMode={() => {}}
      timeoutSecs={30} setTimeoutSecs={() => {}}
      deployError={null}
    />,
  );
}

describe('AutomationConditionStep credential line', () => {
  // The same rule AutomationTriggerStep's banner pins: a selection that does
  // not resolve renders an explicit absence, never the first credential, which
  // the deploy (credentialId: platformCredentialId) would not use.
  it('does not name the first offered credential when the selection does not resolve', () => {
    const creds = [{ id: 'cred-first', name: 'Workspace A' }, { id: 'cred-second', name: 'Workspace B' }] as never;
    render(
      <AutomationConditionStep
        designResult={{}}
        name="x" setName={() => {}}
        platform="n8n" githubRepo={null}
        hasPlatformCredential platformCredentials={creds} platformCredentialId="cred-gone"
        showAdvanced={false} setShowAdvanced={() => {}}
        inputSchema="" setInputSchema={() => {}}
        fallbackMode="connector" setFallbackMode={() => {}}
        timeoutSecs={30} setTimeoutSecs={() => {}}
        deployError={null}
      />,
    );
    expect(screen.queryByText('Workspace A')).toBeNull();
    expect(screen.getByText('None selected')).toBeTruthy();
  });
});

describe('AutomationConditionStep timeout stepper', () => {
  it('advertises the same bounds the deploy path clamps to', () => {
    renderStep();
    const stepper = screen.getByRole('spinbutton');
    // The stepper used to cap at 300 while clampTimeoutSecs / timeoutSecsInvalid
    // allowed 3600: two implementations of one bound.
    expect(Number(stepper.getAttribute('aria-valuemax'))).toBe(TIMEOUT_SECS_MAX);
    expect(Number(stepper.getAttribute('aria-valuemin'))).toBe(TIMEOUT_SECS_MIN);
  });

  it('still renders the advanced block that hosts the stepper', () => {
    renderStep();
    fireEvent.click(screen.getByText(/hide advanced/i));
  });
});
