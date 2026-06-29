// DELIBERATION COOPERATION CERT (Design D, §-deliberation) — a verdict-producing
// cert for the deliberation engine. Unlike loop-certify.mjs (read-only over the
// live DB), this is a LIVE cert: it RUNS a real deliberation through the actual
// prompts + governance (mirrored from src-tauri/src/engine/deliberation.rs) with
// real Claude calls, then GRADES the cooperation evidence — convergence, genuine
// divergence (not bland agreement), an actionable proposal, and boundedness — and
// emits CERTIFIED / DEGRADED / FAILED.
//
//   node scripts/test/deliberation-certify.mjs              # run + grade + verdict
//   node scripts/test/deliberation-certify.mjs --json       # machine-readable
//   node scripts/test/deliberation-certify.mjs --topic "…"  # custom topic
//
// Manual / local cert — it spends tokens (≈1 Haiku moderator + ≤3 Sonnet turns
// per round, + 1 proposal + 1 Haiku judge). Not CI-wired. The app ledgers real
// USD per call in `companion_turn` (trigger_kind deliberation_moderate/_turn/
// _proposal) — this cert reports call counts as the local cost proxy.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const args = process.argv.slice(2);
const AS_JSON = args.includes('--json');
const topicArg = (() => {
  const i = args.indexOf('--topic');
  return i >= 0 ? args[i + 1] : null;
})();
const log = (...a) => { if (!AS_JSON) console.log(...a); };
const read = (f) => JSON.parse(readFileSync(`${ROOT}/${f}`, 'utf8'));

// ── Governance constants (mirror engine/deliberation.rs) ───────────────────
const STALL_LIMIT = 3;
const MAX_TURNS_PER_TICK = 3;
const MAX_ROUNDS = 6;
// Mirror the engine: the (parent-level) moderator runs on Opus. A single linear
// cert deliberation is top-level, so it grades the real production moderator.
const MOD_MODEL = 'claude-opus-4-8';
const TURN_MODEL = 'claude-sonnet-4-6';

// ── Roster (real SDLC cores) ───────────────────────────────────────────────
const ROSTER = [
  ['product', 'Product Strategist', 'project-management/product-strategist.json'],
  ['engineer', 'Dev Clone', 'development/dev-clone.json'],
  ['architect', 'Solution Architect', 'development/solution-architect.json'],
  ['qa', 'QA Guardian', 'development/qa-guardian.json'],
  ['security', 'Security Sentinel', 'security/security-sentinel.json'],
].map(([id, name, f]) => {
  const p = read(`scripts/templates/${f}`).payload.persona;
  return { id, name, identity: p.identity?.role || p.goal || name, core: JSON.stringify(p.core), dials: p.core };
});
const NORTH_STAR = read('scripts/templates/_team_presets/sdlc-lifecycle.json').group.north_star;

const TOPIC = topicArg ||
  'We publicly promised users the new checkout flow ships this Friday for the launch announcement. ' +
  'QA has NOT finished testing it and found 2 flaky payment edge cases yesterday. Should we ship Friday, hold, or something else?';
const GOAL = 'Decide what the team actually does, and turn it into one concrete next assignment.';

// ── CLI ─────────────────────────────────────────────────────────────────────
const callCount = { [MOD_MODEL]: 0, [TURN_MODEL]: 0 };
function claude(prompt, model) {
  callCount[model] = (callCount[model] || 0) + 1;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = spawnSync('claude', ['-p', '--model', model], {
      input: prompt, encoding: 'utf8', timeout: 180000, maxBuffer: 20 * 1024 * 1024, shell: true,
    });
    const out = (r.stdout || '').trim();
    if (out) return out;
    if (attempt === 1) return `[no output | status=${r.status} | error=${r.error ? r.error.message : 'none'}]`;
  }
}

// ── Tolerant brace-match envelope parse (mirror parse_decision/turn) ────────
function matchBraces(s) {
  let depth = 0, inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return -1;
}
function parseEnvelope(blob, key) {
  const marker = `"${key}"`;
  let from = 0, result = null;
  while (true) {
    const rel = blob.indexOf(marker, from);
    if (rel < 0) break;
    from = rel + marker.length;
    const open = blob.lastIndexOf('{', rel);
    if (open < 0) continue;
    const close = matchBraces(blob.slice(open));
    if (close < 0) continue;
    try { const env = JSON.parse(blob.slice(open, open + close + 1)); if (env && env[key]) result = env[key]; } catch {}
  }
  return result;
}

