// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { maskSensitiveJson, sanitizeErrorMessage } from '../maskSensitive';

const GH_TOKEN = 'ghp_' + 'a'.repeat(36);

describe('sanitizeErrorMessage', () => {
  it('redacts bare IPs, tokens and emails', () => {
    expect(sanitizeErrorMessage(`bare 10.0.0.5 and ${GH_TOKEN} and jane@corp.com`)).toBe(
      'bare [ip] and [secret] and [email]',
    );
  });

  it('keeps a public URL readable and drops its query', () => {
    expect(sanitizeErrorMessage('Failed to reach https://api.example.com/v1/run?key=abc')).toBe(
      'Failed to reach https://api.example.com/v1/run',
    );
  });

  // The URL shield used to hide everything inside a URL from every pass, so a
  // private address, an internal host, or a token/email in a path segment went
  // out verbatim - to Sentry (via scrubPii) and to the crash log.
  it('redacts a private IP in a URL authority', () => {
    const out = sanitizeErrorMessage('Failed to reach https://10.0.0.5:8080/v1/run');
    expect(out).not.toContain('10.0.0.5');
    expect(out).toBe('Failed to reach https://[ip]/v1/run');
  });

  it('redacts an internal hostname in a URL authority', () => {
    expect(sanitizeErrorMessage('Failed to reach https://db.internal/v1/run')).not.toContain('db.internal');
  });

  it('redacts a token and an email in a URL path', () => {
    const tok = sanitizeErrorMessage(`GET https://api.github.com/repos/x/${GH_TOKEN}/y failed`);
    expect(tok).not.toContain(GH_TOKEN);
    expect(tok).toContain('https://api.github.com/repos/x/[secret]/y');
    const mail = sanitizeErrorMessage('GET https://api.example.com/users/jane.doe@corp.com/profile 404');
    expect(mail).not.toContain('jane.doe@corp.com');
  });
});

describe('maskSensitiveJson', () => {
  const masked = (obj: Record<string, unknown>) => JSON.parse(maskSensitiveJson(JSON.stringify(obj))!);

  it('masks the exact names it always did', () => {
    expect(masked({ password: 'p', api_key: 'k', apiKey: 'k', 'X-Api-Key': 'k', accessToken: 't' })).toEqual({
      password: '********', api_key: '********', apiKey: '********', 'X-Api-Key': '********', accessToken: '********',
    });
  });

  // An anchored whole-key match let every QUALIFIED secret name through,
  // which is how real payloads (env maps, connector configs) name them.
  it('masks qualified secret names in any case style', () => {
    expect(
      masked({ github_token: 'a', OPENAI_API_KEY: 'b', db_password: 'c', githubToken: 'd', stripeClientSecret: 'e' }),
    ).toEqual({
      github_token: '********', OPENAI_API_KEY: '********', db_password: '********', githubToken: '********', stripeClientSecret: '********',
    });
  });

  it('leaves look-alike non-secret keys visible', () => {
    const plain = { max_tokens: 10, token_count: 5, author: 'me', oauth_type: 'google', secretary: 'x' };
    expect(masked(plain)).toEqual(plain);
  });
});
