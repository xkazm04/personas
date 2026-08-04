import { describe, it, expect } from 'vitest';
import { parseWorkflowFile } from '../workflowParser';
import {
  detectWorkflowPlatform,
  countElements,
  isSupportedFile,
  detectPlatformLabel,
} from '../workflowDetector';

const n8nExport = {
  name: 'Lead intake',
  nodes: [
    { type: 'n8n-nodes-base.gmailTrigger', name: 'On new email', parameters: { pollTimes: {} } },
    { type: 'n8n-nodes-base.slack', name: 'Post to channel', parameters: {} },
  ],
  connections: {},
};

const zapierExport = {
  title: 'New row to Slack',
  steps: [
    { app: 'google-sheets', action: 'new_row', type: 'trigger', label: 'New spreadsheet row' },
    { app: 'slack', action: 'send_channel_message', label: 'Send message' },
  ],
};

const makeExport = {
  name: 'Drive to Sheets',
  blueprint: {
    name: 'Drive to Sheets',
    flow: [
      { module: 'google-drive:watchFiles', label: 'Watch files' },
      { module: 'google-sheets:addRow', label: 'Add row' },
    ],
  },
};

describe('detectWorkflowPlatform', () => {
  it('identifies each supported platform with high confidence', () => {
    expect(detectWorkflowPlatform(n8nExport, '.json')).toMatchObject({ platform: 'n8n', confidence: 'high' });
    expect(detectWorkflowPlatform(zapierExport, '.json')).toMatchObject({ platform: 'zapier', confidence: 'high' });
    expect(detectWorkflowPlatform(makeExport, '.json')).toMatchObject({ platform: 'make', confidence: 'high' });
    expect(
      detectWorkflowPlatform({ on: 'push', jobs: { build: { 'runs-on': 'ubuntu-latest' } } }, '.yml'),
    ).toMatchObject({ platform: 'github-actions', confidence: 'high' });
  });

  it('reports unknown for a shape it does not recognize', () => {
    expect(detectWorkflowPlatform({ hello: 'world' }, '.json')).toMatchObject({
      platform: 'unknown',
      confidence: 'low',
    });
  });
});

describe('detector helpers', () => {
  it('counts the element collection each platform uses', () => {
    expect(countElements(n8nExport)).toEqual({ count: 2, label: 'node' });
    expect(countElements(zapierExport)).toEqual({ count: 2, label: 'step' });
    expect(countElements(makeExport)).toEqual({ count: 2, label: 'module' });
    expect(countElements({})).toEqual({ count: 0, label: 'element' });
  });

  it('accepts only json/yml/yaml files', () => {
    expect(isSupportedFile('flow.JSON')).toBe(true);
    expect(isSupportedFile('ci.yaml')).toBe(true);
    expect(isSupportedFile('notes.txt')).toBe(false);
  });

  it('falls back to a generic label for unrecognized content', () => {
    expect(detectPlatformLabel(n8nExport)).toBe('n8n');
    expect(detectPlatformLabel({ hello: 'world' })).toBe('Workflow');
  });
});

describe('parseWorkflowFile', () => {
  it('routes an n8n export and names it from the file', () => {
    const parsed = parseWorkflowFile(JSON.stringify(n8nExport), 'lead-intake.json');
    expect(parsed.detection.platform).toBe('n8n');
    expect(parsed.needsConfirmation).toBe(false);
    expect(parsed.workflowName).toBe('Lead intake');
    expect(parsed.result.suggested_connectors!.map((c) => c.name).sort()).toEqual(['gmail', 'slack']);
  });

  it('parses YAML GitHub Actions files', () => {
    const yamlSource = [
      'name: CI',
      'on:',
      '  schedule:',
      "    - cron: '0 4 * * *'",
      'jobs:',
      '  build:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '',
    ].join('\n');
    const parsed = parseWorkflowFile(yamlSource, 'ci.yml');
    expect(parsed.detection.platform).toBe('github-actions');
    expect(parsed.result.suggested_triggers![0]!.description).toBe('Scheduled: 0 4 * * *');
  });

  it('flags an unrecognized shape for confirmation instead of failing', () => {
    // Nodes with custom types and no `connections` map fail every detection
    // rule, but the n8n parser still understands the shape.
    const parsed = parseWorkflowFile(
      JSON.stringify({ nodes: [{ type: 'acme.customStep', name: 'Do the thing' }] }),
      'mystery.json',
    );
    expect(parsed.needsConfirmation).toBe(true);
    expect(parsed.detection.platform).toBe('n8n');
    expect(parsed.detection.confidence).toBe('medium');
  });

  it('rejects empty, malformed and unparseable input', () => {
    expect(() => parseWorkflowFile('   ', 'empty.json')).toThrow(/File is empty/);
    expect(() => parseWorkflowFile('{ not json', 'bad.json')).toThrow(/Invalid JSON/);
    expect(() => parseWorkflowFile('a: [1,', 'bad.yml')).toThrow(/Invalid YAML/);
    expect(() => parseWorkflowFile(JSON.stringify({ hello: 'world' }), 'nope.json')).toThrow(
      /Could not identify the workflow platform/,
    );
  });

  it('normalizes YAML to JSON in rawJson so storage is format-agnostic', () => {
    const parsed = parseWorkflowFile('name: CI\njobs:\n  build:\n    runs-on: ubuntu-latest\n', 'ci.yml');
    expect(JSON.parse(parsed.rawJson)).toEqual({ name: 'CI', jobs: { build: { 'runs-on': 'ubuntu-latest' } } });
  });
});
