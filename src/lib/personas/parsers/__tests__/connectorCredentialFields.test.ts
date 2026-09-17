/**
 * An import must hand the vault a field list, not a bare connector name.
 *
 * The shared pipeline emitted `credential_fields: []` for every suggested
 * connector on every platform, so the n8n wizard's connectors-missing gate
 * could name a connector and nothing else.
 */
import { describe, it, expect } from 'vitest';
import { runExtractionPipeline, type NormalizedNode } from '../workflowPipeline';
import { credentialFieldsForService, IMPORTABLE_FIELD_TYPES } from '../connectorCredentialFields';
import { BUILTIN_CONNECTORS } from '@/lib/credentials/builtinConnectors';

const node = (label: string, service: string): NormalizedNode => ({
  label,
  service,
  isTrigger: false,
  rawType: service,
});

const run = (nodes: NormalizedNode[]) =>
  runExtractionPipeline({
    platformLabel: 'n8n',
    platformNoun: 'workflow',
    elementNoun: 'nodes',
    workflowName: 'Import fixture',
    nodes,
  });

describe('credentialFieldsForService', () => {
  it('returns the vault catalog fields for a known service', () => {
    const fields = credentialFieldsForService('slack');
    expect(fields.map((f) => f.key)).toContain('bot_token');
    expect(fields.find((f) => f.key === 'bot_token')?.type).toBe('password');
  });

  it('returns the catalog fields verbatim, not a private copy of them', () => {
    // A second hand-written table here would drift from the catalog the vault
    // builds its own forms from; this asserts there is only one.
    const catalog = BUILTIN_CONNECTORS.find((c) => c.name === 'airtable')!;
    expect(credentialFieldsForService('airtable').map((f) => f.key)).toEqual(
      catalog.fields.filter((f) => IMPORTABLE_FIELD_TYPES.has(f.type as never)).map((f) => f.key),
    );
  });

  it('never invents a field for an unknown service', () => {
    expect(credentialFieldsForService('acme-widget')).toEqual([]);
  });

  it('only ever emits a control kind an offline import can render', () => {
    // Notably this drops `select`, whose option list needs live data (a twin
    // id, a workspace) that an import has no way to resolve.
    for (const def of BUILTIN_CONNECTORS) {
      for (const field of credentialFieldsForService(def.name)) {
        expect(IMPORTABLE_FIELD_TYPES.has(field.type), `${def.name}.${field.key}`).toBe(true);
      }
    }
  });
});

describe('runExtractionPipeline credential_fields', () => {
  it('carries at least one field for each of four known services', () => {
    const result = run([
      node('Post Message', 'slack'),
      node('Open Issue', 'github'),
      node('Create Page', 'notion'),
      node('Append Row', 'airtable'),
    ]);
    for (const name of ['slack', 'github', 'notion', 'airtable']) {
      const connector = result.suggested_connectors!.find((c) => c.name === name)!;
      expect(connector, name).toBeDefined();
      expect(connector.credential_fields!.length, name).toBeGreaterThan(0);
    }
  });

  it('leaves an unknown node type with no fields rather than a guess', () => {
    const result = run([node('Do Thing', 'acme-widget')]);
    const connector = result.suggested_connectors!.find((c) => c.name === 'acme-widget')!;
    expect(connector.credential_fields).toEqual([]);
  });

  it('is the shared pipeline, so Zapier / Make / GHA adapters inherit it', () => {
    // Same call the other three platform adapters make - the only difference
    // is the label, so a fix here cannot reach one platform and miss three.
    const result = runExtractionPipeline({
      platformLabel: 'Zapier',
      platformNoun: 'zap',
      elementNoun: 'steps',
      workflowName: 'Zap fixture',
      nodes: [node('Post Message', 'slack')],
    });
    expect(
      result.suggested_connectors!.find((c) => c.name === 'slack')!.credential_fields!.length,
    ).toBeGreaterThan(0);
  });
});