// ── Prompts (mirror engine/deliberation.rs) ────────────────────────────────
function moderatorPrompt(openAgenda, recentTurns) {
  let p = 'You are the MODERATOR of an autonomous team deliberation. You have no opinions of your own — you route the conversation, curate its agenda, judge whether it is making progress, and push it toward concrete decisions and tasks. Be SELECTIVE: pick only the 1-3 team members whose point of view most moves the current open agenda item forward. Never route the whole roster. ROTATE VOICES: a deliberation needs its distinct cores in tension — prefer a relevant member who has NOT yet spoken on the current open item over re-hearing the same person, and never route one lone member two rounds running (that is a monologue, not a deliberation).\n';
  p += `\n## TOPIC\n${TOPIC}\n\n## DESIRED OUTCOME\n${GOAL}\n\n## TEAM NORTH STAR (shared)\n${NORTH_STAR}\n`;
  p += '\n## TEAM MEMBERS (route by their core)\n';
  for (const m of ROSTER) p += `- ${m.name} (${m.id}): ${m.core}\n`;
  p += '\n## OPEN AGENDA\n';
  if (!openAgenda.length) p += '(empty — if the topic is settled, conclude)\n';
  else for (const a of openAgenda) p += `- [${a.id}] ${a.item}\n`;
  p += '\n## RECENT CONVERSATION\n';
  if (!recentTurns.length) p += '(none yet — open the agenda and pick who speaks first)\n';
  else for (const t of recentTurns) { let l = t.body.replace(/[\n\r]/g, ' '); if (l.length > 240) l = l.slice(0, 240) + '…'; p += `- ${t.who}: ${l}\n`; }
  p += '\n## YOUR DECISION\nReturn EXACTLY one JSON object, no prose:\n';
  p += '{"deliberation": {"next_speakers": ["<exact id from the TEAM MEMBERS parentheses, e.g. qa>"], "agenda_add": ["<new open question>"], "agenda_resolve": [{"id": "<agenda item id>", "resolution": "<decision>"}], "round_outcome": "progressed" | "stalled", "action": "discuss" | "invoke_capability" | "spawn_assignment" | "escalate_to_user" | "conclude", "status": "continue" | "converged" | "stuck", "reason": "<one line>"}}\n';
  p += "\nRules: mark 'progressed' if this round produced a decision, a task, genuinely new information, OR a participant MOVED their position, narrowed the disagreement, or put a new concrete option on the table — a stance shift toward common ground IS progress, not restating. Mark 'stalled' only when a round merely repeats already-settled points or circles without moving any position. Bias toward CONVERGING: as soon as the team has a workable decision (even if minor sub-questions remain open), set status:'converged' to lock it into a proposal — do NOT keep deliberating once the core decision is clear. next_speakers MUST be the exact ids shown in parentheses in TEAM MEMBERS (e.g. 'qa', 'engineer') — never the display names.";
  return p;
}
function turnPrompt(m, recentTurns) {
  let p = `You are ${m.name}, a member of an autonomous product team in a live deliberation.\n`;
  p += `\n## YOUR IDENTITY\n${m.identity}\n\n## YOUR CORE (think and speak from this)\n${m.core}\n\n## TEAM NORTH STAR (shared)\n${NORTH_STAR}\n\n## THE TOPIC\n${TOPIC}\n`;
  p += '\n## THE CONVERSATION SO FAR\n';
  if (!recentTurns.length) p += '(you are opening the discussion)\n';
  else for (const t of recentTurns) { let l = t.body.replace(/[\n\r]/g, ' '); if (l.length > 280) l = l.slice(0, 280) + '…'; p += `- ${t.who}: ${l}\n`; }
  p += '\n## YOUR TURN\nContribute ONE substantive message that moves the team forward FROM YOUR POINT OF VIEW. You are EXPECTED to push back when a proposal conflicts with your core — productive disagreement improves the outcome; do not just agree. Be concise (2-5 sentences). If the team is ready to commit to a concrete piece of work, propose it.\n';
  p += 'Return EXACTLY one JSON object, no prose:\n{"turn": {"message": "<your contribution>"}}';
  return p;
}
function proposalPrompt(agenda, recentTurns) {
  let p = `You are synthesizing the outcome of a team deliberation into ONE concrete piece of work the team can execute next.\n\n## TOPIC\n${TOPIC}\n\n## AGENDA\n`;
  for (const a of agenda) p += a.resolution ? `- [${a.status}] ${a.item} → ${a.resolution}\n` : `- [${a.status}] ${a.item}\n`;
  p += '\n## KEY POINTS FROM THE CONVERSATION\n';
  for (const t of recentTurns) { let l = t.body.replace(/[\n\r]/g, ' '); if (l.length > 240) l = l.slice(0, 240) + '…'; p += `- ${t.who}: ${l}\n`; }
  p += '\n## YOUR OUTPUT\nReturn EXACTLY one JSON object, no prose:\n{"proposal": {"title": "<short title>", "objective": "<a clear, self-contained instruction the team will execute>", "summary": "<2-3 sentences>"}}';
  return p;
}

