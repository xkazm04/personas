// Personas Cloud Worker — Path A proof-of-concept
// ===================================================================
// A minimal HTTP server that implements the *same contract* the desktop
// app's `CloudClient` already speaks (src-tauri/src/cloud/client.rs), but
// runs inference on **Qwen cloud** (Alibaba Model Studio / DashScope)
// instead of Claude.
//
// Goal of this PoC: prove the two-way spine end to end —
//   desktop  →  deploy persona  →  execute  →  Qwen  →  report back  →  desktop
// — using a no-credentials, no-tools "joke" persona, which is provably safe
// (a single LLM text turn: no shell, no filesystem, no MCP, nothing that can
// touch the local machine; the only secret is THIS worker's DashScope key).
//
// Zero dependencies — Node 18+ built-ins only (node:http, global fetch,
// crypto.randomUUID). Run with:  node server.mjs
//
// Contract reference (what each endpoint must return) lives in:
//   src-tauri/src/cloud/client.rs        (request/response shapes, camelCase)
//   src-tauri/src/cloud/runner.rs        (poll loop + terminal status strings)
//   src-tauri/src/commands/infrastructure/cloud.rs  (connect / execute flow)

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// ------------------------------------------------------------------
// Minimal .env loader (zero-dep). Populates process.env WITHOUT overriding
// vars already set in the shell. Supports KEY=VALUE, # comments, optional
// surrounding quotes.
// ------------------------------------------------------------------
function parseEnvFile(path, allow /* Set<string> | null */) {
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!key || (allow && !allow.has(key))) continue;
      let val = line.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    // Missing file — fine, fall through (MOCK mode if no key ends up set).
  }
}

function loadEnv() {
  const here = dirname(fileURLToPath(import.meta.url));
  // 1) The worker's own .env (all keys — it's dedicated to this worker).
  parseEnvFile(join(here, '.env'), null);
  // 2) Fallback: the repo-root .env one level up — but ONLY Qwen-related keys,
  //    so we never pull unrelated project secrets into this worker process.
  parseEnvFile(join(here, '..', '.env'),
    new Set(['QWEN_API_KEY', 'DASHSCOPE_API_KEY', 'QWEN_BASE_URL', 'QWEN_MODEL', 'PORT']));
}
loadEnv();

// ------------------------------------------------------------------
// Config (all overridable via env — see .env.example)
// ------------------------------------------------------------------
const PORT = Number(process.env.PORT || 8080);

// Qwen Cloud (qwencloud.com) OpenAI-compatible endpoint. Verified current
// June-2026: the qwencloud.com quickstart still connects via this DashScope
// base URL + DASHSCOPE_API_KEY. Get a general (sk-...) key at
// https://home.qwencloud.com/api-keys. Default = Singapore/international.
//   US:      https://dashscope-us.aliyuncs.com/compatible-mode/v1
//   Beijing: https://dashscope.aliyuncs.com/compatible-mode/v1
// NOTE: the cheaper "Coding Plan" subscription (sk-sp-... keys) does NOT work
// here — it's only for interactive CLIs (Claude Code / qwen-code), not custom
// backends like this worker. This worker is pay-as-you-go (Token Plan).
const QWEN_BASE_URL =
  process.env.QWEN_BASE_URL ||
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// Default kept at a verified-priced SKU (see PRICING) so the cost stamp is
// accurate. Current Qwen Cloud examples use qwen3.7-plus / qwen3.6-plus —
// override via QWEN_MODEL (their per-token price is unconfirmed, see .env.example).
const QWEN_MODEL = process.env.QWEN_MODEL || 'qwen3-coder-plus';
// Accept either name — qwencloud.com calls it DASHSCOPE_API_KEY; QWEN_API_KEY
// is a convenience alias.
const DASHSCOPE_API_KEY =
  process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || '';

// When no DashScope key is set we run in MOCK mode: a canned joke is returned
// instead of calling Qwen. This lets you validate the desktop<->worker
// transport spine with zero external dependencies, then flip to real Qwen by
// setting DASHSCOPE_API_KEY. Force mock anytime with MOCK=1.
const MOCK = process.env.MOCK === '1' || !DASHSCOPE_API_KEY;

