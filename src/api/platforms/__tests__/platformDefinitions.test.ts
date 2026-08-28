import { describe, it, expect } from 'vitest';
import { parsePlatformDefinition } from '../platformDefinitions';
import { extractProtocolsFromNodes } from '@/lib/personas/platformDefinitions';

/**
 * `get_platform_definition` returns the RUST `PlatformDefinition`, whose
 * `ProtocolMapRule` (src-tauri/core/src/models/platform_definition.rs, built by
 * `pm()` in src-tauri/engine/src/platform_rules.rs) has only
 * platform_pattern / target_protocol / condition. The TS interface it used to be
 * cast to requires `nodePatterns: string[]`, so the cast was a lie and any
 * reader would have thrown. These fixtures are the real backend shape.
 */
const RUST_SHAPED_RESPONSE = {
  id: 'n8n',
  label: 'n8n',
  format: 'json',
  isBuiltin: true,
  nodeTypeMap: [{ sourcePattern: 'slack', targetService: 'slack' }],
  credentialConsolidation: [
    { sourcePatterns: ['slackApi'], targetConnector: 'slack', description: 'Slack' },
  ],
  nodeRoleClassification: [{ pattern: 'trigger', role: 'trigger' }],
  excludedCredentialTypes: ['httpBasicAuth'],
  protocolMapRules: [
    // No `nodePatterns` — exactly what Rust emits.
    {
      platformPattern: 'Slack/Telegram/Email nodes',
      targetProtocol: 'user_message',
      condition: 'notification node present',
    },
  ],
};

describe('parsePlatformDefinition', () => {
  it('fills the TS-only nodePatterns field the Rust struct does not carry', () => {
    const def = parsePlatformDefinition(RUST_SHAPED_RESPONSE, 'n8n');
    expect(def.protocolMapRules).toHaveLength(1);
    expect(def.protocolMapRules[0].nodePatterns).toEqual([]);
    expect(def.protocolMapRules[0].targetProtocol).toBe('user_message');
  });

  it('produces a definition the consumers can read without throwing', () => {
    const def = parsePlatformDefinition(RUST_SHAPED_RESPONSE, 'n8n');
    expect(() => extractProtocolsFromNodes(def, ['n8n-nodes-base.slack'])).not.toThrow();
  });

  it('defaults absent collections rather than leaving them undefined', () => {
    const def = parsePlatformDefinition({ id: 'x', label: 'X', format: 'yaml' }, 'x');
    expect(def.nodeTypeMap).toEqual([]);
    expect(def.credentialConsolidation).toEqual([]);
    expect(def.nodeRoleClassification).toEqual([]);
    expect(def.excludedCredentialTypes).toEqual([]);
    expect(def.protocolMapRules).toEqual([]);
    expect(def.isBuiltin).toBe(false);
  });

  it('fails at the boundary, naming the field, instead of deep in the pipeline', () => {
    expect(() => parsePlatformDefinition(null, 'n8n')).toThrow(/non-object payload/);
    expect(() => parsePlatformDefinition([], 'n8n')).toThrow(/non-object payload/);
    expect(() => parsePlatformDefinition({ id: 'n8n', label: 'n8n' }, 'n8n')).toThrow(/"format"/);
  });

  it('drops non-string entries from string arrays instead of trusting them', () => {
    const def = parsePlatformDefinition(
      { id: 'x', label: 'X', format: 'json', excludedCredentialTypes: ['a', 3, null, 'b'] },
      'x',
    );
    expect(def.excludedCredentialTypes).toEqual(['a', 'b']);
  });
});
