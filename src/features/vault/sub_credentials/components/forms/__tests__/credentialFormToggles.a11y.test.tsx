import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ConnectorAuthMethod } from '@/lib/types/types';
import { AuthMethodTabs } from '../AuthMethodTabs';
import { SetupGuideSection } from '../SetupGuideSection';
import { HealthcheckResultDisplay } from '../HealthcheckResultDisplay';
import { ConnectionTestSection } from '../ConnectionTestSection';

// Three toggles in the credential form changed state only visually (a border,
// a chevron), and the connection-test hint opened on mouse hover only.

describe('credential form toggles announce their state', () => {
  it('auth method tabs mark the active method pressed', () => {
    const methods: ConnectorAuthMethod[] = [
      { id: 'api', label: 'API key', type: 'credential' },
      { id: 'mcp', label: 'MCP', type: 'mcp' },
    ];
    render(<AuthMethodTabs authMethods={methods} activeAuthMethodId="mcp" onMethodChange={() => {}} />);
    expect(screen.getByRole('button', { name: /API key/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: /MCP/ }).getAttribute('aria-pressed')).toBe('true');
  });

  it('the setup guide disclosure reports expanded', () => {
    render(<SetupGuideSection guide={'1. Open settings\n2. Copy key'} connectorLabel="Acme" />);
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('the technical-details disclosure of a failed probe reports expanded', () => {
    render(<HealthcheckResultDisplay success={false} state="failed" message="HTTP 401 Unauthorized: invalid_api_key" />);
    const btn = screen.getAllByRole('button').find((b) => b.hasAttribute('aria-expanded'));
    expect(btn).toBeDefined();
    expect(btn!.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn!);
    expect(btn!.getAttribute('aria-expanded')).toBe('true');
  });

  it('the connection-test hint has a name and opens on keyboard focus', async () => {
    render(<ConnectionTestSection onTest={() => {}} testHint="Calls GET /me with your key" />);
    const info = screen.getByRole('button', { name: 'Calls GET /me with your key' });
    fireEvent.focus(info);
    expect(await screen.findByRole('tooltip')).toBeTruthy();
  });
});