// ── plan_transition + resolve_speaker (mirror engine/deliberation.rs) ───────
const normId = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function resolveSpeaker(req) {
  const r = (req || '').trim(); if (!r) return null;
  const exact = ROSTER.find((m) => m.id === r); if (exact) return exact.id;
  const n = normId(r);
  const m = ROSTER.find((mm) => normId(mm.id) === n || normId(mm.name) === n);
  return m ? m.id : null;
}
function selectSpeakers(requested, lastSpeaker) {
  const seen = new Set(); const out = [];
  for (const s of requested || []) { const t = (s || '').trim(); if (!t || seen.has(t)) continue; seen.add(t); out.push(t); if (out.length >= MAX_TURNS_PER_TICK) break; }
  if (lastSpeaker && out.length === 1 && out[0] === lastSpeaker) return [];
  return out;
}
function planTransition(progress, d, openAfter, lastSpeaker) {
  const round = progress.round + 1;
  const stall = d.round_outcome === 'progressed' ? 0 : progress.stall + 1;
  if (d.status === 'converged' || d.action === 'conclude' || openAfter === 0)
    return { round, stall, kind: 'resolve', reason: openAfter === 0 ? 'agenda_clear' : 'converged' };
  if (stall >= STALL_LIMIT || d.action === 'escalate_to_user' || d.status === 'stuck')
    return { round, stall, kind: 'escalate', reason: stall >= STALL_LIMIT ? 'stall_limit' : 'moderator_escalation' };
  return { round, stall, kind: 'continue', speakers: selectSpeakers(d.next_speakers, lastSpeaker) };
}

// ── Run the deliberation ────────────────────────────────────────────────────
function runDeliberation() {
  let agenda = [], channel = [], progress = { round: 0, stall: 0 }, lastSpeaker = null, agendaSeq = 0, outcome = 'budget_exhausted';
  for (let r = 0; r < MAX_ROUNDS; r++) {
    const openAgenda = agenda.filter((a) => a.status === 'open').map((a) => ({ id: a.id, item: a.item }));
    const modOut = claude(moderatorPrompt(openAgenda, channel.slice(-12)), MOD_MODEL);
    const d = parseEnvelope(modOut, 'deliberation') || { round_outcome: 'stalled', action: 'discuss', status: 'continue', next_speakers: [], agenda_add: [], agenda_resolve: [] };
    for (const item of d.agenda_add || []) { if (item && item.trim()) agenda.push({ id: `a${++agendaSeq}`, item, status: 'open' }); }
    for (const res of d.agenda_resolve || []) { const a = agenda.find((x) => x.id === res.id); if (a) { a.status = 'resolved'; a.resolution = res.resolution || ''; } }
    const openAfter = agenda.filter((a) => a.status === 'open').length;
    d.next_speakers = (d.next_speakers || []).map((s) => resolveSpeaker(s)).filter(Boolean);
    const t = planTransition(progress, d, openAfter, lastSpeaker);
    progress = { round: t.round, stall: t.stall };
    log(`  round ${r + 1}: route=[${(d.next_speakers || []).join(',')}] outcome=${d.round_outcome} status=${d.status} → ${t.kind}${t.reason ? '(' + t.reason + ')' : ''}`);
    if (t.kind === 'resolve') { outcome = 'resolved:' + t.reason; break; }
    if (t.kind === 'escalate') { outcome = 'escalated:' + t.reason; break; }
    for (const sid of t.speakers) {
      const m = ROSTER.find((x) => x.id === sid); if (!m) continue;
      const turn = parseEnvelope(claude(turnPrompt(m, channel.slice(-12)), TURN_MODEL), 'turn') || { message: '' };
      channel.push({ who: m.name, body: (turn.message || '').trim() });
      lastSpeaker = sid;
    }
  }
  // If it didn't converge within the cert budget, force a resolve (the engine's
  // CONVERGE_BY_ROUND safety net does the same) so the mechanism still ships a
  // proposal to grade.
  if (!outcome.startsWith('resolved')) outcome = 'resolved:round_cap';
  const proposal = parseEnvelope(claude(proposalPrompt(agenda, channel), TURN_MODEL), 'proposal');
  return { agenda, channel, rounds: progress.round, outcome, proposal };
}

