#!/usr/bin/env node
// /master — the terminal channel to ONE App Master per project.
//
// The App Master is a runtime role the app already owns (engine/src/app_master.rs): a
// persona bound to a dev_projects row, holding charters, deciding on every wake, dispatching
// fleet workers, filing ideas and KPIs, asking the operator. This script is the bridge the
// /master skill drives from OUTSIDE the app, the way brain.py is Athena's: it READS the
// master's memory from the live database (read-only) and WRITES only through the app's own
// doors (the dev-tools bridge and the test-automation bridge's invokeCommand), never the DB.
//
//   node .claude/skills/master/master.mjs list                       # every project, master or not
//   node .claude/skills/master/master.mjs boot    --project <ref>    # the master's whole memory
//   node .claude/skills/master/master.mjs onboard --project <ref> --brief <file.json>
//   node .claude/skills/master/master.mjs say     --project <ref> --file <msg.md>
//   node .claude/skills/master/master.mjs wake    --project <ref> [--off]
//   node .claude/skills/master/master.mjs asks    --project <ref>
//   node .claude/skills/master/master.mjs answer  --review <id> --status approved|rejected --notes "<text>"
//   node .claude/skills/master/master.mjs digest  --project <ref> [--since <iso>] [--no-advance]
//   node .claude/skills/master/master.mjs end     --project <ref> --note <file.md>
//
// <ref> = dev_projects id | name | root path (case-insensitive) | skill slug.
// Requires the app running with the test-automation server (npm run tauri:dev:test) for every
// write; reads work against the database alone. Env: PERSONAS_BASE (test bridge, default
// :17320), PERSONAS_DB, MASTER_VAULT (Obsidian folder; default the personas vault).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

// The test-automation server binds 17320 or the next free port when a stale listener
// holds it (measured 2026-09-14: a relaunch beside a dead instance came up on 17321 while
// 17320 still answered nothing). Unless the caller pins PERSONAS_BASE, probe 17320..17325
// and take the first port whose /health answers.
if (!process.env.PERSONAS_BASE) {
  const first = Number(process.env.PERSONAS_TEST_PORT || 17320);
  let found = null;
  for (let port = first; port < first + 6 && !found; port++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
      if (r.ok) found = port;
    } catch {}
  }
  process.env.PERSONAS_BASE = `http://127.0.0.1:${found ?? first}`;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const STATE_ROOT = path.join(ROOT, '.claude', 'master');
const DB_PATH = process.env.PERSONAS_DB ||
  path.join(process.env.APPDATA || os.homedir(), 'com.personas.desktop', 'personas.db');
const VAULT = process.env.MASTER_VAULT ||
  ['C:/Users/kazda/Documents/Obsidian/personas', 'C:/Users/mkdol/Documents/Obsidian/personas']
    .find((p) => fs.existsSync(p)) || null;

const args = process.argv.slice(2);
const mode = args[0] || 'list';
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const norm = (p) => String(p || '').replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- database (read-only)

function db() { return new DatabaseSync(DB_PATH, { readOnly: true }); }
function q(d, sql, params = []) {
  try { return d.prepare(sql).all(...params); } catch (e) { return [{ error: String(e.message || e) }]; }
}
function one(d, sql, params = []) { return q(d, sql, params)[0] ?? null; }

function projects(d) {
  return q(d, `select id, name, root_path, description, status, main_branch, workspace_id from dev_projects order by name`);
}

function resolveProject(d, ref) {
  if (!ref) throw new Error('--project <id|name|root|slug> is required');
  const rows = projects(d);
  const r = String(ref);
  const hit = rows.find((p) => p.id === r)
    || rows.find((p) => p.name.toLowerCase() === r.toLowerCase())
    || rows.find((p) => norm(p.root_path) === norm(r))
    || rows.find((p) => slugify(p.name) === slugify(r))
    || rows.find((p) => path.basename(norm(p.root_path)) === r.toLowerCase());
  if (!hit) throw new Error(`no dev_projects row matches "${ref}" (run: master.mjs list)`);
  return hit;
}

function masterOf(d, projectId) {
  // The adoption door binds every charter to the project; the persona is the charters' owner.
  return one(d, `
    select p.id, p.name, p.enabled, p.model_profile, p.created_at, p.core_profile
    from personas p
    where p.id in (select persona_id from persona_responsibilities where project_id = ?)
      and p.name like 'App Master%'
    order by p.created_at desc limit 1`, [projectId]);
}

