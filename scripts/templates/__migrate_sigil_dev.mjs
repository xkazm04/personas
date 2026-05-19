// One-shot migration script for the 14 development templates (sigil-driven adoption).
// Usage: node scripts/templates/__migrate_sigil_dev.mjs
// Idempotent: re-running yields the same output.
// Spec: docs/development/template-sigil-migration.md

import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname).replace(/^\//, ''), '../..');
const baseDir = path.join(repoRoot, 'scripts', 'templates', 'development');
const seedsPath = path.join(repoRoot, 'scripts', 'templates', '_recipe_seeds.json');

const seedsJson = JSON.parse(fs.readFileSync(seedsPath, 'utf8'));
const findArr = (obj) => {
  if (Array.isArray(obj)) {
    if (obj.length && obj[0] && typeof obj[0] === 'object' && 'source_template_id' in obj[0]) return obj;
    for (const v of obj) { const r = findArr(v); if (r) return r; }
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) { const r = findArr(v); if (r) return r; }
  }
  return null;
};
const rows = findArr(seedsJson);
const recipeMap = {};
for (const r of rows) {
  let pt = {};
  try { pt = JSON.parse(r.prompt_template); } catch {}
  recipeMap[r.id] = {
    uc_id: r.source_use_case_id,
    template_id: r.source_template_id,
    connectors: pt.connectors || [],
    tool_hints: pt.tool_hints || [],
  };
}

const myTemplates = [
  'build-intelligence-use-case',
  'codebase-health-scanner',
  'design-handoff-coordinator',
  'dev-clone',
  'dev-lifecycle-manager',
  'documentation-freshness-guardian',
  'feature-flag-experiment-analyst',
  'feature-flag-governance-use-case',
  'lean-codebase-sentinel',
  'qa-guardian',
  'real-time-database-watcher',
  'self-evolving-codebase-memory',
  'skill-librarian',
  'user-lifecycle-manager',
];

const CANONICAL = new Set(['trigger','task','connector','message','review','memory','event','error']);

// Routing table from the spec.
function normalizeDimension(q) {
  const dim = q.dimension;
  const cat = q.category;
  // If already canonical, keep it.
  if (dim && CANONICAL.has(dim)) return dim;
  // Legacy direct mappings
  if (dim === 'connectors') return 'connector';
  if (dim === 'messages') return 'message';
  if (dim === 'use-cases') return 'task';
  if (dim === 'voice') return 'task';
  if (dim === 'events') return 'event';
  if (dim === 'error-handling') return 'error';
  if (dim === 'human-review') return 'review';
  // legacy: triggers / scheduling -> trigger
  if (dim === 'triggers' || dim === 'scheduling') return 'trigger';
  // legacy: parameters -> task (these are user-input config knobs)
  if (dim === 'parameters') return 'task';
  // Absent dim: fall back to category
  if (cat === 'credentials') return 'connector';
  if (cat === 'notifications') return 'message';
  if (cat === 'memory') return 'memory';
  if (cat === 'quality') return 'memory';
  if (cat === 'human_in_the_loop') return 'review';
  if (cat === 'boundaries') return 'error';
  if (cat === 'configuration' || cat === 'domain' || cat === 'intent' || cat === 'scheduling') return 'task';
  // Default
  return 'task';
}

// Content overrides — questions whose intent doesn't match the routing-table heuristic.
// Conservative: only override when the legacy `dimension` already encodes the intended
// canonical-ish meaning (e.g. existing `dimension: messages` for a configuration question).
// In practice the routing table from `dimension` covers these; this hook is for edge
// cases per spec §2.
function refineDimension(q, routed) {
  // Reference template shows: a `category: boundaries` question about *filtering scope*
  // (not actual errors) -> `task`. We follow legacy `dimension` first; otherwise stick
  // with routing.
  // Examples in our 14:
  //  - aq_never_do (boundaries, dim=use-cases) -> task by table. OK.
  //  - aq_internal_signup_celebrate (boundaries, dim=use-cases) -> task. OK (filter, not error).
  //  - aq_write_tests (boundaries, dim=use-cases) -> task. (Writing-tests is a capability scope, not an error policy.)
  //  - aq_deny_list_prefixes (boundaries, dim=use-cases) -> task. (Scope filter, not error handling.)
  return routed;
}

function chooseUseCaseIdForCapabilityQ(q, capabilityUcIds) {
  const ids = q.use_case_ids || [];
  if (ids.length === 0) return null;
  if (ids.length === 1) return ids[0];
  // Multi: same value works for all caps → pick first (the capability that owns the setup).
  // Splitting only if answer must differ per cap (rare).
  return ids[0];
}

