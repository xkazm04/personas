import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCustomHealthcheck } from '../schemaFormTypes';

/**
 * The custom-connection probe config is stored on the connector DEFINITION
 * (plaintext, returned on every definition fetch) and is sent whole to the
 * healthcheck-design prompt. No credential value may appear in it: each one
 * must stay a placeholder the backend resolves from the sealed credential.
 */
const SECRETS = {
  base_url: 'https://api.example.com',
  username: 'ops@example.com',
  password: 'hunter2-ž',
  api_key: 'sk-live-123',
  bearer_token: 'eyJ.secret',
  header_1_name: 'X-One',
  header_1_value: 'one-secret',
  header_2_name: 'X-Two',
  header_2_value: 'two-secret',
};

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

describe('buildCustomHealthcheck keeps credential values out of the config', () => {
  it.each(['api-key', 'bearer', 'basic', 'custom-headers'])('%s carries no secret', (template) => {
    const config = buildCustomHealthcheck(template, SECRETS);
    expect(config).not.toBeNull();
    const serialized = JSON.stringify(config);
    for (const key of ['password', 'api_key', 'bearer_token', 'header_1_value', 'header_2_value'] as const) {
      expect(serialized).not.toContain(SECRETS[key]);
    }
    expect(serialized).not.toContain(b64(`${SECRETS.username}:${SECRETS.password}`));
  });

  it('basic auth uses the backend base64 token over the two declared fields', () => {
    const config = buildCustomHealthcheck('basic', SECRETS);
    expect(config?.headers.Authorization).toBe('Basic {{base64(username:password)}}');
  });

  it('the backend resolver still understands the base64 token', () => {
    const rust = readFileSync(join(process.cwd(), 'src-tauri/src/engine/healthcheck.rs'), 'utf8');
    expect(rust).toContain('strip_prefix("base64(")');
  });
});
