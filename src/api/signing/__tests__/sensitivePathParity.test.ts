/**
 * The renderer denylist in signDocument is defense in depth: sign_document
 * enforces `is_sensitive_credential_path` on the resolved path (the PRIMARY gate).
 * This pins (1) the trust statement names the backend as primary, and (2) every
 * kind of path the renderer blocks has a counterpart in the backend source, so
 * the two lists cannot drift apart silently.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@/lib/tauriInvoke', () => ({ invokeWithTimeout: invoke }));

import { signDocument, SignDocumentRejectedError } from '../index';

const tsSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
const rustSource = readFileSync(
  resolve(__dirname, '../../../../src-tauri/engine/src/path_safety.rs'),
  'utf8',
);

// path the renderer blocks -> the literal the backend must carry for that class
const CORPUS: Array<[string, string]> = [
  ['/home/u/.ssh/config', '/.ssh/'],
  ['/home/u/.gnupg/pubring.kbx', '/.gnupg/'],
  ['/home/u/.aws/credentials', '/.aws/credentials'],
  ['/home/u/.config/gcloud/creds.json', '/.config/gcloud/'],
  ['/home/u/id_rsa', 'id_rsa'],
  ['/home/u/id_ed25519.pub', 'id_ed25519'],
  ['/home/u/id_ecdsa', 'id_ecdsa'],
  ['/home/u/id_dsa', 'id_dsa'],
  ['/x/cert.pem', '.pem'],
  ['/x/cert.p12', '.p12'],
  ['/x/cert.pfx', '.pfx'],
  ['/x/app.key', '.key'],
  ['/x/store.jks', '.jks'],
  ['/x/store.keystore', '.keystore'],
  ['/x/private_key', 'private_key'],
  ['/x/private-key', 'private-key'],
  ['/x/wallet.dat', 'wallet.dat'],
  ['/x/.npmrc', '.npmrc'],
  ['/x/.netrc', '.netrc'],
];

describe('signing sensitive-path guard', () => {
  it('names the backend as the primary gate, not the renderer', () => {
    expect(tsSource).not.toMatch(/NOT\s+verified/i);
    expect(tsSource).not.toMatch(/treat this guard as the PRIMARY gate/i);
    expect(tsSource).toMatch(/is_sensitive_credential_path/);
  });

  it.each(CORPUS)('renderer blocks %s and the backend carries %s', async (path, token) => {
    invoke.mockClear();
    await expect(signDocument(path)).rejects.toBeInstanceOf(SignDocumentRejectedError);
    expect(invoke).not.toHaveBeenCalled();
    expect(rustSource.toLowerCase()).toContain(token);
  });

  it('still lets an innocuous path through to the backend', async () => {
    invoke.mockClear().mockResolvedValue({});
    await signDocument('/docs/private_key_lecture_notes.md');
    expect(invoke).toHaveBeenCalledOnce();
  });
});
