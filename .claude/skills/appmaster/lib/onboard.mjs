// Writes brief.json in /master's schema (WP1). No bridge doors and no app DB writes: goals reach the
// app later through `/master onboard`. Reads the DB only to resolve the project's slug.

import fs from 'node:fs';
import { Refusal, briefPath, slugify } from './contract.mjs';
import { saveBrief } from './store.mjs';
import { resolveProject } from './dbread.mjs';

/** Keys /master's briefs carry (.claude/master/{ascent,kp}/brief.json) plus this skill's optional ones. */
export const BRIEF_KEYS = [
  'project', 'product', 'stage', 'users', 'operatorRole', 'goals', 'charters', 'model', 'maxParallel', 'maxConcurrent',
  'boundaries', 'askFor', 'pacing', 'reportStyle', 'tone', 'digestCadence', 'digest', 'rung', 'extra', 'gates', 'models', 'headless',
];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrMap = (v) => isObj(v) && Object.values(v).every((x) => typeof x === 'string' && x.trim());

/** (brief) => {ok, errors[], warnings[]}   // pure */
export function validateBrief(brief) {
  const errors = [], warnings = [];
  if (!isObj(brief)) return { ok: false, errors: ['the brief must be a JSON object'], warnings };
  for (const k of Object.keys(brief)) if (!BRIEF_KEYS.includes(k)) warnings.push(`unknown key "${k}" (kept as written)`);
  if (!Array.isArray(brief.charters) || !brief.charters.length) errors.push('charters must be a non-empty array of {slug, priority}');
  else {
    const seen = new Set();
    brief.charters.forEach((c, i) => {
      const slug = typeof c === 'string' ? c : c?.slug;
      if (typeof slug !== 'string' || !SLUG_RE.test(slug)) errors.push(`charters[${i}]: slug ${JSON.stringify(slug)} is not a kebab-case recipe slug`);
      else if (seen.has(slug)) errors.push(`charters[${i}]: slug "${slug}" is listed twice`);
      else seen.add(slug);
      const pr = typeof c === 'string' ? null : c?.priority;
      if (pr != null && !(Number.isInteger(pr) && pr >= 1 && pr <= 5)) errors.push(`charters[${i}].priority must be an integer 1..5 or null`);
    });
  }
  if (brief.goals != null) {
    if (!Array.isArray(brief.goals)) errors.push('goals must be an array');
    else brief.goals.forEach((g, i) => { if (!isObj(g) || typeof g.title !== 'string' || !g.title.trim()) errors.push(`goals[${i}] needs a title`); });
  }
  if (brief.boundaries != null && !(Array.isArray(brief.boundaries) && brief.boundaries.every((b) => typeof b === 'string'))) errors.push('boundaries must be an array of strings');
  if (brief.askFor != null && !(typeof brief.askFor === 'string' || (Array.isArray(brief.askFor) && brief.askFor.every((a) => typeof a === 'string')))) errors.push('askFor must be a string or an array of strings');
  if (brief.gates != null && !isStrMap(brief.gates)) errors.push('gates must map a gate name (typecheck, lint, test) to a shell command');
  if (brief.models != null) {
    if (!isObj(brief.models)) errors.push('models must be an object {master?, builder?, byCharter?}');
    else {
      for (const k of ['master', 'builder']) if (brief.models[k] != null && typeof brief.models[k] !== 'string') errors.push(`models.${k} must be a model id string`);
      if (brief.models.byCharter != null && !isStrMap(brief.models.byCharter)) errors.push('models.byCharter must map charter slugs to model ids');
    }
  }
  if (brief.headless != null && typeof brief.headless !== 'boolean') errors.push('headless must be true or false');
  for (const k of ['maxParallel', 'maxConcurrent']) if (brief[k] != null && !(Number.isInteger(brief[k]) && brief[k] >= 1)) errors.push(`${k} must be a positive integer`);
  return { ok: !errors.length, errors, warnings };
}

/** (args) => {slug, briefPath}   // --project p --brief file.json [--force] */
export async function cmdOnboard({ flags = {} } = {}) {
  if (!flags.project || flags.project === true) throw new Error('--project <id|name|root|slug> is required');
  if (!flags.brief || flags.brief === true) throw new Error('--brief <brief.json> is required');
  let brief;
  try { brief = JSON.parse(fs.readFileSync(flags.brief, 'utf8').replace(/^﻿/, '')); } catch (e) {
    throw new Refusal('invalid brief', { errors: [`cannot read ${flags.brief} as JSON: ${String(e.message || e)}`] });
  }
  const v = validateBrief(brief);
  if (!v.ok) throw new Refusal('invalid brief', { errors: v.errors, warnings: v.warnings });

  let slug, slugFrom = 'db';
  try { slug = resolveProject(flags.project).slug; } catch (e) {
    if (/no dev_projects row/.test(String(e.message))) throw e;
    slug = slugify(flags.project); slugFrom = `the --project flag (app DB unreadable: ${String(e.message || e).split('\n')[0]})`;
  }
  const target = briefPath(slug);
  let backup = null;
  if (fs.existsSync(target)) {
    if (!flags.force) throw new Refusal('brief exists', { slug, briefPath: target, hint: 'pass --force to replace it (a .bak copy is kept)' });
    backup = `${target}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(target, backup);
  }
  saveBrief(slug, brief);
  return { slug, briefPath: target, backup, slugFrom, warnings: v.warnings };
}
