#!/usr/bin/env node
/**
 * Studio battle-test harness — unattended quality stress-test for Athena's
 * web-build engine.
 *
 * Drives real build turns by spawning the local `claude` CLI DIRECTLY (same
 * subscription auth as the app, no Tauri/webview), faithfully replicating the
 * app's build session: same scaffold (`bun x create-next-app`), same system
 * prompt (the web-build doctrine + BUILD_PLAN / NEEDS_INPUT contract from
 * src-tauri/src/companion/session.rs), same model + effort (Opus 4.8 / xhigh).
 *
 * A SIMULATED non-technical user answers Athena's NEEDS_INPUT questions, so the
 * whole loop runs hands-off across many project types. Every turn is logged
 * (human .log + structured .jsonl) for prompt-tuning; generated code lands on
 * disk for quality review.
 *
 *   node scripts/studio-battle-test.mjs            # all projects (CONCURRENCY at a time)
 *   PROJECT=flux-landing node scripts/...          # one project (validation)
 *   MAX_TURNS=20 CONCURRENCY=3 node scripts/...
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, appendFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const CLAUDE = process.env.CLAUDE_BIN || 'C:/Users/kazda/.local/bin/claude.exe';
const BUN = process.env.BUN_BIN || 'bun';
const MODEL = process.env.BUILD_MODEL || 'claude-opus-4-8';
const EFFORT = process.env.BUILD_EFFORT || 'xhigh';
const USER_MODEL = process.env.USER_MODEL || 'claude-sonnet-4-6';
const MAX_TURNS = Number(process.env.MAX_TURNS || 16);
const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const TURN_TIMEOUT_MS = Number(process.env.TURN_TIMEOUT_MS || 20 * 60 * 1000);
const SCAFFOLD_TIMEOUT_MS = 6 * 60 * 1000;
const USER_TIMEOUT_MS = 3 * 60 * 1000;

const RUN_DIR = process.env.STUDIO_TEST_DIR || 'C:/Users/kazda/kiro/.studio-battle';
const PROJ_ROOT = join(RUN_DIR, 'projects');
const LOG_DIR = join(RUN_DIR, 'logs');
mkdirSync(PROJ_ROOT, { recursive: true });
mkdirSync(LOG_DIR, { recursive: true });

const DOCTRINE = readFileSync(join(ROOT, 'docs/concepts/web-build-best-practices.md'), 'utf8');

// Mirrors BUILD_PLAN_INSTRUCTION in src-tauri/src/companion/session.rs.
const INSTRUCTION = `
# Build plan — surface it
Maintain a short build plan following the doctrine's Spine, then a project-specific tail. Whenever the plan changes — you finish a phase, start one, or revise the set — emit it as the VERY LAST line of your reply, as ONE line of compact JSON (no code fence), in exactly this shape:
BUILD_PLAN: {"phases":[{"id":"vision","title":"Vision","status":"done","note":"short"},{"id":"foundation","title":"Foundation","status":"active","note":""}]}
- status is one of "done" | "active" | "pending"; exactly one phase is "active".
- Keep to <=8 phases, titles <=24 chars, notes <=40 chars. Only emit BUILD_PLAN when the plan actually changed.

# When to ask — this is the user's product, don't assume
Reserve questions for things ONLY THE USER KNOWS: real content (names, copy, projects, prices, contact details), target audience, brand voice, business model, or which real data/integration to wire. For those, STOP and ASK instead of inventing it — emit it as the VERY LAST line:
NEEDS_INPUT: <one short question, 1-2 sentences max; at most 2-3 plain options, no markdown>
Keep it short and skimmable — a non-technical person is answering, one focused question at a time. Make ALL low-stakes, reversible, or technical choices yourself (spacing, colours, layout, library choices). Do NOT ask which section/feature to build next, what order to work in, or for permission to keep going — those are YOUR calls; decide and proceed. Early on (vision, brand, audience, real content) lean toward asking; once those are settled, lean hard toward building.

# Rules
- Edit files directly with your tools; keep the change scoped to the request.
- Never run a dev/build/start command or install unrelated dependencies.
- Reply with a SHORT (1-2 sentence) summary of what changed, then the BUILD_PLAN line, then a NEEDS_INPUT line last if you need a decision. Don't over-explain or paste large diffs.`;

function systemPrompt(projectDir) {
  return (
    `You are Athena's web-build engine — a focused coding agent working inside the local web project at ${projectDir}. ` +
    `It is a Next.js + TypeScript + Tailwind app. Follow your web-build doctrine below for planning and quality.\n\n` +
    `===== WEB-BUILD DOCTRINE =====\n${DOCTRINE}\n===== END DOCTRINE =====\n${INSTRUCTION}`
  );
}

const AUTO_INSTRUCTION =
  'Continue building — take the next phase of your plan to a solid, real state, then update your BUILD_PLAN. Decide the order yourself and keep going; do NOT ask which feature to build next or for permission to continue. Only use NEEDS_INPUT for real content or a business/data decision you genuinely cannot make. If everything is built and polished, say so and mark all phases done.';

const PROJECTS = [
  {
    slug: 'flux-landing',
    vision:
      'A landing page for a developer tool called Flux that helps engineering teams ship faster. Modern, dark, a bit technical but clean. A hero, a few features, some social proof, and a sign-up call.',
  },
  {
    slug: 'sprout-marketing',
    vision:
      'A marketing page for a phone app called Sprout, a friendly habit tracker. Warm, colourful, approachable. Show the app, the main benefits, a couple of testimonials, simple pricing, and a download button.',
  },
  {
    slug: 'pulse-dashboard',
    vision:
      'A dashboard that reads from a small local SQLite database and shows charts — sales over time, top products, a few summary numbers. Clean and data-focused.',
  },
  {
    slug: 'pipeline-explainer',
    vision:
      'An animated page that explains how a fully automated LLM software-development pipeline works — idea, plan, code, test, ship — with smooth motion/animation as you scroll. Cinematic but clear.',
  },
  {
    slug: 'mindmap-canvas',
    vision:
      'An interactive canvas where I can build a mindmap — add nodes, connect them, drag them around, like a simple Figma-style whiteboard for brainstorming. Clean and intuitive.',
  },
];

const ts = () => new Date().toISOString().slice(11, 19);
function log(slug, msg) {
  appendFileSync(join(LOG_DIR, `${slug}.log`), `[${ts()}] ${msg}\n`);
  process.stdout.write(`[${ts()} ${slug}] ${String(msg).split('\n')[0].slice(0, 140)}\n`);
}
function jlog(slug, obj) {
  appendFileSync(join(LOG_DIR, `${slug}.jsonl`), JSON.stringify({ t: ts(), ...obj }) + '\n');
}

function run(cmd, args, { cwd, input, timeoutMs } = {}) {
  return new Promise((res) => {
    const child = spawn(cmd, args, { cwd });
    let out = '';
    let err = '';
    const to = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      res({ code: -1, out, err: err + '\n[TIMEOUT]' });
    }, timeoutMs || TURN_TIMEOUT_MS);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
    child.on('close', (code) => {
      clearTimeout(to);
      res({ code, out, err });
    });
    child.on('error', (e) => {
      clearTimeout(to);
      res({ code: -1, out, err: String(e) });
    });
  });
}

// Parse trailing BUILD_PLAN / NEEDS_INPUT markers out of the reply (mirrors
// webbuild::plan::extract_build_turn).
function extractMarkers(text) {
  let phases = null;
  let question = null;
  const kept = [];
  for (const line of (text || '').split('\n')) {
    const t = line.replace(/^\s+/, '');
    if (t.startsWith('BUILD_PLAN:')) {
      if (!phases) {
        try {
          const env = JSON.parse(t.slice('BUILD_PLAN:'.length).trim());
          if (Array.isArray(env.phases) && env.phases.length) phases = env.phases;
        } catch {
          /* malformed — strip anyway */
        }
      }
      continue;
    }
    if (t.startsWith('NEEDS_INPUT:')) {
      if (!question) {
        const q = t.slice('NEEDS_INPUT:'.length).trim();
        if (q) question = q;
      }
      continue;
    }
    kept.push(line);
  }
  return { reply: kept.join('\n').trim(), phases, question };
}

