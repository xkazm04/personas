/**
 * Route-diff probe: every route the Build / Read / Execute scopes unlock in
 * the management router must appear in McpServerInfoPanel's endpoint list.
 * Reads the Rust router and the component source as text (no render needed).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../../../../..');
const panel = readFileSync(
  resolve(ROOT, 'src/features/settings/sub_api_keys/components/McpServerInfoPanel.tsx'),
  'utf8',
);

// [method, router path (as in management_api.rs), panel path (:param form)]
const SCOPED_ROUTES: Array<[string, string, string]> = [
  ['GET', '/api/personas', '/api/personas'],
  ['GET', '/api/personas/{persona_id}', '/api/personas/:id'],
  ['POST', '/api/execute/{persona_id}', '/api/execute/:id'],
  ['GET', '/api/executions', '/api/executions'],
  ['GET', '/api/executions/{id}', '/api/executions/:id'],
  ['GET', '/api/build/{session_id}/pending', '/api/build/:id/pending'],
  ['POST', '/api/build/{session_id}/cancel', '/api/build/:id/cancel'],
];

describe('MCP panel endpoint reference', () => {
  const router = readFileSync(resolve(ROOT, 'src-tauri/src/engine/management_api.rs'), 'utf8');

  it.each(SCOPED_ROUTES)('router really serves %s %s', (_m, routerPath) => {
    expect(router).toContain(`"${routerPath}"`);
  });

  it.each(SCOPED_ROUTES)('panel lists %s %s', (method, _r, panelPath) => {
    // Entries may be one-line or wrapped; normalise whitespace before matching.
    const flat = panel.replace(/\s+/g, ' ');
    const needle = `method: '${method}', path: '${panelPath}',`;
    expect(flat).toContain(needle);
  });
});
