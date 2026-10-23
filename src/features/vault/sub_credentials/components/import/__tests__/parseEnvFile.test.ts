import { describe, it, expect } from 'vitest';
import { parseEnvFile, detectServiceFromKey } from '../importHelpers';

// Placeholder values only; nothing here is a real secret.
const ENV = [
  '# comment line',
  'export OPENAI_API_KEY=placeholder-one',
  'GITHUB_TOKEN=placeholder-two # personal token',
  'STRIPE_KEY="quoted # kept"',
  'PLAIN=value#nospace',
].join('\n');

describe('parseEnvFile reads the common .env forms', () => {
  const { secrets, errors } = parseEnvFile(ENV);
  const byKey = Object.fromEntries(secrets.map((s) => [s.key, s.value]));

  it('strips the `export ` prefix from the key', () => {
    expect(Object.keys(byKey)).toContain('OPENAI_API_KEY');
    expect(Object.keys(byKey).some((k) => k.startsWith('export'))).toBe(false);
    expect(detectServiceFromKey('OPENAI_API_KEY').connectorName).toBe('openai');
  });

  it('drops an inline ` #` comment from an unquoted value only', () => {
    expect(byKey.GITHUB_TOKEN).toBe('placeholder-two');
    expect(byKey.STRIPE_KEY).toBe('quoted # kept');
    expect(byKey.PLAIN).toBe('value#nospace');
  });

  it('reports no errors for these lines', () => {
    expect(errors).toEqual([]);
    expect(secrets).toHaveLength(4);
  });
});
