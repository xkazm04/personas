/**
 * The three things a first webhook needs before it can be pasted into GitHub.
 *
 * `buildTriggerConfig` mints the HMAC secret at submit when the field is blank,
 * and every surface after this sheet shows only its last four characters — so
 * if the sheet does not render the plaintext, the sample that uses it, and the
 * fact that the default base URL is a loopback address nothing outside this
 * machine can POST to, the secret is effectively lost at the moment it is made.
 *
 * `IS_WEBHOOK_LOCALHOST` is a module constant computed from
 * `VITE_WEBHOOK_BASE_URL` at import time, so both halves of the warning are
 * exercised by re-importing the module under a stubbed env rather than by
 * asserting only the default.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { WebhookCreatedSheet, buildSignedCurlSample } from '../WebhookCreatedSheet';

const SECRET = 'a'.repeat(64);
const TRIGGER_ID = 'trg-123';

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('buildSignedCurlSample', () => {
  it('signs the body with the secret under the header the receiver reads', () => {
    const sample = buildSignedCurlSample('https://hooks.example.com/webhook/trg-123', SECRET);
    // engine/webhook.rs accepts x-hub-signature-256 carrying `sha256=<hex>`.
    expect(sample).toContain('x-hub-signature-256: sha256=$SIG');
    expect(sample).toContain(`-hmac '${SECRET}'`);
    expect(sample).toContain('https://hooks.example.com/webhook/trg-123');
  });
});

describe('WebhookCreatedSheet', () => {
  it('shows the plaintext secret and the endpoint URL once', () => {
    render(<WebhookCreatedSheet triggerId={TRIGGER_ID} secret={SECRET} onClose={() => {}} />);

    expect(screen.getByTestId('webhook-created-secret').textContent).toBe(SECRET);
    expect(screen.getByTestId('webhook-created-url').textContent).toContain(`/webhook/${TRIGGER_ID}`);
    expect(screen.getByTestId('webhook-created-curl').textContent).toContain(SECRET);
  });

  it('warns that the default base URL is unreachable from outside', () => {
    render(<WebhookCreatedSheet triggerId={TRIGGER_ID} secret={SECRET} onClose={() => {}} />);
    expect(screen.getByTestId('webhook-created-localhost-warning')).toBeTruthy();
  });

  it('drops the warning when the base URL is a reachable host', async () => {
    vi.stubEnv('VITE_WEBHOOK_BASE_URL', 'https://hooks.example.com');
    vi.resetModules();
    const { WebhookCreatedSheet: Fresh } = await import('../WebhookCreatedSheet');

    render(<Fresh triggerId={TRIGGER_ID} secret={SECRET} onClose={() => {}} />);

    expect(screen.queryByTestId('webhook-created-localhost-warning')).toBeNull();
    expect(screen.getByTestId('webhook-created-url').textContent).toBe(
      `https://hooks.example.com/webhook/${TRIGGER_ID}`,
    );
  });
});
