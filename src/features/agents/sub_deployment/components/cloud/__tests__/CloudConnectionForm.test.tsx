import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CloudConnectionForm, type CloudConnectionFormProps } from '../CloudConnectionForm';

const noop = () => {};
const connected = (url: string): CloudConnectionFormProps => ({
  isConnected: true,
  config: { url, is_connected: true },
  url: '',
  setUrl: noop,
  apiKey: '',
  setApiKey: noop,
  isConnecting: false,
  onConnect: noop,
  onDisconnect: noop,
  diagnostics: null,
  isDiagnosing: false,
  onDiagnose: noop,
});

describe('CloudConnectionForm connected state', () => {
  // The backend stores the validated URL with its scheme
  // (cloud_connect -> store_cloud_config(normalized)), so the card must print
  // it as-is: a hardcoded "https://" in front doubled the scheme and claimed
  // TLS for a plain-http localhost orchestrator.
  it('prints the stored orchestrator URL once, with its own scheme', () => {
    render(<CloudConnectionForm {...connected('https://orch.example.com')} />);
    const line = screen.getByText((_, el) => el?.tagName === 'P' && !!el.textContent?.includes('orch.example.com'));
    expect(line.textContent?.trim()).toBe('https://orch.example.com');
  });

  it('never claims https for a plain-http localhost orchestrator', () => {
    render(<CloudConnectionForm {...connected('http://localhost:8080')} />);
    const line = screen.getByText((_, el) => el?.tagName === 'P' && !!el.textContent?.includes('localhost:8080'));
    expect(line.textContent).not.toContain('https://');
  });
});
