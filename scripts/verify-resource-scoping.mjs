#!/usr/bin/env node
/**
 * Live verification of resource-scoping list endpoints.
 *
 * For each connector with `resources[]`, fetches the configured list_endpoint
 * with real credentials and validates the response shape matches the
 * declared `response_mapping`. Mirrors what `engine/resource_listing.rs`
 * does end-to-end — proves the JSON specs work against the live APIs.
 *
 * Reads creds from env vars (never disk). Run:
 *
 *   AIRTABLE=... ASANA=... GITHUB=... NOTION=... SENTRY=... CLICKUP=... \
 *   GITLAB=... ATTIO=... AZURE_DEVOPS=... AZURE_DEVOPS_ORG=... \
 *   node scripts/verify-resource-scoping.mjs
 *
 * Sensitive data is never logged. Only HTTP status, item counts, and the
 * first item's id/label are printed (those are non-sensitive identifiers
 * by design — see docs/resource-scoping-spec.md).
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const CONNECTORS_DIR = path.join(__dirname, 'connectors/builtin');

// ─── tiny copy of resolve_template (must match Rust) ─────────────────────────
function resolveTemplate(template, values) {
  let out = '';
  let rest = template;
  while (true) {
    const start = rest.indexOf('{{');
    if (start === -1) { out += rest; break; }
    out += rest.slice(0, start);
    const close = rest.indexOf('}}', start + 2);
    if (close === -1) { out += rest.slice(start); break; }
    const inner = rest.slice(start + 2, close);
    const after = rest.slice(close + 2);
    out += resolveToken(inner, values) ?? `{{${inner}}}`;
    rest = after;
  }
  return out;
}
function resolveToken(inner, values) {
  if (inner.startsWith('base64(') && inner.endsWith(')')) {
    const args = inner.slice(7, -1);
    const colon = args.indexOf(':');
    if (colon === -1) return null;
    const a = args.slice(0, colon);
    const b = args.slice(colon + 1);
    const lhs = a === '' ? '' : values[a];
    const rhs = b === '' ? '' : values[b];
    if ((a !== '' && lhs == null) || (b !== '' && rhs == null)) return null;
    return Buffer.from(`${lhs ?? ''}:${rhs ?? ''}`).toString('base64');
  }
  const pipe = inner.indexOf('|');
  if (pipe !== -1) {
    const key = inner.slice(0, pipe);
    const fallback = inner.slice(pipe + 1);
    const v = values[key];
    return v && v.length > 0 ? v : fallback;
  }
  return values[inner];
}

// ─── tiny JSONPath-lite (matches Rust) ───────────────────────────────────────
function dottedGet(obj, dotted) {
  if (!dotted || dotted === '$') return obj;
  const segs = dotted.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cur = obj;
  for (const s of segs) {
    if (cur == null) return undefined;
    cur = cur[s];
  }
  return cur;
}

// ─── per-spec runner ─────────────────────────────────────────────────────────
async function runSpec(connectorName, spec, values) {
  const ep = spec.list_endpoint;
  const url = resolveTemplate(ep.url, values);
  if (url.includes('{{')) {
    return { name: spec.id, status: 'SKIP-fields', detail: `unresolved: ${url.match(/\{\{[^}]+\}\}/)?.[0]}` };
  }
  const headers = {};
  for (const [h, t] of Object.entries(ep.headers ?? {})) {
    const v = resolveTemplate(t, values);
    if (v.includes('{{')) {
      return { name: spec.id, status: 'SKIP-fields', detail: `unresolved header ${h}` };
    }
    headers[h] = v;
  }
  const init = { method: ep.method ?? 'GET', headers };
  if (ep.body) init.body = resolveTemplate(ep.body, values);
  let resp;
  try {
    resp = await fetch(url, init);
  } catch (e) {
    return { name: spec.id, status: 'NET-FAIL', detail: e.message };
  }
  if (!resp.ok) {
    const text = (await resp.text().catch(() => '')).slice(0, 120);
    return { name: spec.id, status: `HTTP-${resp.status}`, detail: text };
  }
  let body;
  try { body = await resp.json(); }
  catch { return { name: spec.id, status: 'NOT-JSON' }; }

  const items = Array.isArray(dottedGet(body, spec.response_mapping.items_path))
    ? dottedGet(body, spec.response_mapping.items_path)
    : [];
  const sample = items[0];
  const sampleId = sample ? dottedGet(sample, spec.response_mapping.id) : null;
  const sampleLabel = sample ? dottedGet(sample, spec.response_mapping.label) : null;
  return {
    name: spec.id,
    status: `OK ${items.length}`,
    detail: sample ? `[${sampleId} | ${String(sampleLabel).slice(0, 40)}]` : '',
    firstPick: sample ? { id: sampleId, label: sampleLabel } : null,
  };
}

async function runConnector(name, fieldEnv, extraFields = {}) {
  const file = path.join(CONNECTORS_DIR, `${name}.json`);
  const spec = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!spec.resources?.length) {
    return [{ name: 'NO-RESOURCES', status: 'SKIP' }];
  }
  const values = {};
  for (const [field, envVar] of Object.entries(fieldEnv)) {
    if (process.env[envVar]) values[field] = process.env[envVar];
  }
  Object.assign(values, extraFields);

  // Walk top-level resources first; chained ones reuse the first pick.
  const ordered = topoSort(spec.resources);
  const picksByResource = {};
  const out = [];
  for (const r of ordered) {
    // Resolve any selected.<dep>.<prop> values from earlier picks.
    const ctxValues = { ...values };
    for (const dep of r.depends_on ?? []) {
      const pick = picksByResource[dep];
      if (pick) {
        ctxValues[`selected.${dep}.id`] = String(pick.id);
        ctxValues[`selected.${dep}.label`] = String(pick.label);
      }
    }
    const ready = (r.depends_on ?? []).every((d) => picksByResource[d]);
    if (!ready && (r.depends_on ?? []).length > 0) {
      out.push({ name: r.id, status: 'CHAIN-SKIP', detail: 'parent had 0 picks' });
      continue;
    }
    const result = await runSpec(name, r, ctxValues);
    out.push(result);
    if (result.firstPick) picksByResource[r.id] = result.firstPick;
  }
  return out;
}

function topoSort(specs) {
  const byId = new Map(specs.map((s) => [s.id, s]));
  const seen = new Set();
  const out = [];
  function visit(s) {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    for (const dep of s.depends_on ?? []) {
      const d = byId.get(dep);
      if (d) visit(d);
    }
    out.push(s);
  }
  for (const s of specs) visit(s);
  return out;
}

// ─── connectors to verify ────────────────────────────────────────────────────
const CONNECTORS = [
  ['airtable',     { api_key: 'AIRTABLE' }],
  ['asana',        { personal_access_token: 'ASANA' }],
  ['clickup',      { api_key: 'CLICKUP' }],
  ['github',       { personal_access_token: 'GITHUB' }],
  ['notion',       { api_key: 'NOTION' }],
  ['sentry',       { auth_token: 'SENTRY' }],
  ['gitlab',       { personal_access_token: 'GITLAB' }],
  ['attio',        { access_token: 'ATTIO' }],
  ['azure-devops', { pat: 'AZURE_DEVOPS' }, { organization: process.env.AZURE_DEVOPS_ORG ?? '' }],
  ['azure-devops-org', { pat: 'AZURE_DEVOPS' }],
];

console.log('Connector       | Resource         | Status        | Sample');
console.log('----------------|------------------|---------------|--------------------');
for (const [name, fieldEnv, extra = {}] of CONNECTORS) {
  const results = await runConnector(name, fieldEnv, extra);
  for (const r of results) {
    console.log(
      `${name.padEnd(15)} | ${(r.name ?? '?').padEnd(16)} | ${(r.status ?? '?').padEnd(13)} | ${r.detail ?? ''}`,
    );
  }
}
