// The standup arm list: which managed projects the loop WAKES while an /athena --standup plan is armed.
// Wake-only: caps, path overlap, await, settle, watch and the queue's accounting keep seeing every managed
// project, so a builder of a project that is not armed is still awaited and settled, never orphaned.
// No active.json, or status "ended", means no standup: every managed project wakes, as before.
//
//   standup show
//   standup arm --file <plan.json>      plan: {date, armed:[{slug,...}], planPath?}; armed slugs need a brief.json
//   standup end

import fs from 'node:fs';
import path from 'node:path';
import { STATE_ROOT, readJson, writeJson, nowIso } from './contract.mjs';
import { loadBrief } from './store.mjs';

const activePath = () => path.join(STATE_ROOT, '_standup', 'active.json');

/** The active standup record, or null when none is armed. */
export function activeStandup() {
  const a = readJson(activePath(), null);
  return a && a.status === 'armed' && Array.isArray(a.armed) ? a : null;
}

/** True when the loop may wake this project: no standup armed, or the slug is on its list. */
export const isArmed = (slug) => { const a = activeStandup(); return !a || a.armed.includes(slug); };

export async function cmdStandup({ _: pos = [], flags = {} } = {}) {
  const sub = pos[0] ?? 'show';
  if (sub === 'show') return { active: activeStandup(), file: activePath() };
  if (sub === 'end') {
    const a = readJson(activePath(), null);
    if (!a) return { ended: false, note: 'no standup recorded' };
    writeJson(activePath(), { ...a, status: 'ended', endedAt: nowIso() });
    return { ended: true, wasArmed: a.armed };
  }
  if (sub === 'arm') {
    if (!flags.file || flags.file === true) throw new Error('standup arm needs --file <plan.json>');
    const plan = readJson(path.resolve(String(flags.file)), null);
    if (!plan) throw new Error(`cannot read plan ${flags.file}`);
    const slugs = (plan.armed ?? []).map((e) => (typeof e === 'string' ? e : e?.slug));
    const errors = [];
    if (!plan.date || !/^\d{4}-\d{2}-\d{2}/.test(String(plan.date))) errors.push('date must start YYYY-MM-DD');
    if (!slugs.length) errors.push('armed must name at least one project');
    if (new Set(slugs).size !== slugs.length) errors.push('armed has a duplicate slug');
    for (const s of slugs) if (!s || !loadBrief(s)) errors.push(`no brief.json for "${s}" (onboard it first)`);
    if (errors.length) return { refused: 'invalid standup plan', errors };
    const record = { version: 1, date: String(plan.date).slice(0, 10), planPath: plan.planPath ?? path.resolve(String(flags.file)), armed: slugs, status: 'armed', armedAt: nowIso() };
    writeJson(activePath(), record);
    return { armed: record };
  }
  throw new Error(`unknown standup subcommand "${sub}" (show | arm | end)`);
}