async function scaffold(project) {
  project.dir = join(PROJ_ROOT, project.slug);
  if (existsSync(join(project.dir, 'package.json'))) {
    log(project.slug, 'scaffold: already present, skipping');
    return true;
  }
  log(project.slug, 'scaffold: bun x create-next-app …');
  const { code, err } = await run(
    BUN,
    [
      'x',
      'create-next-app@latest',
      project.dir,
      '--ts',
      '--tailwind',
      '--eslint',
      '--app',
      '--no-src-dir',
      '--import-alias',
      '@/*',
      '--use-bun',
      '--turbopack',
      '--yes',
    ],
    { cwd: PROJ_ROOT, timeoutMs: SCAFFOLD_TIMEOUT_MS },
  );
  const ok = code === 0 && existsSync(join(project.dir, 'package.json'));
  if (!ok) log(project.slug, `scaffold FAILED (code ${code}): ${err.slice(-300)}`);
  return ok;
}

async function buildTurn(project, message) {
  const promptFile = join(LOG_DIR, `${project.slug}.system.txt`);
  writeFileSync(promptFile, systemPrompt(project.dir));
  const args = [
    '-p',
    '-',
    '--output-format',
    'json',
    '--dangerously-skip-permissions',
    '--model',
    MODEL,
    '--effort',
    EFFORT,
    '--system-prompt-file',
    promptFile,
  ];
  if (project.sessionId) args.push('--resume', project.sessionId);
  const { code, out, err } = await run(CLAUDE, args, {
    cwd: project.dir,
    input: message,
    timeoutMs: TURN_TIMEOUT_MS,
  });
  let result = '';
  try {
    const obj = JSON.parse(out);
    result = obj.result || '';
    if (obj.session_id) project.sessionId = obj.session_id;
    if (obj.is_error) log(project.slug, `turn is_error: ${result.slice(0, 200)}`);
  } catch {
    log(project.slug, `turn parse fail (code ${code}); stderr=${err.slice(-200)} out=${out.slice(0, 200)}`);
  }
  const { reply, phases, question } = extractMarkers(result);
  if (phases) project.phases = phases;
  return { reply, phases, question, raw: result };
}