// Per-1M-token USD pricing (verified Sep-2025 SKUs; confirm newer SKUs against
// https://www.alibabacloud.com/help/en/model-studio/model-pricing before relying on cost).
// Models with no entry get a $0 cost stamp (e.g. Claude SKUs — add as needed).
const PRICING = {
  'qwen3-coder-plus': { in: 0.65, out: 3.25 },
  'qwen3-max': { in: 0.78, out: 3.9 },
};
const priceFor = (model) => PRICING[model] || null;

// ------------------------------------------------------------------
// In-memory state (a real worker would use a DB; fine for a PoC)
// ------------------------------------------------------------------
/** @type {Map<string, any>} job state keyed by execution id */
const jobs = new Map();
/** @type {any[]} */
const deployments = [];
/** @type {Map<string, any>} stored persona definitions keyed by id */
const personas = new Map();
/** @type {Map<string, any>} chain definitions keyed by id */
const chains = new Map();
/** @type {Map<string, any>} chain execution state keyed by id */
const chainExecutions = new Map();

const now = () => new Date().toISOString();
const slugify = (s) =>
  (s || 'persona')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 48) || 'persona';

// ==================================================================
// Engine wrapper — Claude / Qwen behind one interface
// ==================================================================
// A persona carries a `modelProfile` (the desktop's ModelProfile:
// { provider, model, base_url, auth_token, ... }). We route on `provider`:
//   - "qwen" / "dashscope" / (default) -> OpenAI-compatible protocol
//   - "claude" / "anthropic"           -> Anthropic Messages (/v1/messages)
// The Anthropic path works against BOTH api.anthropic.com AND Qwen's
// Anthropic-compatible endpoint (…/apps/anthropic) — so "the Claude option"
// can run on real Claude or on Qwen-via-Anthropic-protocol just by base_url.
function resolveEngine(modelProfile) {
  let mp = modelProfile || {};
  if (typeof mp === 'string') {
    try { mp = JSON.parse(mp); } catch { mp = {}; }
  }
  const provider = String(mp.provider || 'qwen').toLowerCase();
  if (provider === 'claude' || provider === 'anthropic') {
    return {
      provider,
      protocol: 'anthropic',
      baseUrl: (mp.base_url || 'https://api.anthropic.com').replace(/\/+$/, ''),
      model: mp.model || 'claude-sonnet-4-6',
      // Fall back to the Qwen key so a "claude" persona pointed at Qwen's
      // Anthropic-compat endpoint works without a separate Anthropic key.
      apiKey: mp.auth_token || process.env.ANTHROPIC_API_KEY || DASHSCOPE_API_KEY || '',
    };
  }
  return {
    provider,
    protocol: 'openai',
    baseUrl: (mp.base_url || QWEN_BASE_URL).replace(/\/+$/, ''),
    model: mp.model || QWEN_MODEL,
    apiKey: mp.auth_token || DASHSCOPE_API_KEY || '',
  };
}