function charters(d, personaId) {
  return q(d, `select id, title, status, scope_rung, cadence, spec, updated_at
               from persona_responsibilities where persona_id = ? order by title`, [personaId])
    .map((c) => {
      let spec = {}; try { spec = JSON.parse(c.spec || '{}'); } catch {}
      return {
        id: c.id, title: c.title, status: c.status, rung: c.scope_rung,
        slug: spec.recipeRef?.slug ?? null, priority: spec.priority ?? null,
        pacing: spec.pacing ?? null, model: spec.modelOverride ?? null,
      };
    });
}

function openAsks(d, personaId) {
  return q(d, `select id, title, description, severity, context_data, suggested_actions, created_at
               from persona_manual_reviews where persona_id = ? and status = 'pending'
               order by created_at`, [personaId]);
}

function goals(d, projectId) {
  return q(d, `select g.id, g.title, g.description, g.status, g.progress, g.target_date, g.kpi_id,
                      (select count(*) from dev_goal_items i where i.goal_id = g.id) items,
                      (select count(*) from dev_goal_items i where i.goal_id = g.id and i.done = 1) done_items
               from dev_goals g where g.project_id = ? and g.parent_goal_id is null
               order by case g.status when 'in-progress' then 0 when 'open' then 1 when 'blocked' then 2
                        when 'awaiting_acceptance' then 3 else 4 end, g.order_index, g.created_at`, [projectId]);
}

function memories(d, personaId, limit = 12) {
  return q(d, `select category, tier, importance, title, substr(content, 1, 400) content, created_at
               from persona_memories where persona_id = ? and tier = 'active'
               order by importance desc, created_at desc limit ?`, [personaId, limit]);
}

function projectMemories(d, projectId, limit = 8) {
  return q(d, `select category, importance, title, substr(content, 1, 300) content, created_at
               from dev_memories where project_id = ? order by importance desc, created_at desc limit ?`,
    [projectId, limit]);
}

function ledger(d, personaId, since, limit = 40) {
  return q(d, `select id, lane, verdict, substr(reason, 1, 240) reason, responsibility_id, cost_usd,
                      started_at, completed_at, substr(stats_json, 1, 600) stats
               from persona_attention_ledger where persona_id = ? and started_at > ?
               order by started_at desc limit ?`, [personaId, since, limit]);
}

function episodes(d, personaId, since, limit = 20) {
  return q(d, `select id, role, source, responsibility_id, execution_id, substr(body_excerpt, 1, 700) body, created_at
               from persona_episodes where persona_id = ? and created_at > ?
               order by created_at desc limit ?`, [personaId, since, limit]);
}

function executions(d, personaId, since, limit = 20) {
  return q(d, `select id, status, started_at, completed_at, substr(error_message, 1, 200) error
               from persona_executions where persona_id = ? and started_at > ?
               order by started_at desc limit ?`, [personaId, since, limit]);
}

function channel(d, personaId, since, limit = 30) {
  return q(d, `select m.id, m.author_kind, coalesce(m.author_label, a.name, 'operator') who, m.authority,
                      substr(m.body, 1, 1200) body, m.created_at
               from team_channel_messages m left join personas a on a.id = m.author_id
               where m.persona_id = ? and datetime(substr(m.created_at, 1, 19)) > datetime(substr(?, 1, 19))
               order by m.created_at desc limit ?`, [personaId, since, limit]);
}

function fleet(d, projectRoot, since) {
  // fleet_sessions keeps epoch millis; the cursor is ISO. Workers author in a worktree UNDER
  // the project root (or a sibling worktree dir), so match on the root as a prefix.
  const sinceMs = Date.parse(since) || 0;
  return q(d, `select id, state, state_reason, mode, substr(coalesce(title, name, ''), 1, 120) title, cwd,
                      datetime(created_at_ms / 1000, 'unixepoch') started_at,
                      datetime(last_activity_ms / 1000, 'unixepoch') last_activity
               from fleet_sessions where lower(replace(cwd, '/', '\\')) like ? and created_at_ms > ?
               order by created_at_ms desc limit 20`, [`${norm(projectRoot)}%`, sinceMs]);
}

