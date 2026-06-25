// Headless PoC driver — create a persona, deploy it, run it, verify.
// ===================================================================
// Drives the cloud worker's API end to end with NO desktop GUI:
//   create persona (POST /api/personas)  →  deploy (POST /api/deployments)
//   →  execute (POST /api/execute, prompt omitted so the worker self-assembles)
//   →  poll (GET /api/executions/:id)  →  print result + cost + model.
//
// Exercises the engine wrapper: choose --engine qwen | claude. The "claude"
// engine uses the Anthropic Messages protocol; by default it points at Qwen's
// Anthropic-compatible endpoint so it runs on Qwen via that protocol (proving
// the wrapper handles both shapes). Point it at api.anthropic.com for real Claude.
//
// Usage:
//   node headless.mjs                         # engine=qwen (OpenAI protocol)
//   node headless.mjs --engine claude         # Anthropic protocol -> Qwen compat
//   node headless.mjs --base http://localhost:8080 --instruction "Tell a haiku about Rust"
//
// Exit code 0 on a completed run, 1 on failure — so it's CI/loop-friendly.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const BASE = (args.base || 'http://localhost:8080').replace(/\/+$/, '');
const ENGINE = (args.engine || 'qwen').toLowerCase();
const NAME = args.name || (ENGINE === 'claude' ? 'Comedian (Anthropic protocol)' : 'Comedian (Qwen)');
const INSTRUCTION =
  args.instruction ||
  'You are a comedian. Tell exactly one short, clean programming joke, then stop.';
const KEY = args.key || 'poc-test'; // any non-empty Bearer for the PoC

const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const personaId = `headless-${ENGINE}-${Date.now().toString(36)}`;

// modelProfile maps directly to the desktop ModelProfile struct. The worker
// routes on `provider`. We omit auth_token — the worker supplies the key from
// its own env (the key never travels from this driver).
const modelProfile =
  ENGINE === 'claude'
    ? {
        provider: 'anthropic',
        // Default to Qwen's Anthropic-compat endpoint so this runs on Qwen.
        // Swap to https://api.anthropic.com for real Claude.
        base_url: args.baseUrl || 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
        model: args.model || 'qwen3-coder-plus',
      }
    : {
        provider: 'qwen',
        model: args.model || 'qwen3-coder-plus',
        // base_url omitted -> worker uses its configured Qwen endpoint.
      };

async function post(path, body) {
  const r = await fetch(`${BASE}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${path} -> HTTP ${r.status}: ${await r.text()}`);
  return r.json().catch(() => ({}));
}
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  if (!r.ok) throw new Error(`GET ${path} -> HTTP ${r.status}: ${await r.text()}`);
  return r.json();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`▶ worker: ${BASE}`);
  console.log(`▶ engine: ${ENGINE}  (modelProfile.provider=${modelProfile.provider}, model=${modelProfile.model})`);

  // 1) Create the persona (headless — no GUI).
  await post('/api/personas', {
    id: personaId,
    name: NAME,
    description: 'Headless PoC persona',
    systemPrompt: INSTRUCTION,
    modelProfile: JSON.stringify(modelProfile), // desktop sends this as a JSON string
    enabled: true,
  });
  console.log(`✓ created persona ${personaId}`);

  // 2) Deploy it.
  const dep = await post('/api/deployments', { personaId, label: NAME, maxMonthlyBudgetUsd: 5 });
  console.log(`✓ deployed (slug=${dep.slug}, status=${dep.status})`);

  // 3) Execute — omit `prompt` so the worker assembles from the persona.
  const sub = await post('/api/execute', { personaId, input: args.input });
  console.log(`✓ submitted execution ${sub.executionId} (status=${sub.status})`);

  // 4) Poll to terminal.
  let poll;
  for (let i = 1; i <= 30; i++) {
    await sleep(1500);
    poll = await get(`/api/executions/${sub.executionId}?offset=0`);
    process.stdout.write(`  poll ${i}: ${poll.status}\r`);
    if (['completed', 'failed', 'cancelled', 'error'].includes(poll.status)) break;
  }
  console.log('');

  // 5) Report.
  const ok = poll.status === 'completed';
  console.log(`\n${ok ? '✅' : '❌'} status=${poll.status}  ${poll.durationMs}ms  $${(poll.totalCostUsd ?? 0).toFixed(6)}`);
  console.log('────── output ──────');
  console.log(poll.output.join('\n'));
  console.log('────────────────────');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