async function callOpenAI(engine, prompt) {
  const resp = await fetch(`${engine.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${engine.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: engine.model,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`${engine.provider} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  return {
    text: data.choices?.[0]?.message?.content ?? '(empty response)',
    inTok: data.usage?.prompt_tokens ?? Math.ceil(prompt.length / 4),
    outTok: data.usage?.completion_tokens ?? 0,
  };
}

async function callAnthropic(engine, prompt) {
  const resp = await fetch(`${engine.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': engine.apiKey, // real Anthropic
      Authorization: `Bearer ${engine.apiKey}`, // Qwen Anthropic-compat (ANTHROPIC_AUTH_TOKEN)
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: engine.model,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`anthropic HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  const text = Array.isArray(data.content)
    ? data.content.map((b) => b.text || '').join('')
    : data.content?.[0]?.text ?? '';
  return {
    text: text || '(empty response)',
    inTok: data.usage?.input_tokens ?? Math.ceil(prompt.length / 4),
    outTok: data.usage?.output_tokens ?? 0,
  };
}

// Reusable inference core — one LLM turn through the engine wrapper. Returns
// { text, inTok, outTok, costUsd, durationMs, model } or throws. Shared by the
// single-execution path and each chain step.
async function executeInference(engine, prompt) {
  const t0 = Date.now();
  let res;
  if (!engine.apiKey) {
    // No key for this engine -> mock, so the flow still completes.
    res = {
      text:
        'Why do programmers prefer dark mode?\nBecause light attracts bugs.\n' +
        `\n[mock — no API key configured for engine "${engine.provider}"]`,
      inTok: Math.ceil(prompt.length / 4),
      outTok: 24,
    };
    await new Promise((r) => setTimeout(r, 400));
  } else {
    res =
      engine.protocol === 'anthropic'
        ? await callAnthropic(engine, prompt)
        : await callOpenAI(engine, prompt);
  }
  const price = priceFor(engine.model);
  const costUsd = price ? (res.inTok / 1e6) * price.in + (res.outTok / 1e6) * price.out : 0;
  return { ...res, costUsd, durationMs: Date.now() - t0, model: engine.model };
}

async function runInference(jobId, prompt, engine) {
  const job = jobs.get(jobId);
  if (!job) return;
  try {
    const r = await executeInference(engine, prompt);
    if (job.status === 'cancelled') return; // cancelled while in flight
    job.output = r.text.split('\n');
    job.costUsd = r.costUsd;
    job.model = r.model;
    job.durationMs = r.durationMs;
    job.completedAt = now();
    job.status = 'completed';
    log(`exec ${jobId} completed via ${engine.provider}/${engine.model} (${r.outTok} out tok, $${r.costUsd.toFixed(6)})`);
  } catch (err) {
    if (job.status === 'cancelled') return;
    job.output = [`Inference failed: ${err.message}`];
    job.completedAt = now();
    job.error = err.message;
    job.status = 'failed'; // desktop maps failed/cancelled/error -> failure
    log(`exec ${jobId} FAILED (${engine.provider}): ${err.message}`);
  }
}

// ==================================================================
// Chain orchestration — sequential A -> B -> ... (our orchestration,
// Qwen engine). Each step resolves its OWN engine from its persona's
// modelProfile, so a chain can mix models/providers per step ("any
// capacity"). Output of step N is forwarded as input to step N+1.
// On a step failure, remaining steps cascade-skip and the chain fails.
// ==================================================================
async function runChain(chainExecId) {
  const ce = chainExecutions.get(chainExecId);
  if (!ce) return;
  let carry = ce.input || '';
  for (const step of ce.steps) {
    const persona = personas.get(step.personaId);
    const engine = resolveEngine(persona?.modelProfile ?? persona?.model_profile);
    const sys = persona?.systemPrompt || persona?.system_prompt || 'You are a helpful assistant.';
    const prompt = carry.trim()
      ? `${sys}\n\nInput from the previous step:\n${carry}`
      : `${sys}\n\nBegin now.`;
    step.status = 'running';
    step.engine = `${engine.provider}/${engine.model}`;
    try {
      const r = await executeInference(engine, prompt);
      step.output = r.text;
      step.model = r.model;
      step.costUsd = r.costUsd;
      step.durationMs = r.durationMs;
      step.status = 'completed';
      ce.totalCostUsd += r.costUsd;
      carry = r.text; // forward to next step
      log(`chain ${chainExecId} step "${step.name}" done via ${step.engine} ($${r.costUsd.toFixed(6)})`);
    } catch (err) {
      step.status = 'failed';
      step.error = err.message;
      for (const s of ce.steps) if (s.status === 'pending') s.status = 'skipped';
      ce.status = 'failed';
      ce.completedAt = now();
      log(`chain ${chainExecId} FAILED at step "${step.name}": ${err.message}`);
      return;
    }
  }
  ce.finalOutput = carry;
  ce.status = 'completed';
  ce.completedAt = now();
  log(`chain ${chainExecId} completed (${ce.steps.length} steps, $${ce.totalCostUsd.toFixed(6)})`);
}

// ------------------------------------------------------------------
// HTTP helpers
// ------------------------------------------------------------------
function send(res, status, body) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

const log = (msg) => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

// ------------------------------------------------------------------
// Router — implements the subset of the CloudClient contract needed
// for the deploy → execute → poll round-trip.
// ------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const method = req.method;

  // --- Auth: accept any non-empty Bearer token for the PoC.
  // (cloud/client.rs sends `Authorization: Bearer <api_key>` on every call.)
  if (path !== '/health') {
    const auth = req.headers['authorization'] || '';
    if (!auth.startsWith('Bearer ') || auth.slice(7).trim() === '') {
      return send(res, 401, { error: 'Missing or empty Bearer token' });
    }
  }

  try {
    // 1) Reachability check (cloud_connect verifies this + that `status` exists)
    if (method === 'GET' && path === '/health') {
      return send(res, 200, { status: 'ok' });
    }

    // 2) Orchestrator status (status panel)
    if (method === 'GET' && path === '/api/status') {
      return send(res, 200, {
        workerCounts: { idle: 1, executing: 0, disconnected: 0 },
        queueLength: 0,
        activeExecutions: [...jobs.values()].filter((j) => j.status === 'running')
          .length,
        hasClaudeToken: true,
      });
    }

    // 3) Persona upsert/create — store it so headless execute can self-assemble
    //    a prompt from systemPrompt (the desktop path still sends prompt inline).
    if (method === 'POST' && path === '/api/personas') {
      const body = await readBody(req);
      if (body.id) personas.set(body.id, body);
      const eng = resolveEngine(body.modelProfile ?? body.model_profile);
      log(`upsert persona "${body.name ?? body.id ?? 'unknown'}" engine=${eng.provider}/${eng.model}`);
      return send(res, 200, { ok: true });
    }

    // 4) Create deployment
    if (method === 'POST' && path === '/api/deployments') {
      const body = await readBody(req);
      const dep = {
        id: randomUUID(),
        projectId: 'poc',
        personaId: body.personaId,
        slug: slugify(body.label || body.personaId),
        label: body.label || body.personaId,
        status: 'active',
        webhookEnabled: false,
        webhookSecret: null,
        invocationCount: 0,
        lastInvokedAt: null,
        maxMonthlyBudgetUsd: body.maxMonthlyBudgetUsd ?? null,
        currentMonthCostUsd: 0,
        budgetMonth: now().slice(0, 7),
        createdAt: now(),
        updatedAt: now(),
      };
      deployments.push(dep);
      log(`deployed "${dep.label}" (slug=${dep.slug})`);
      return send(res, 200, dep);
    }

    // 5) List deployments (dashboard)
    if (method === 'GET' && path === '/api/deployments') {
      return send(res, 200, deployments);
    }

    // Deployment lifecycle (so dashboard buttons don't error)
    const depMatch = path.match(/^\/api\/deployments\/([^/]+)(\/pause|\/resume)?$/);
    if (depMatch) {
      const dep = deployments.find((d) => d.id === depMatch[1]);
      if (!dep) return send(res, 404, { error: 'deployment not found' });
      if (method === 'POST' && depMatch[2] === '/pause') {
        dep.status = 'paused';
        dep.updatedAt = now();
        return send(res, 200, dep);
      }
      if (method === 'POST' && depMatch[2] === '/resume') {
        dep.status = 'active';
        dep.updatedAt = now();
        return send(res, 200, dep);
      }
      if (method === 'DELETE') {
        deployments.splice(deployments.indexOf(dep), 1);
        return send(res, 200, { ok: true });
      }
      if (method === 'GET') return send(res, 200, dep);
    }

    // 6) Submit execution — resolve engine from the persona, kick off, return.
    if (method === 'POST' && path === '/api/execute') {
      const body = await readBody(req);
      const persona = body.personaId ? personas.get(body.personaId) : null;
      const engine = resolveEngine(persona?.modelProfile ?? persona?.model_profile);

      // Prompt: the desktop sends the fully assembled prompt inline; headless
      // callers can omit it and we assemble from the stored persona.
      let prompt = body.prompt;
      if (!prompt) {
        const sys =
          persona?.systemPrompt || persona?.system_prompt || 'You are a helpful assistant.';
        prompt = body.input ? `${sys}\n\nUser input:\n${body.input}` : `${sys}\n\nBegin now.`;
      }

      const id = randomUUID();
      jobs.set(id, {
        status: 'running',
        output: [],
        costUsd: 0,
        durationMs: 0,
        model: engine.model,
        personaId: body.personaId || 'unknown',
        createdAt: now(),
        completedAt: null,
        error: null,
      });
      const dep = deployments.find((d) => d.personaId === body.personaId);
      if (dep) {
        dep.invocationCount += 1;
        dep.lastInvokedAt = now();
      }
      log(
        `execute persona=${body.personaId} exec=${id} via ${engine.provider}/${engine.model}` +
          (engine.apiKey ? '' : ' (no key -> mock)'),
      );
      runInference(id, prompt, engine); // async, do not await
      return send(res, 200, { executionId: id, status: 'queued' });
    }

    // 7) Poll execution (the desktop diffs `output` against `totalOutputLines`)
    const execMatch = path.match(/^\/api\/executions\/([^/]+)(\/cancel)?$/);
    if (execMatch) {
      const job = jobs.get(execMatch[1]);
      if (!job) return send(res, 404, { error: 'execution not found' });
      if (method === 'POST' && execMatch[2] === '/cancel') {
        if (job.status === 'running') job.status = 'cancelled';
        return send(res, 200, { ok: true });
      }
      if (method === 'GET') {
        return send(res, 200, {
          executionId: execMatch[1],
          status: job.status,
          output: job.output,
          totalOutputLines: job.output.length,
          durationMs: job.durationMs,
          totalCostUsd: job.costUsd,
        });
      }
    }

    // Execution history (history panel) — minimal CloudExecution shape.
    if (method === 'GET' && path === '/api/executions') {
      const list = [...jobs.entries()].map(([id, j]) => ({
        id,
        personaId: j.personaId,
        status: j.status,
        errorMessage: j.error,
        durationMs: j.durationMs,
        costUsd: j.costUsd,
        completedAt: j.completedAt,
        createdAt: j.createdAt,
      }));
      return send(res, 200, list);
    }

    // --- Chain orchestration (our orchestration, Qwen engine) ---

    // Create a chain: ordered persona steps. body: { name, steps:[{personaId,name?}] }
    if (method === 'POST' && path === '/api/chains') {
      const body = await readBody(req);
      const steps = (body.steps || []).map((s, i) => ({
        stepId: `s${i + 1}`,
        personaId: s.personaId,
        name: s.name || personas.get(s.personaId)?.name || s.personaId,
      }));
      if (steps.length === 0) return send(res, 400, { error: 'chain needs at least one step' });
      const chain = { id: randomUUID(), name: body.name || 'chain', steps, createdAt: now() };
      chains.set(chain.id, chain);
      log(`created chain "${chain.name}" (${steps.length} steps: ${steps.map((s) => s.name).join(' -> ')})`);
      return send(res, 200, chain);
    }

    if (method === 'GET' && path === '/api/chains') {
      return send(res, 200, [...chains.values()]);
    }

    // Execute a chain: body { input } -> kicks off A -> B -> ...
    const chainExecMatch = path.match(/^\/api\/chains\/([^/]+)\/execute$/);
    if (method === 'POST' && chainExecMatch) {
      const chain = chains.get(chainExecMatch[1]);
      if (!chain) return send(res, 404, { error: 'chain not found' });
      const body = await readBody(req);
      const id = randomUUID();
      chainExecutions.set(id, {
        id,
        chainId: chain.id,
        status: 'running',
        input: body.input || '',
        steps: chain.steps.map((s) => ({
          stepId: s.stepId,
          name: s.name,
          personaId: s.personaId,
          status: 'pending',
          output: '',
          engine: null,
          model: null,
          costUsd: 0,
          durationMs: 0,
          error: null,
        })),
        finalOutput: '',
        totalCostUsd: 0,
        createdAt: now(),
        completedAt: null,
      });
      log(`execute chain "${chain.name}" chainExec=${id}`);
      runChain(id); // async, do not await
      return send(res, 200, { chainExecutionId: id, status: 'running' });
    }

    // Poll a chain execution.
    const chainPollMatch = path.match(/^\/api\/chain-executions\/([^/]+)$/);
    if (method === 'GET' && chainPollMatch) {
      const ce = chainExecutions.get(chainPollMatch[1]);
      if (!ce) return send(res, 404, { error: 'chain execution not found' });
      return send(res, 200, ce);
    }

    return send(res, 404, { error: `No route for ${method} ${path}` });
  } catch (err) {
    log(`ERROR handling ${method} ${path}: ${err.message}`);
    return send(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  log(`Personas Cloud Worker listening on http://localhost:${PORT}`);
  log(`Default engine: ${MOCK ? 'MOCK (no Qwen key)' : `qwen / ${QWEN_MODEL} @ ${QWEN_BASE_URL}`}`);
  log(`Engine wrapper: persona modelProfile.provider routes qwen(OpenAI) | claude(Anthropic)`);
  log(`Connect the desktop Cloud tab to: http://localhost:${PORT}  (any API key)`);
});