async function simulateUser(project, question) {
  const prompt =
    `You are a NON-TECHNICAL founder building this website with an AI developer (Athena):\n\n"${project.vision}"\n\n` +
    `Athena needs ONE decision from you. Answer in 1-2 plain, decisive sentences — make a reasonable choice a ` +
    `non-technical person would make from the vision. Do NOT ask anything back, do NOT give technical specs; ` +
    `just decide clearly so she can keep building.\n\nAthena's question:\n${question}`;
  const { out } = await run(
    CLAUDE,
    ['-p', '-', '--output-format', 'json', '--model', USER_MODEL],
    { cwd: ROOT, input: prompt, timeoutMs: USER_TIMEOUT_MS },
  );
  try {
    return (JSON.parse(out).result || '').trim() || 'Use your best judgement and keep it simple.';
  } catch {
    return 'Use your best judgement and keep it simple.';
  }
}

const planDone = (p) =>
  Array.isArray(p.phases) && p.phases.length > 0 && p.phases.every((x) => x.status === 'done');

async function driveProject(project) {
  log(project.slug, `=== START === ${project.vision}`);
  if (!(await scaffold(project))) {
    log(project.slug, '=== ABORTED (scaffold failed) ===');
    return;
  }
  let msg = `Here's the project vision:\n\n${project.vision}\n\nPlan it out (emit your BUILD_PLAN), then start building — the foundation first, then the most important section. Keep me posted in a sentence or two.`;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const r = await buildTurn(project, msg);
    const done = r.phases ? `${r.phases.filter((x) => x.status === 'done').length}/${r.phases.length}` : '-';
    log(project.slug, `turn ${turn} | plan ${done} | ${r.question ? 'QUESTION' : 'built'} | ${r.reply.slice(0, 120)}`);
    jlog(project.slug, { turn, reply: r.reply, phases: r.phases, question: r.question });
    if (r.question) {
      const answer = await simulateUser(project, r.question);
      log(project.slug, `Q: ${r.question}\nA(sim-user): ${answer}`);
      jlog(project.slug, { turn, simUserAnswer: answer });
      msg = answer;
      continue;
    }
    if (planDone(project)) {
      log(project.slug, '=== DONE (plan complete) ===');
      break;
    }
    msg = AUTO_INSTRUCTION;
  }
  log(project.slug, `=== END (session ${project.sessionId || '?'}) ===`);
}

async function pool(items, n, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

async function main() {
  // STUDIO_VISIONS=<file> points at a JSON array of {slug, vision} for any
  // project set (multi-day runs); otherwise the default 5.
  const all = process.env.STUDIO_VISIONS
    ? JSON.parse(readFileSync(process.env.STUDIO_VISIONS, 'utf8'))
    : PROJECTS;
  const only = process.env.PROJECT;
  const list = only ? all.filter((p) => p.slug === only) : all;
  log('main', `battle-test: ${list.map((p) => p.slug).join(', ')} | model=${MODEL} effort=${EFFORT} maxTurns=${MAX_TURNS} concurrency=${CONCURRENCY}`);
  await pool(list, CONCURRENCY, driveProject);
  log('main', '=== ALL DONE ===');
}

main().catch((e) => {
  log('main', 'FATAL ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
