// COMPOSITION layer — per-capability model + reasoning-effort tuning.
//
// The two knobs (engine/prompt/cli_args.rs):
//   --model  ← model_profile.model   (unset → CLI account default ≈ Sonnet)
//   --effort ← model_profile.effort  ("low"|"medium"|"high"; unset → "medium")
// Both live as JSON in personas.model_profile, set via update_persona
//   (input.model_profile: Option<Option<String>>; key is snake_case).
//
// We tune by ROLE (the SDLC roster is uniform across all 7 teams), inferring
// the role from the persona name ("T: Solution Architect" → architect, …).
//
// "baseline" writes "{}" (empty profile → default model, medium effort) rather
// than clearing the column to NULL: plain serde can't express the double-Option
// `Some(None)` clear from JS, and "{}" is functionally identical to NULL while
// giving us a deterministic, reversible apples-to-apples baseline.
//
// Usage:
//   node scripts/test/composition.mjs show "<team name|id>"
//   node scripts/test/composition.mjs apply <baseline|tuned> "<team name|id>"
import { openRead, MAIN_DB } from './db.mjs';
import { teamInfo } from './model.mjs';
import * as bridge from './bridge.mjs';

// Model ids (CLAUDE.md): Opus 4.7 'claude-opus-4-7', Sonnet 4.6
// 'claude-sonnet-4-6', Haiku 4.5 'claude-haiku-4-5-20251001'.
const HAIKU = 'claude-haiku-4-5-20251001';

// role → { model?, effort } ; omit model to use the account default (Sonnet).
export const COMPOSITIONS = {
  // Everyone on the account default model + medium effort. Reversible baseline.
  baseline: {
    architect: {},
    reviewer: {},
    security: {},
    release: {},
    docs: {},
  },
  // Cost-optimized hypothesis. The apprenticeship BASELINE was already
  // PRODUCTION (team 97) with every role at default+medium, and the
  // grounding-fix (commit d0daad4) showed the architect's "weak grounding"
  // was a measurement artifact, not a quality gap — so there is NO reason to
  // spend MORE on the reasoning roles. The optimization is the other
  // direction: hold the three reasoning/judgement roles at the default model +
  // medium (they must catch real bugs/vulns and own the design), and downshift
  // only the two mechanical roles (version bump / changelog / tag / README
  // sync) to Haiku + low effort. The test: does aggregate quality hold while
  // release+docs cost/time drop sharply?
  tuned: {
    architect: { effort: 'medium' },
    reviewer: { effort: 'medium' },
    security: { effort: 'medium' },
    release: { model: HAIKU, effort: 'low' },
    docs: { model: HAIKU, effort: 'low' },
  },
};

const ROLE_PATTERNS = [
  [/architect/i, 'architect'],
  [/review/i, 'reviewer'],
  [/security|sentinel/i, 'security'],
  [/release/i, 'release'],
  [/docs|steward|document/i, 'docs'],
];

export function roleOf(personaName) {
  for (const [re, role] of ROLE_PATTERNS) if (re.test(personaName)) return role;
  return null;
}

function profileJson(spec) {
  // Always include effort so behavior is explicit; include model only when set.
  const obj = {};
  if (spec.model) obj.model = spec.model;
  obj.effort = spec.effort || 'medium';
  return JSON.stringify(obj);
}

function readMembers(teamRef) {
  const db = openRead(MAIN_DB);
  const info = teamInfo(db, teamRef);
  const rows = info.personaIds.map((id) => {
    const r = db.prepare(`SELECT id, name, model_profile FROM personas WHERE id=?`).get(id);
    return r;
  });
  db.close();
  return { info, rows };
}

export function show(teamRef) {
  const { info, rows } = readMembers(teamRef);
  console.log(`Team: ${info.name} [${info.id.slice(0, 8)}] (${rows.length} members)`);
  for (const r of rows) {
    const role = roleOf(r.name) || '?';
    let prof = '(null→default)';
    if (r.model_profile) {
      try {
        const j = JSON.parse(r.model_profile);
        prof = `model=${j.model || 'default'} effort=${j.effort || 'medium'}`;
      } catch {
        prof = '(unparseable)';
      }
    }
    console.log(`  ${String(role).padEnd(10)} ${r.name.padEnd(26)} ${prof}`);
  }
}

export async function apply(compName, teamRef) {
  const comp = COMPOSITIONS[compName];
  if (!comp) throw new Error(`unknown composition "${compName}" (have: ${Object.keys(COMPOSITIONS).join(', ')})`);
  const hc = await bridge.health();
  if (hc !== 200) throw new Error(`bridge not healthy (${hc}) — is the app on ${process.env.PERSONAS_BASE || ':17321'}?`);
  const { info, rows } = readMembers(teamRef);
  console.log(`Applying composition "${compName}" to ${info.name} (${rows.length} members)…`);
  let applied = 0;
  for (const r of rows) {
    const role = roleOf(r.name);
    if (!role || !comp[role]) {
      console.log(`  SKIP ${r.name} (role=${role || 'unknown'} not in composition)`);
      continue;
    }
    const json = profileJson(comp[role]);
    await bridge.invoke('update_persona', { id: r.id, input: { model_profile: json } }, { timeoutMs: 60000 });
    console.log(`  ✓ ${String(role).padEnd(10)} ${r.name.padEnd(26)} → ${json}`);
    applied++;
  }
  console.log(`Applied to ${applied}/${rows.length} members. Verifying…`);
  show(teamRef);
}

const isMain = (() => {
  try {
    return import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).href || process.argv[1].endsWith('composition.mjs');
  } catch {
    return false;
  }
})();

if (isMain) {
  const [, , cmd, ...rest] = process.argv;
  const teamRef = rest.join(' ').trim();
  if (cmd === 'show' && teamRef) {
    show(teamRef);
  } else if (cmd === 'apply' && rest.length >= 2) {
    const compName = rest[0];
    const tref = rest.slice(1).join(' ').trim();
    apply(compName, tref).catch((e) => {
      console.error('composition apply failed:', e.message);
      process.exit(1);
    });
  } else {
    console.error('usage:\n  node scripts/test/composition.mjs show "<team>"\n  node scripts/test/composition.mjs apply <baseline|tuned> "<team>"');
    process.exit(1);
  }
}