function ideasSummary(d, projectId) {
  return q(d, `select status, count(*) n from dev_ideas where project_id = ? group by status`, [projectId]);
}

function tasksSince(d, projectId, since) {
  return q(d, `select id, status, substr(title, 1, 120) title, created_at, updated_at
               from dev_tasks where project_id = ? and datetime(substr(coalesce(updated_at, created_at), 1, 19)) > datetime(substr(?, 1, 19)) order by updated_at desc limit 20`,
    [projectId, since]);
}

function kpisSummary(d, projectId) {
  return one(d, `select count(*) total, sum(status = 'active') active,
                        sum(last_measured_at is not null) measured from dev_kpis where project_id = ?`, [projectId]);
}

function gitBranches(root) {
  try {
    const out = execFileSync('git', ['-C', root, 'for-each-ref', '--sort=-committerdate', '--count=12',
      '--format=%(refname:short)|%(committerdate:iso8601)|%(subject)', 'refs/heads/autopilot/', 'refs/heads/app-master/'],
      { encoding: 'utf8' });
    return out.trim().split('\n').filter(Boolean).map((l) => {
      const [branch, at, ...rest] = l.split('|'); return { branch, at, subject: rest.join('|') };
    });
  } catch (e) { return [{ error: String(e.message || e).split('\n')[0] }]; }
}

function memoryHeadroom() {
  const total = os.totalmem(), free = os.freemem();
  return { usedPct: Math.round(((total - free) / total) * 100), freeGb: +(free / 2 ** 30).toFixed(1) };
}

// ---------------------------------------------------------------- skill state (local, gitignored)