function chooseUseCaseIdForPersonaQ(orderedUcIds) {
  return orderedUcIds[0] || null;
}

function chooseUseCaseIdForConnectorQ(q, useCaseEntries) {
  const names = q.connector_names || [];
  if (names.length === 0) return useCaseEntries[0]?.uc_id || null;
  // Special connector name mappings to seed-connector tokens.
  // The seed `connectors[]` uses tokens like "source_control", "messaging", "email",
  // "knowledge_base", "ticketing", "codebase", "supabase", etc. Some templates use
  // template-side connector names like ["github","gitlab"] (source_control family),
  // ["source_control","gitlab"] etc. Normalize.
  const synonyms = {
    'github': ['source_control', 'github'],
    'gitlab': ['source_control', 'gitlab'],
    'source_control': ['source_control', 'github', 'gitlab'],
    'messaging': ['messaging', 'slack'],
    'slack': ['messaging', 'slack'],
    'email': ['email'],
    'ticketing': ['ticketing'],
    'knowledge_base': ['knowledge_base'],
    'codebase': ['codebase'],
  };
  // Try each connector_name in order; for each, check capability seed connectors.
  for (const n of names) {
    const aliases = synonyms[n] || [n];
    for (const uc of useCaseEntries) {
      if (uc.connectors.some(c => aliases.includes(c))) return uc.uc_id;
    }
  }
  // Fall back: first capability.
  return useCaseEntries[0]?.uc_id || null;
}

let totalMigrated = 0;
let totalSplits = 0;
const anomalies = [];

for (const slug of myTemplates) {
  const file = path.join(baseDir, slug + '.json');
  const raw = fs.readFileSync(file, 'utf8');
  const tpl = JSON.parse(raw);

  const useCaseEntries = (tpl.payload.use_cases || [])
    .map((uc) => {
      const id = uc.recipe_ref ? uc.recipe_ref.id : null;
      return id ? recipeMap[id] : null;
    })
    .filter(Boolean);
  const orderedUcIds = useCaseEntries.map((u) => u.uc_id);

  const aqs = tpl.payload.adoption_questions || [];
  const newAqs = [];

  for (const q of aqs) {
    let useCaseId = null;
    let splitNeeded = false;
    if (q.scope === 'capability') {
      useCaseId = chooseUseCaseIdForCapabilityQ(q, orderedUcIds);
      if ((q.use_case_ids || []).length > 3) {
        anomalies.push(`${slug} / ${q.id}: use_case_ids has ${q.use_case_ids.length} entries (>3) — split clutter risk`);
      }
    } else if (q.scope === 'persona') {
      useCaseId = chooseUseCaseIdForPersonaQ(orderedUcIds);
    } else if (q.scope === 'connector') {
      useCaseId = chooseUseCaseIdForConnectorQ(q, useCaseEntries);
    } else {
      anomalies.push(`${slug} / ${q.id}: unknown scope "${q.scope}"`);
      useCaseId = orderedUcIds[0] || null;
    }

    const routed = normalizeDimension(q);
    const finalDim = refineDimension(q, routed);

    // Rebuild the question preserving the original key order but injecting
    // use_case_id right after use_case_ids/scope (matching reference templates).
    const out = {};
    let injected = false;
    const injectAfter = q.use_case_ids ? 'use_case_ids' : (q.connector_names ? 'connector_names' : 'scope');
    for (const [k, v] of Object.entries(q)) {
      if (k === 'use_case_id') continue; // we'll write our own
      if (k === 'dimension') {
        out.dimension = finalDim;
        continue;
      }
      out[k] = v;
      if (!injected && k === injectAfter && useCaseId) {
        out.use_case_id = useCaseId;
        injected = true;
      }
    }
    if (!injected && useCaseId) {
      // Fallback: ensure use_case_id ends up somewhere sensible.
      out.use_case_id = useCaseId;
    }
    if (!('dimension' in out)) {
      out.dimension = finalDim;
    }
    newAqs.push(out);
    if (splitNeeded) totalSplits++;
  }

  // Check for capabilities with zero adoption questions
  const ucsWithQs = new Set(newAqs.map((q) => q.use_case_id).filter(Boolean));
  for (const uc of orderedUcIds) {
    if (!ucsWithQs.has(uc)) {
      anomalies.push(`${slug}: capability ${uc} has zero adoption questions (fully preset)`);
    }
  }

  tpl.payload.adoption_questions = newAqs;
  const serialized = JSON.stringify(tpl, null, 2) + '\n';
  fs.writeFileSync(file, serialized);
  totalMigrated++;
}

console.log('migrated:', totalMigrated);
console.log('splits:', totalSplits);
console.log('anomalies:');
for (const a of anomalies) console.log('  -', a);
