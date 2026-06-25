// Headless two-persona CHAIN driver — our orchestration, Qwen engine.
// ===================================================================
// Demonstrates a cooperative chain A -> B where A's output feeds B's input,
// each persona running on its OWN engine/model ("any capacity"):
//
//   A = Comedian (drafts a joke)        -> qwen3-coder-plus  (fast, cheap)
//   B = Critic   (rates + improves it)  -> qwen3.7-plus      (deep reasoning)
//
// This mirrors the desktop's sequential connection edge (persona_team_connections)
// + Mode-A handoff, but runs in the worker so we can drive it headlessly.
//
// Usage:
//   node chain.mjs                                  # defaults below
//   node chain.mjs --topic "recursion"
//   node chain.mjs --modelA qwen3-coder-plus --modelB qwen3.7-plus
//   node chain.mjs --engineB claude                 # B via Anthropic protocol
//
// Exit 0 if the chain completes, 1 otherwise.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1]?.startsWith('--') ? true : arr[i + 1]]);
    return acc;
  }, []),
);

const BASE = (args.base || 'http://localhost:8080').replace(/\/+$/, '');
const KEY = args.key || 'poc-test';
const TOPIC = args.topic || 'recursion';
const H = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

function engineProfile(kind, model) {
  if (kind === 'claude' || kind === 'anthropic') {
    return {
      provider: 'anthropic',
      base_url: args.baseUrl || 'https://dashscope-intl.aliyuncs.com/apps/anthropic',
      model: model || 'qwen3-coder-plus',
    };
  }
  return { provider: 'qwen', model: model || 'qwen3-coder-plus' };
}

const A = {
  id: `chain-a-${Date.now().toString(36)}`,
  name: 'Comedian',
  systemPrompt:
    'You are a stand-up comedian. Tell exactly ONE short, clean programming joke. ' +
    'If an input topic is given, make the joke about it. Output only the joke, nothing else.',
  modelProfile: JSON.stringify(engineProfile(args.engineA || 'qwen', args.modelA || 'qwen3-coder-plus')),
};
const B = {
  id: `chain-b-${Date.now().toString(36)}`,
  name: 'Critic',
  systemPrompt:
    'You are a sharp comedy critic. You will receive a joke as input. ' +
    'Respond with exactly three lines:\nRating: <n>/10\nReason: <one sentence>\nImproved: <a funnier rewrite>',
  modelProfile: JSON.stringify(engineProfile(args.engineB || 'qwen', args.modelB || 'qwen3.7-plus')),
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
  console.log(`▶ chain : ${A.name} (${JSON.parse(A.modelProfile).provider}/${JSON.parse(A.modelProfile).model})` +
    `  ->  ${B.name} (${JSON.parse(B.modelProfile).provider}/${JSON.parse(B.modelProfile).model})`);
  console.log(`▶ topic : ${TOPIC}\n`);

  // 1) Create both personas (headless).
  for (const p of [A, B]) {
    await post('/api/personas', { ...p, description: 'chain PoC persona', enabled: true });
    console.log(`✓ created persona ${p.name}`);
  }

  // 2) Create the chain (A -> B).
  const chain = await post('/api/chains', {
    name: 'Comedian -> Critic',
    steps: [{ personaId: A.id }, { personaId: B.id }],
  });
  console.log(`✓ created chain (${chain.steps.map((s) => s.name).join(' -> ')})`);

  // 3) Execute with the topic as the seed input.
  const sub = await post(`/api/chains/${chain.id}/execute`, { input: TOPIC });
  console.log(`✓ executing chainExec ${sub.chainExecutionId}\n`);

  // 4) Poll to terminal.
  let ce;
  for (let i = 1; i <= 40; i++) {
    await sleep(1500);
    ce = await get(`/api/chain-executions/${sub.chainExecutionId}`);
    const summary = ce.steps.map((s) => `${s.name}:${s.status}`).join('  ');
    process.stdout.write(`  poll ${i}: ${ce.status}  [${summary}]            \r`);
    if (['completed', 'failed'].includes(ce.status)) break;
  }
  console.log('\n');

  // 5) Report each step + final.
  for (const s of ce.steps) {
    console.log(`── ${s.name}  [${s.engine || '-'}]  ${s.status}  ${s.durationMs}ms  $${(s.costUsd || 0).toFixed(6)}`);
    console.log((s.output || s.error || '(no output)').trim());
    console.log('');
  }
  const ok = ce.status === 'completed';
  console.log(`${ok ? '✅' : '❌'} chain ${ce.status}  ·  total $${(ce.totalCostUsd || 0).toFixed(6)}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
