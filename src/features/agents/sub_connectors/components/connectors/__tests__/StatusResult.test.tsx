import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StatusResult } from '../ConnectorStatusBadges';
import type { ConnectorStatus, ConnectorTestResult } from '../../../libs/connectorTypes';

function status(result: ConnectorTestResult): ConnectorStatus {
  return { name: 'github', credentialId: 'cred-1', credentialName: 'GitHub PAT', testing: false, result, linkError: null };
}

// An unreachable probe (connect / DNS / timeout) carries success === false but
// no verdict on the credential. The panel must not paint it as a failure.
describe('StatusResult - unreachable probe', () => {
  it('renders the neutral could-not-reach panel, not the red failure panel', () => {
    const { container, getByTestId } = render(
      <StatusResult status={status({ success: false, state: 'unreachable', message: 'connect timeout' })} />,
    );
    expect(getByTestId('connector-result-unreachable').textContent).toContain('connect timeout');
    expect(container.querySelector('.text-red-400')).toBeNull();
  });

  it('an explicit failure still renders red', () => {
    const { container, queryByTestId } = render(
      <StatusResult status={status({ success: false, state: 'failed', message: 'HTTP 401' })} />,
    );
    expect(queryByTestId('connector-result-unreachable')).toBeNull();
    expect(container.querySelector('.text-red-400')).not.toBeNull();
  });
});
