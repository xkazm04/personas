import { describe, it, expect, beforeEach } from 'vitest';

import {
  computeContentHashSync,
  registerBuiltinTemplates,
  registerBuiltinContentHash,
  resetBuiltinTemplateRegistry,
  verifyTemplate,
} from '../templateVerification';

const PAYLOAD = JSON.stringify({
  summary: 'Morning digest of the overnight inbox',
  suggested_tools: [{ name: 'gmail_search' }],
});
const TAMPERED = PAYLOAD.replace('Morning', 'Mornxng');

describe('verifyTemplate integrity', () => {
  beforeEach(() => {
    resetBuiltinTemplateRegistry();
    registerBuiltinTemplates(['email-digest']);
  });

  it('keeps a built-in Verified when its payload hashes to the seeded digest', () => {
    registerBuiltinContentHash('email-digest', computeContentHashSync(PAYLOAD));

    const v = verifyTemplate({ testCaseId: 'email-digest', designResultJson: PAYLOAD });

    expect(v.origin).toBe('builtin');
    expect(v.integrityValid).toBe(true);
    expect(v.trustLevel).toBe('verified');
  });

  it('refuses Verified for the same built-in id over a mutated payload', () => {
    registerBuiltinContentHash('email-digest', computeContentHashSync(PAYLOAD));

    const v = verifyTemplate({ testCaseId: 'email-digest', designResultJson: TAMPERED });

    expect(v.origin).toBe('builtin');
    expect(v.integrityValid).toBe(false);
    expect(v.trustLevel).toBe('untrusted');
    // An untrusted template is the most restricted sandbox, not an open one.
    expect(v.sandboxPolicy?.requireApproval).toBe(true);
  });

  it('refuses Verified for a fingerprinted built-in with no payload at all', () => {
    registerBuiltinContentHash('email-digest', computeContentHashSync(PAYLOAD));

    const v = verifyTemplate({ testCaseId: 'email-digest', designResultJson: null });

    expect(v.contentHash).toBeNull();
    expect(v.trustLevel).toBe('untrusted');
  });

  it('does not accuse a built-in the seeder has not fingerprinted yet', () => {
    // The gallery can paint before seeding completes, and a language switch
    // re-seeds; missing evidence is not evidence of tampering.
    const v = verifyTemplate({ testCaseId: 'email-digest', designResultJson: PAYLOAD });

    expect(v.integrityValid).toBe(true);
    expect(v.trustLevel).toBe('verified');
  });

  it('leaves unknown-origin templates sandboxed/untrusted as before', () => {
    const v = verifyTemplate({ testCaseId: 'someone-elses', designResultJson: PAYLOAD });
    expect(v.origin).toBe('unknown');
    expect(v.integrityValid).toBe(false);
    expect(v.trustLevel).toBe('untrusted');
  });
});