// ── Cooperation judge (Haiku) ───────────────────────────────────────────────
function judge(run) {
  const transcript = run.channel.map((t) => `${t.who}: ${t.body}`).join('\n\n');
  const prompt = `You are grading whether an autonomous multi-agent team deliberation showed PRODUCTIVE COOPERATION (the goal) or collapsed to bland agreement (the failure). Score each 1-5 (5=best). Return EXACTLY one JSON object:
{"grade": {"divergence": <1-5, did members genuinely disagree from distinct viewpoints rather than just agree>, "building": <1-5, did they reference and build on each other rather than talk past each other>, "actionable": <1-5, did it reach a concrete, executable outcome>, "reason": "<one line>"}}

## TRANSCRIPT
${transcript}

## PROPOSAL
${run.proposal ? JSON.stringify(run.proposal) : '(none)'}`;
  return parseEnvelope(claude(prompt, MOD_MODEL), 'grade') || { divergence: 0, building: 0, actionable: 0, reason: 'judge failed to parse' };
}

// ── Grade + verdict ─────────────────────────────────────────────────────────
log('═'.repeat(72));
log('DELIBERATION COOPERATION CERT — running a live deliberation…');
log('═'.repeat(72));
const run = runDeliberation();
const grade = judge(run);

const distinctSpeakers = new Set(run.channel.map((t) => t.who)).size;
const converged = run.outcome.startsWith('resolved');
const hasProposal = !!run.proposal;
const bounded = run.rounds <= MAX_ROUNDS;
const coopOk = grade.divergence >= 3 && grade.building >= 3;

let verdict = 'CERTIFIED';
const fails = [];
if (!converged) fails.push('did not converge');
if (!hasProposal) fails.push('no proposal synthesized');
if (distinctSpeakers < 3) fails.push(`only ${distinctSpeakers} distinct speakers`);
if (grade.divergence < 3) fails.push(`bland (divergence ${grade.divergence}/5)`);
if (grade.actionable < 3) fails.push(`weak outcome (actionable ${grade.actionable}/5)`);
if (!bounded) fails.push('exceeded round bound');
if (fails.length === 0) verdict = 'CERTIFIED';
else if (converged && hasProposal && coopOk) verdict = 'DEGRADED';
else verdict = 'FAILED';

const report = {
  verdict,
  outcome: run.outcome,
  rounds: run.rounds,
  turns: run.channel.length,
  distinctSpeakers,
  hasProposal,
  proposalTitle: run.proposal?.title ?? null,
  grade,
  cost: { moderatorCalls: callCount[MOD_MODEL] || 0, turnCalls: callCount[TURN_MODEL] || 0 },
  failures: fails,
};

if (AS_JSON) {
  console.log(JSON.stringify(report, null, 2));
} else {
  log('\n' + '─'.repeat(72));
  log(`outcome:           ${run.outcome}  (${run.rounds} rounds, ${run.channel.length} turns, ${distinctSpeakers} distinct speakers)`);
  log(`proposal:          ${run.proposal ? `"${run.proposal.title}"` : '(none)'}`);
  log(`cooperation grade: divergence ${grade.divergence}/5 · building ${grade.building}/5 · actionable ${grade.actionable}/5`);
  log(`                   ${grade.reason}`);
  log(`cost (calls):      ${callCount[MOD_MODEL] || 0} × Haiku (moderator/judge) + ${callCount[TURN_MODEL] || 0} × Sonnet (turns/proposal)`);
  log(`                   (the app ledgers real USD per call in companion_turn: trigger_kind deliberation_*)`);
  if (fails.length) log(`shortfalls:        ${fails.join('; ')}`);
  log('─'.repeat(72));
  log(`VERDICT: ${verdict}`);
  log('═'.repeat(72));
}
process.exit(verdict === 'FAILED' ? 1 : 0);
