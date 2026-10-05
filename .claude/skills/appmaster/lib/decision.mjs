// Validates and applies one master decision (WP1). The validator is hand-rolled against
// schema/decision.schema.json (no ajv) plus the cross-field rules the schema cannot say.
//
// Applying is ordered so a crash leaves intent, never effect without identity: (1) mint every run
// (state planned), (2) queue the outbox and raise the asks, (3) mark the wake decided. It writes
// only the journal; the app DB is never written here (the outbox carries what the app owns).

import fs from 'node:fs';
import {
  ASK_KINDS, MAX_ASKS, MAX_DISPATCH, MODELS, VERDICT_STATUSES, WAKE_MAX, WAKE_MIN,
  Refusal, canonical, nowIso,
} from './contract.mjs';
import { listRuns, loadAsks, loadBrief, loadWake, newRun, queueOutbox, raiseAsk, saveWake } from './store.mjs';
import { briefCharters, resolveManaged, openDb, q } from './dbread.mjs';
import { brakes } from './brakes.mjs';

const TOP_KEYS = ['wakeId', 'dispatch', 'defer', 'asks', 'ideaVerdicts', 'say', 'note', 'nextWakeMinutes'];
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

// ---------------------------------------------------------------- extraction

/**
 * The single top-level JSON object in a master's answer: bare, inside a code fence, or inside
 * prose. Throws when there is none or more than one.
 */
export function extractDecision(text) {
  const t = String(text ?? '').replace(/^﻿/, '').trim();
  try { const v = JSON.parse(t); if (isObj(v)) return v; } catch { /* fall through */ }
  const fences = [...t.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)].map((m) => m[1].trim());
  for (const f of fences) { try { const v = JSON.parse(f); if (isObj(v)) return v; } catch { /* next */ } }
  const objs = topLevelObjects(t).map((s) => { try { return JSON.parse(s); } catch { return null; } }).filter(isObj);
  if (objs.length === 1) return objs[0];
  if (!objs.length) throw new Error('no JSON object found in the decision file');
  throw new Error(`found ${objs.length} top-level JSON objects in the decision file; expected exactly one`);
}

/** Balanced {...} spans at depth 0, string- and escape-aware. */
function topLevelObjects(t) {
  const out = []; let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"' && depth > 0) inStr = true;
    else if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' && depth > 0) { depth--; if (depth === 0) out.push(t.slice(start, i + 1)); }
  }
  return out;
}

// ---------------------------------------------------------------- validation (pure)

function checkKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) if (!allowed.includes(k)) errors.push(`${where}: unknown key "${k}"`);
}
function checkArray(d, key, errors) {
  if (!Array.isArray(d[key])) { errors.push(`${key} must be an array (use [] when empty)`); return []; }
  return d[key];
}