function stateDir(slug) { const p = path.join(STATE_ROOT, slug); fs.mkdirSync(p, { recursive: true }); return p; }
function readJson(p, d) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } }
function writeJson(p, v) { fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n'); }
function loadState(slug) { return readJson(path.join(stateDir(slug), 'state.json'), null); }
function saveState(slug, s) { writeJson(path.join(stateDir(slug), 'state.json'), s); }
function appendLog(slug, event, extra = {}) {
  fs.appendFileSync(path.join(stateDir(slug), 'log.jsonl'), JSON.stringify({ at: nowIso(), event, ...extra }) + '\n');
}
function cursor(slug) { return readJson(path.join(stateDir(slug), 'cursor.json'), { at: '1970-01-01T00:00:00Z' }); }
function setCursor(slug, at) { writeJson(path.join(stateDir(slug), 'cursor.json'), { at }); }

function vaultDir(projectName) {
  if (!VAULT) return null;
  const p = path.join(VAULT, 'App Masters', projectName);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// ---------------------------------------------------------------- app doors (writes)

function handshake() {
  const p = path.join(os.homedir(), '.personas', 'local-http.json');
  const h = JSON.parse(fs.readFileSync(p, 'utf8'));
  return { base: `http://127.0.0.1:${h.port}/dev-tools`, token: h.token, pid: h.pid };
}

async function devTools(route, body) {
  const h = handshake();
  const res = await fetch(h.base + route, {
    method: body ? 'POST' : 'GET',
    headers: { 'X-Personas-Local-Token': h.token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) throw new Error(`${route} -> ${res.status}: ${text.slice(0, 400)}`);
  return json;
}

let bridgeMod = null;
async function bridge() {
  if (!bridgeMod) {
    bridgeMod = await import(path.join(ROOT, 'scripts', 'test', 'bridge.mjs').replace(/\\/g, '/').replace(/^([A-Za-z]):/, 'file:///$1:'));
    await bridgeMod.health();
  }
  return bridgeMod;
}

// invokeCommand over the test bridge returns {big:n} for results over 380 chars; every
// call here verifies its effect in the database afterwards rather than trusting the echo.
async function invoke(command, params) {
  const b = await bridge();
  const r = await b.invoke(command, params);
  if (r && r.ok === false) throw new Error(`${command}: ${r.e}`);
  return r;
}

// ---------------------------------------------------------------- modes

function cmdList() {
  const d = db();
  const rows = projects(d).map((p) => {
    const m = masterOf(d, p.id);
    const slug = slugify(path.basename(p.root_path) || p.name);
    const st = loadState(slug);
    const asks = m ? openAsks(d, m.id).length : 0;
    const ch = m ? charters(d, m.id).filter((c) => c.status === 'active').length : 0;
    const lastNote = m ? charters(d, m.id).map((c) => c.pacing?.coverageNote).filter(Boolean).at(-1) : null;
    return {
      project: p.name, id: p.id, root: p.root_path, slug,
      master: m ? { id: m.id, name: m.name, enabled: !!m.enabled, charters: ch, openAsks: asks } : null,
      onboarded: !!st?.onboardedAt, lastSession: st?.lastSession ?? null,
      lastNote: lastNote ? String(lastNote).slice(0, 140) : null,
      exists: fs.existsSync(p.root_path),
    };
  });
  console.log(JSON.stringify(rows, null, 2));
}

function bootPayload(d, p) {
  const m = masterOf(d, p.id);
  const slug = slugify(path.basename(p.root_path) || p.name);
  const st = loadState(slug);
  const cur = cursor(slug);
  const out = {
    project: { id: p.id, name: p.name, root: p.root_path, mainBranch: p.main_branch, description: p.description },
    slug, stateDir: stateDir(slug), vault: vaultDir(p.name), cursor: cur.at, state: st,
    master: null, machine: memoryHeadroom(),
    ideas: ideasSummary(d, p.id), kpis: kpisSummary(d, p.id), goals: goals(d, p.id),
    projectMemories: projectMemories(d, p.id),
  };
  if (!m) return out;
  const cs = charters(d, m.id);
  out.master = {
    id: m.id, name: m.name, enabled: !!m.enabled, model: m.model_profile, createdAt: m.created_at,
    manifest: m.core_profile || null,
    charters: cs,
    lastNote: cs.map((c) => c.pacing).filter(Boolean).sort((a, b) => String(b.lastDecidedAt).localeCompare(String(a.lastDecidedAt)))[0] ?? null,
    openAsks: openAsks(d, m.id),
    memories: memories(d, m.id),
    recentLedger: ledger(d, m.id, '1970', 12),
    recentEpisodes: episodes(d, m.id, '1970', 6).map((e) => ({ ...e, body: e.body.slice(0, 300) })),
    channelTail: channel(d, m.id, '1970', 12),
    branches: gitBranches(p.root_path),
    fleet: fleet(d, p.root_path, '1970').slice(0, 6),
  };
  const loop = one(d, `select value from app_settings where key = 'autonomous_attention_loop'`);
  out.attentionLoop = loop?.value ?? null;
  return out;
}

function cmdBoot() {
  const d = db();
  const p = resolveProject(d, opt('--project'));
  console.log(JSON.stringify(bootPayload(d, p), null, 2));
}

async function cmdOnboard() {
  const d = db();
  const p = resolveProject(d, opt('--project'));
  const briefPath = opt('--brief');
  if (!briefPath) throw new Error('--brief <file.json> is required');
  const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
  const slug = slugify(path.basename(p.root_path) || p.name);
  const existing = masterOf(d, p.id);

  // 1. Adopt (idempotent on project + slug). `enabled: false` here: the wake is a separate,
  //    deliberate step so the brief is in the channel BEFORE the first decision.
  const recipes = (brief.charters || []).map((c) => (typeof c === 'string' ? { slug: c } : c));
  if (!recipes.length) throw new Error('brief.charters must name at least one recipe slug');
  const adoption = await devTools('/app-master/adopt', {
    project: p.id, recipes, model: brief.model || 'claude-opus-5',
    maxConcurrent: brief.maxConcurrent ?? 2, scopeRung: 2, enabled: false,
  });
  console.log(`adopted: persona ${adoption.personaId} (${adoption.created ? 'created' : 'updated'}), charters ${adoption.charters?.length}, suspended ${adoption.suspended?.length ?? 0}${adoption.notes?.length ? ' notes: ' + adoption.notes.join(' | ') : ''}`);
  const personaId = adoption.personaId;

  // 2. Goals: each key goal becomes a dev_goals row (skipped when a goal of the same title exists).
  const have = new Set(goals(d, p.id).map((g) => g.title.toLowerCase()));
  const created = [];
  for (const g of brief.goals || []) {
    if (have.has(g.title.toLowerCase())) { console.log(`goal exists: ${g.title}`); continue; }
    await invoke('dev_tools_create_goal', {
      projectId: p.id, title: g.title, description: g.description || null, contextId: null,
      status: 'open', targetDate: g.targetDate || null, parentGoalId: null,
    });
    created.push(g.title);
  }
  const after = goals(db(), p.id);
  for (const t of created) {
    if (!after.some((g) => g.title === t)) throw new Error(`goal "${t}" did not land in dev_goals`);
  }
  console.log(`goals: ${created.length} created, ${after.length} on the project`);

  // 3. Boundaries law: the operator's constraints, appended to what the adoption door wrote.
  if (brief.boundaries?.length) {
    const manifest = masterOf(db(), p.id)?.core_profile || '';
    const current = sectionOf(manifest, 'Boundaries');
    const lines = brief.boundaries.map((b) => `- ${b}`).filter((l) => !current.includes(l));
    if (lines.length) {
      await invoke('update_persona_manifest_law', {
        personaId, section: 'Boundaries', content: `${current.trim()}\n${lines.join('\n')}\n`,
      });
      console.log(`boundaries: ${lines.length} line(s) added to the law`);
    }
  }

  // 4. The owner's brief goes into the master's channel as its first message. A cold master
  //    otherwise decides against an assumed goal (the Architect lesson from /grande).
  const text = renderBrief(p, brief, after);
  await invoke('post_persona_channel_message', { personaId, content: text, clientId: null });
  const landed = channel(db(), personaId, '1970', 1)[0];
  if (!landed || !landed.body.startsWith(text.slice(0, 40))) throw new Error('brief did not land in the channel');
  console.log(`brief posted: channel message ${landed.id}`);

  // 5. Skill state + vault map.
  const st = loadState(slug) || {};
  Object.assign(st, {
    project: { id: p.id, name: p.name, root: p.root_path }, personaId, slug,
    onboardedAt: st.onboardedAt || nowIso(), brief, briefMessageId: landed.id,
    reAdoptedAt: existing ? nowIso() : null, decisions: st.decisions || [],
  });
  saveState(slug, st);
  setCursor(slug, nowIso());
  appendLog(slug, 'onboard', { personaId, created: adoption.created, goals: created.length });
  const vd = vaultDir(p.name);
  if (vd) {
    const map = path.join(vd, `${p.name}.md`);
    if (!fs.existsSync(map)) fs.writeFileSync(map, renderMap(p, brief, personaId, after));
    console.log(`vault map: ${map}`);
  }
  console.log(JSON.stringify({ personaId, slug, goals: after.map((g) => g.title) }, null, 2));
}

function sectionOf(manifest, heading) {
  const re = new RegExp(`^# ${heading}\\s*$([\\s\\S]*?)(?=^# |(?![\\s\\S]))`, 'm');
  const m = manifest.match(re);
  return m ? m[1] : '';
}

function renderBrief(p, b, gs) {
  const lines = [];
  lines.push(`OWNER'S BRIEF for ${p.name} (from the operator, via the /master terminal channel)`);
  lines.push('');
  lines.push(`What this product is: ${b.product}`);
  if (b.stage) lines.push(`Stage: ${b.stage}`);
  if (b.users) lines.push(`Who it serves: ${b.users}`);
  lines.push('');
  lines.push('KEY GOALS, in priority order. Each is a dev_goals row you own; move them, measure them, amend them through your plan when reality disagrees:');
  (b.goals || []).forEach((g, i) => {
    const row = gs.find((x) => x.title === g.title);
    lines.push(`${i + 1}. ${g.title}${row ? ` (goal ${row.id.slice(0, 8)})` : ''}`);
    if (g.description) lines.push(`   ${g.description}`);
    if (g.measure) lines.push(`   Measured by: ${g.measure}`);
  });
  lines.push('');
  if (b.boundaries?.length) { lines.push('BOUNDARIES (also written into your law):'); b.boundaries.forEach((x) => lines.push(`- ${x}`)); lines.push(''); }
  lines.push('HOW WE WORK TOGETHER:');
  lines.push(`- The operator is ${b.operatorRole || 'a CEO-level manager: counsel on decisions, never a task queue'}.`);
  lines.push(`- Ask the operator only for: ${b.askFor || 'scope changes, spending, risk on the money or data path, a conflict between two goals'}. Everything else you decide and record.`);
  lines.push(`- Pacing: ${b.pacing || 'self-paced; choose the next wake from the work in front of you'}.`);
  lines.push(`- Report in ${b.tone || 'plain, short sentences; lead with what moved and what it cost; no praise, no filler'}.`);
  lines.push(`- Your channel is read by the operator between wakes. When you say something, say it there.`);
  if (b.extra) { lines.push(''); lines.push(b.extra); }
  return lines.join('\n');
}

function renderMap(p, b, personaId, gs) {
  return `# ${p.name} App Master

> Map for the /master terminal channel. Re-read before every write; session notes sit beside it.

- persona: \`${personaId}\`
- project: \`${p.id}\` at \`${p.root_path}\`
- onboarded: ${nowIso().slice(0, 10)}

## Product
${b.product}

## Key goals
${(b.goals || []).map((g, i) => `${i + 1}. ${g.title}${g.measure ? ` (measured by: ${g.measure})` : ''}`).join('\n')}

## Boundaries
${(b.boundaries || []).map((x) => `- ${x}`).join('\n') || '- (none beyond the law)'}

## Decisions
- (append: date, what the operator decided, why)

## Open questions
- (append)

## Sessions
- (one line per session note)
`;
}

async function cmdSay() {
  const d = db();
  const p = resolveProject(d, opt('--project'));
  const m = masterOf(d, p.id);
  if (!m) throw new Error(`${p.name} has no App Master (onboard first)`);
  const file = opt('--file');
  const content = file ? fs.readFileSync(file, 'utf8') : opt('--text');
  if (!content?.trim()) throw new Error('--file <msg.md> or --text "<msg>" is required');
  await invoke('post_persona_channel_message', { personaId: m.id, content, clientId: null });
  const landed = channel(db(), m.id, '1970', 1)[0];
  if (!landed || !landed.body.startsWith(content.trim().slice(0, 40))) throw new Error('message did not land in the channel');
  const slug = slugify(path.basename(p.root_path) || p.name);
  appendLog(slug, 'say', { messageId: landed.id, chars: content.length });
  console.log(`said: channel message ${landed.id}`);
}

async function cmdWake() {
  const d = db();
  const p = resolveProject(d, opt('--project'));
  const m = masterOf(d, p.id);
  if (!m) throw new Error(`${p.name} has no App Master (onboard first)`);
  const on = !flag('--off');
  if (on) {
    const loop = one(d, `select value from app_settings where key = 'autonomous_attention_loop'`);
    if (loop?.value !== 'true') {
      await invoke('set_app_setting', { key: 'autonomous_attention_loop', value: 'true' });
      console.log('attention loop: switched on');
    }
  }
  await invoke('set_persona_enabled', { personaId: m.id, enabled: on });
  const after = one(db(), `select enabled from personas where id = ?`, [m.id]);
  if (!!after?.enabled !== on) throw new Error(`personas.enabled did not flip to ${on}`);
  const slug = slugify(path.basename(p.root_path) || p.name);
  appendLog(slug, on ? 'wake' : 'sleep', { personaId: m.id });
  const cap = one(db(), `select value from app_settings where key = 'max_active_personas'`);
  const active = one(db(), `select count(*) n from personas where enabled = 1`);
  console.log(`${m.name}: enabled=${on} (a wake request is recorded on enable); active personas ${active?.n}/${cap?.value ?? '?'}`);
}

function cmdAsks() {
  const d = db();
  const p = resolveProject(d, opt('--project'));
  const m = masterOf(d, p.id);
  if (!m) throw new Error(`${p.name} has no App Master`);
  console.log(JSON.stringify(openAsks(d, m.id), null, 2));
}

async function cmdAnswer() {
  const id = opt('--review'); const status = opt('--status'); const notes = opt('--notes', '');
  if (!id || !['approved', 'rejected', 'resolved'].includes(status)) throw new Error('--review <id> --status approved|rejected|resolved [--notes ...]');
  const before = one(db(), `select persona_id, title, status from persona_manual_reviews where id = ?`, [id]);
  if (!before) throw new Error(`no manual review ${id}`);
  await invoke('update_manual_review_status', { id, status, reviewerNotes: notes || null });
  const after = one(db(), `select status from persona_manual_reviews where id = ?`, [id]);
  if (after?.status !== status) throw new Error(`review status is ${after?.status}, not ${status}`);
  const p = one(db(), `select p.* from dev_projects p where p.id in (select project_id from persona_responsibilities where persona_id = ?)`, [before.persona_id]);
  if (p) appendLog(slugify(path.basename(p.root_path) || p.name), 'answer', { reviewId: id, status, notes, title: before.title });
  console.log(`answered ${id}: ${status} ("${before.title.slice(0, 80)}")`);
}

function cmdDigest() {
  const d = db();
  const p = resolveProject(d, opt('--project'));
  const m = masterOf(d, p.id);
  if (!m) throw new Error(`${p.name} has no App Master`);
  const slug = slugify(path.basename(p.root_path) || p.name);
  const since = opt('--since') || cursor(slug).at;
  const now = nowIso();
  const cs = charters(d, m.id);
  const out = {
    project: p.name, master: m.name, enabled: !!m.enabled, since, until: now,
    machine: memoryHeadroom(),
    attentionLoop: one(d, `select value from app_settings where key = 'autonomous_attention_loop'`)?.value ?? null,
    ledger: ledger(d, m.id, since),
    executions: executions(d, m.id, since),
    episodes: episodes(d, m.id, since),
    channel: channel(d, m.id, since),
    fleet: fleet(d, p.root_path, since),
    tasks: tasksSince(d, p.id, since),
    newAsks: openAsks(d, m.id).filter((a) => Date.parse(a.created_at.replace(' ', 'T')) > Date.parse(since)),
    openAsks: openAsks(d, m.id).length,
    pacing: cs.map((c) => ({ title: c.title, priority: c.priority, pacing: c.pacing })).filter((c) => c.pacing),
    goals: goals(d, p.id).map((g) => ({ title: g.title, status: g.status, progress: g.progress, items: `${g.done_items}/${g.items}` })),
    ideas: ideasSummary(d, p.id),
    branches: gitBranches(p.root_path).filter((b) => !b.error && b.at > since.replace('T', ' ').slice(0, 19)),
  };
  out.quiet = !out.ledger.length && !out.executions.length && !out.episodes.length && !out.channel.length && !out.fleet.length && !out.newAsks.length;
  if (!flag('--no-advance')) { setCursor(slug, now); appendLog(slug, 'digest', { since, quiet: out.quiet, ledger: out.ledger.length, executions: out.executions.length, asks: out.newAsks.length }); }
  console.log(JSON.stringify(out, null, 2));
}

function cmdEnd() {
  const d = db();
  const p = resolveProject(d, opt('--project'));
  const slug = slugify(path.basename(p.root_path) || p.name);
  const noteFile = opt('--note');
  if (!noteFile) throw new Error('--note <file.md> is required');
  const note = fs.readFileSync(noteFile, 'utf8');
  const vd = vaultDir(p.name);
  const day = nowIso().slice(0, 10);
  const name = `${day} ${opt('--slug', 'session')}.md`;
  const target = vd ? path.join(vd, name) : path.join(stateDir(slug), 'sessions', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target)) throw new Error(`${target} exists; pick another --slug (never overwrite a note)`);
  fs.writeFileSync(target, note);
  if (vd) {
    const map = path.join(vd, `${p.name}.md`);
    if (fs.existsSync(map)) fs.appendFileSync(map, `- [[${name.replace(/\.md$/, '')}]]\n`);
  }
  const st = loadState(slug) || {};
  st.lastSession = { at: nowIso(), note: target };
  saveState(slug, st);
  appendLog(slug, 'end', { note: target });
  console.log(`session note: ${target}`);
}

const modes = { list: cmdList, boot: cmdBoot, onboard: cmdOnboard, say: cmdSay, wake: cmdWake, asks: cmdAsks, answer: cmdAnswer, digest: cmdDigest, end: cmdEnd };
if (!modes[mode]) { console.error(`unknown mode ${mode}; one of ${Object.keys(modes).join(' | ')}`); process.exit(2); }
try { await modes[mode](); } catch (e) { console.error(`[master] ${e.message || e}`); process.exit(1); }