/** (decision, {slug, wakeId, brief}) => {ok:boolean, errors:string[]}   // pure */
export function validateDecision(decision, { slug, wakeId, brief } = {}) {
  const errors = [];
  if (!isObj(decision)) return { ok: false, errors: ['the decision must be a JSON object'] };
  const d = decision;
  for (const k of TOP_KEYS) if (!(k in d)) errors.push(`missing required key "${k}"`);
  checkKeys(d, TOP_KEYS, 'decision', errors);

  if (!nonEmpty(d.wakeId)) errors.push('wakeId must be a non-empty string');
  else if (wakeId && d.wakeId !== wakeId) errors.push(`wakeId "${d.wakeId}" does not match the wake "${wakeId}"${slug ? ` of ${slug}` : ''}`);

  const dispatch = checkArray(d, 'dispatch', errors);
  if (dispatch.length > MAX_DISPATCH) errors.push(`dispatch has ${dispatch.length} entries; at most ${MAX_DISPATCH} per wake`);
  dispatch.forEach((x, i) => {
    const w = `dispatch[${i}]`;
    if (!isObj(x)) { errors.push(`${w} must be an object`); return; }
    checkKeys(x, ['charterSlug', 'reason', 'brief', 'ideaIds'], w, errors);
    for (const k of ['charterSlug', 'reason', 'brief']) if (!nonEmpty(x[k])) errors.push(`${w}.${k} must be a non-empty string`);
    if (!Array.isArray(x.ideaIds)) errors.push(`${w}.ideaIds must be an array (use [] when none)`);
    else x.ideaIds.forEach((id, j) => { if (!nonEmpty(id)) errors.push(`${w}.ideaIds[${j}] must be a non-empty string`); });
  });

  const defer = checkArray(d, 'defer', errors);
  defer.forEach((x, i) => {
    const w = `defer[${i}]`;
    if (!isObj(x)) { errors.push(`${w} must be an object`); return; }
    checkKeys(x, ['charterSlug', 'reason'], w, errors);
    for (const k of ['charterSlug', 'reason']) if (!nonEmpty(x[k])) errors.push(`${w}.${k} must be a non-empty string`);
  });

  const asks = checkArray(d, 'asks', errors);
  if (asks.length > MAX_ASKS) errors.push(`asks has ${asks.length} entries; at most ${MAX_ASKS}`);
  asks.forEach((x, i) => {
    const w = `asks[${i}]`;
    if (!isObj(x)) { errors.push(`${w} must be an object`); return; }
    checkKeys(x, ['kind', 'question', 'context', 'options'], w, errors);
    if (!ASK_KINDS.includes(x.kind)) errors.push(`${w}.kind "${x.kind}" is not one of ${ASK_KINDS.join(', ')}`);
    if (!nonEmpty(x.question)) errors.push(`${w}.question must be a non-empty string`);
    if (typeof x.context !== 'string') errors.push(`${w}.context must be a string`);
    if (!Array.isArray(x.options)) { errors.push(`${w}.options must be an array of 2-4 options`); return; }
    if (x.options.length < 2 || x.options.length > 4) errors.push(`${w}.options has ${x.options.length}; 2-4 required`);
    x.options.forEach((o, j) => {
      const ow = `${w}.options[${j}]`;
      if (!isObj(o)) { errors.push(`${ow} must be an object`); return; }
      checkKeys(o, ['label', 'action'], ow, errors);
      if (!nonEmpty(o.label)) errors.push(`${ow}.label must be a non-empty string`);
      if (typeof o.action !== 'string') errors.push(`${ow}.action must be a string`);
    });
    const labels = x.options.filter(isObj).map((o) => String(o.label).trim().toLowerCase());
    if (new Set(labels).size !== labels.length) errors.push(`${w}.options repeat a label`);
  });

  const verdicts = checkArray(d, 'ideaVerdicts', errors);
  const seenIdeas = new Map();
  verdicts.forEach((x, i) => {
    const w = `ideaVerdicts[${i}]`;
    if (!isObj(x)) { errors.push(`${w} must be an object`); return; }
    checkKeys(x, ['ideaId', 'status', 'reason'], w, errors);
    if (!nonEmpty(x.ideaId)) errors.push(`${w}.ideaId must be a non-empty string`);
    if (!VERDICT_STATUSES.includes(x.status)) errors.push(`${w}.status "${x.status}" is not one of ${VERDICT_STATUSES.join(', ')}`);
    if (!nonEmpty(x.reason)) errors.push(`${w}.reason must be a non-empty string`);
    if (nonEmpty(x.ideaId)) {
      if (seenIdeas.has(x.ideaId)) errors.push(`${w}: idea ${x.ideaId} already has a verdict at ideaVerdicts[${seenIdeas.get(x.ideaId)}]`);
      else seenIdeas.set(x.ideaId, i);
    }
  });

  if ('say' in d && d.say !== null && typeof d.say !== 'string') errors.push('say must be a string or null');
  if (!nonEmpty(d.note)) errors.push('note must be a non-empty string (the coverage note your next wake reads)');
  if (!Number.isInteger(d.nextWakeMinutes) || d.nextWakeMinutes < WAKE_MIN || d.nextWakeMinutes > WAKE_MAX) {
    errors.push(`nextWakeMinutes must be an integer ${WAKE_MIN}..${WAKE_MAX}, got ${JSON.stringify(d.nextWakeMinutes)}`);
  }

  // every brief charter exactly once across dispatch + defer, and nothing else
  const known = briefCharters(brief).map((c) => c.slug);
  const count = new Map(known.map((s) => [s, 0]));
  for (const x of [...dispatch, ...defer]) {
    if (!isObj(x) || !nonEmpty(x.charterSlug)) continue;
    if (!count.has(x.charterSlug)) errors.push(`unknown charter slug "${x.charterSlug}" (the brief holds: ${known.join(', ') || 'none'})`);
    else count.set(x.charterSlug, count.get(x.charterSlug) + 1);
  }
  for (const [s, n] of count) {
    if (n === 0) errors.push(`charter "${s}" is missing: every charter appears exactly once in dispatch or defer`);
    if (n > 1) errors.push(`charter "${s}" appears ${n} times across dispatch and defer; exactly once`);
  }
  return { ok: errors.length === 0, errors };
}

// ---------------------------------------------------------------- applying

/** brief.models.byCharter[slug] ?? MODELS.builderByCharter[slug] ?? brief.models.builder ?? MODELS.builder */
export function builderModel(brief, charterSlug) {
  const m = brief?.models ?? {};
  return m.byCharter?.[charterSlug] ?? MODELS.builderByCharter[charterSlug] ?? m.builder ?? MODELS.builder;
}

/**
 * Idea ids a decision names that are not in dev_ideas for this project (read-only). A master once
 * wrote one real idea with two different full ids (2026-10-05); the wrong one would have queued an
 * idea-verdict for nothing. Returns [] when the database cannot be read: no check, never a block.
 */
export function unknownIdeaIds(projectId, decision) {
  const named = new Set([
    ...(decision.dispatch ?? []).flatMap((x) => x.ideaIds ?? []),
    ...(decision.ideaVerdicts ?? []).map((x) => x.ideaId),
  ].filter((id) => typeof id === 'string' && id.trim()));
  if (!named.size) return [];
  let d; try { d = openDb(); } catch { return []; }
  let rows;
  try { rows = q(d, 'select id from dev_ideas where project_id = ?', [projectId]); } finally { try { d.close(); } catch { /* already closed */ } }
  if (rows.some((r) => r.error)) return [];
  const known = new Set(rows.map((r) => r.id));
  return [...named].filter((id) => !known.has(id));
}

/** (args) => {wakeId, runIds:string[], outbox:string[], asks:string[], nextWakeAt}   // mints runIds BEFORE writing; Refusal on invalid */
export async function cmdDecide({ flags = {} } = {}) {
  if (!flags.wake || flags.wake === true) throw new Error('--wake <wakeId> is required');
  if (!flags.file || flags.file === true) throw new Error('--file <decision.json> is required');
  const { slug, project: known } = resolveManaged(flags.project);
  const wake = loadWake(slug, flags.wake);
  if (!wake) throw new Refusal('unknown wake', { slug, wakeId: flags.wake });
  const project = wake.project ?? known;
  if (!project?.id) throw new Error(`no project record for ${slug}: run context first`);
  const brief = loadBrief(slug);
  if (!brief) throw new Error(`no brief for ${slug}: run onboard first`);

  let decision;
  try { decision = extractDecision(fs.readFileSync(flags.file, 'utf8')); } catch (e) {
    throw new Refusal('invalid decision', { errors: [String(e.message || e)] });
  }

  if (wake.status === 'decided') {
    if (wake.decision && canonical(wake.decision) === canonical(decision) && wake.result) return { ...wake.result, repeated: true };
    throw new Refusal('wake already decided', { slug, wakeId: wake.wakeId, decidedAt: wake.decidedAt ?? null });
  }
  const v = validateDecision(decision, { slug, wakeId: wake.wakeId, brief });
  if (!v.ok) throw new Refusal('invalid decision', { errors: v.errors });
  const unknown = unknownIdeaIds(project.id, decision);
  if (unknown.length) throw new Refusal('invalid decision', { errors: unknown.map((id) => `idea ${id} is not a dev_ideas row of ${slug}; copy the full id from the context document, never retype it`) });

  // (1) identity before effect: one planned run per dispatch. A re-submission after a crash
  // finds the run this wake already minted for the charter instead of minting a second one.
  const prior = listRuns(slug).filter((r) => r.wakeId === wake.wakeId);
  const runs = decision.dispatch.map((x) => prior.find((r) => r.charterSlug === x.charterSlug)
    ?? newRun(project, {
      wakeId: wake.wakeId, charterSlug: x.charterSlug, reason: x.reason, brief: x.brief,
      ideaIds: x.ideaIds, model: builderModel(brief, x.charterSlug),
    }));

  // (2) the outbox (idempotent by kind+payload) and the asks (deduped per wake + question)
  const src = { wakeId: wake.wakeId };
  const outbox = [];
  for (const x of decision.ideaVerdicts) outbox.push(queueOutbox(slug, project.id, 'idea-verdict', { ideaId: x.ideaId, status: x.status, reason: x.reason }, src).id);
  if (decision.say !== null && decision.say.trim()) outbox.push(queueOutbox(slug, project.id, 'say', { message: decision.say, from: 'master' }, src).id);
  const raised = loadAsks(slug).filter((a) => a.wakeId === wake.wakeId && a.source === 'master');
  const askIds = [];
  for (const x of decision.asks) {
    const ask = raised.find((a) => a.question === x.question)
      ?? raiseAsk(slug, { wakeId: wake.wakeId, source: 'master', kind: x.kind, question: x.question, context: x.context, options: x.options });
    askIds.push(ask.askId);
    outbox.push(queueOutbox(slug, project.id, 'ask', { op: 'raise', askId: ask.askId, kind: x.kind, question: x.question, context: x.context, options: x.options }, src).id);
  }

  // (3) the wake is decided last
  const decidedAt = nowIso();
  const nextWakeAt = new Date(Date.parse(decidedAt) + decision.nextWakeMinutes * 60000).toISOString();
  const result = { wakeId: wake.wakeId, runIds: runs.map((r) => r.runId), outbox, asks: askIds, nextWakeAt };
  const b = brakes(slug);
  const warnings = [];
  if (runs.length && b.memory.stop) warnings.push(`memory ${b.memory.freeGb} GB free (a dispatch needs ${b.memory.dispatchNeedGb}): dispatch will refuse until it recovers`);
  if (runs.length && b.limit.limited) warnings.push(`usage limit marked${b.limit.resetsAt ? ` until ${b.limit.resetsAt}` : ''}: dispatch will refuse`);
  saveWake(slug, { wakeId: wake.wakeId, status: 'decided', decision, runIds: result.runIds, nextWakeAt, note: decision.note, decidedAt, result });
  return warnings.length ? { ...result, warnings } : result;
}
