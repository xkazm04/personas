#!/usr/bin/env node
// Decision Mirror — one-time (idempotent) prose backfill from local transcripts.
//
// The CLI prunes transcripts: as of the first run the oldest surviving message was
// ~5 weeks old, so the live UserPromptSubmit hook alone starts the corpus at zero
// and everything already written is lost on the next prune. This recovers what is
// still on disk into the durable ledger.
//
// Human prose is identified by promptSource ∈ {typed, suggestion_accepted, queued}.
// That field is the only reliable discriminator: userType is "external" for both
// humans and dispatched agents, and headless/SDK sessions inject prompts that look
// identical to typed ones apart from promptSource (they average 23k chars vs 342).
//
// Scope: this repo's transcript directory only, matching the personas-only ledger.
// Idempotent — re-running skips messages already present (keyed on transcript uuid).
//
// Usage: node scripts/decision-ledger/backfill-prose.mjs [--dry-run]

import { appendFileSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEDGER_DIR = join(REPO_ROOT, ".claude", "decision-ledger");
const HUMAN = new Set(["typed", "suggestion_accepted", "queued"]);
const DRY = process.argv.includes("--dry-run");

// Claude Code encodes the project path as a directory name: C:\Users\x\y -> C--Users-x-y
const projectDir = join(homedir(), ".claude", "projects", REPO_ROOT.replace(/[:\\/]/g, "-"));
if (!existsSync(projectDir)) {
  console.error(`No transcript directory for this repo at ${projectDir}`);
  process.exit(1);
}

// ── what is already captured (dedupe key = source uuid) ───────────────────
const seen = new Set();
mkdirSync(LEDGER_DIR, { recursive: true });
for (const f of readdirSync(LEDGER_DIR).filter((f) => /^prose-.*\.jsonl$/.test(f))) {
  for (const l of readFileSync(join(LEDGER_DIR, f), "utf8").split("\n")) {
    if (!l.trim()) continue;
    try {
      const e = JSON.parse(l);
      if (e.source_uuid) seen.add(e.source_uuid);
    } catch {}
  }
}

// ── redaction (kept in sync with capture-prose.mjs) ───────────────────────
const SECRETS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "anthropic-key"],
  [/\bsk-[A-Za-z0-9]{32,}\b/g, "openai-key"],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b/g, "github-token"],
  [/\bAIza[A-Za-z0-9_-]{35}\b/g, "google-key"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "slack-token"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "aws-key"],
  [/\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "jwt"],
  [/\b(?:hf|lin|sq0csp|rk_live|pk_live|sk_live)_[A-Za-z0-9_-]{20,}\b/g, "vendor-token"],
];
const KV = /\b([A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*["']?([^\s"'\n,;]{8,})/gi;
function redact(text) {
  let n = 0, out = text;
  for (const [re, label] of SECRETS) out = out.replace(re, () => { n++; return `[redacted:${label}]`; });
  out = out.replace(KV, (m, key, val) => {
    if (/^(your|the|a|an|null|undefined|xxx+|<.*>|\$\{.*\}|process\.env)/i.test(val)) return m;
    n++; return `${key}=[redacted:kv]`;
  });
  return { text: out, redactions: n };
}

// ── collect ───────────────────────────────────────────────────────────────
const collected = [];
for (const f of readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"))) {
  let lines;
  try {
    lines = readFileSync(join(projectDir, f), "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { continue; }

  for (let i = 0; i < lines.length; i++) {
    const o = lines[i];
    if (o.type !== "user" || o.isSidechain || !HUMAN.has(o.promptSource)) continue;
    const c = o.message?.content;
    let text = null;
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) { const t = c.find((b) => b.type === "text"); if (t) text = t.text; }
    if (!text) continue;
    text = text.trim();
    if (!text || text.startsWith("<")) continue;
    if (!o.uuid || seen.has(o.uuid)) continue;
    seen.add(o.uuid);

    // Derive the same turn-outcome shape the Stop hook produces, so backfilled
    // and live events are indistinguishable downstream.
    const tools = {}; const files = new Set();
    let subagents = 0, assistantChars = 0, thinking = 0;
    let endTs = o.timestamp;
    for (let j = i + 1; j < lines.length; j++) {
      const n = lines[j];
      if (n.type === "user" && !n.isSidechain && HUMAN.has(n.promptSource)) break;
      if (n.timestamp) endTs = n.timestamp;
      const nc = n.message?.content;
      if (!Array.isArray(nc)) continue;
      for (const b of nc) {
        if (b.type === "tool_use") {
          tools[b.name] = (tools[b.name] || 0) + 1;
          if (b.name === "Agent" || b.name === "Task") subagents++;
          const p = b.input?.file_path ?? b.input?.notebook_path;
          if (p && ["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(b.name)) {
            files.add(String(p).replace(REPO_ROOT, "").replace(/^[\\/]/, ""));
          }
        } else if (b.type === "text" && n.type === "assistant") assistantChars += (b.text ?? "").length;
        else if (b.type === "thinking") thinking++;
      }
    }
    const dur = o.timestamp && endTs ? Math.round((new Date(endTs) - new Date(o.timestamp)) / 1000) : null;
    const { text: redacted, redactions } = redact(text);
    const ts = o.timestamp ?? new Date().toISOString();

    collected.push({
      prompt: {
        schema: 1, ts, repo: basename(REPO_ROOT), kind: "prompt",
        source: "transcript-backfill", provenance: "human",
        id: `${o.sessionId ?? "nosession"}:${ts}`,
        source_uuid: o.uuid,
        session_id: o.sessionId ?? null,
        transcript_path: join(projectDir, f),
        cwd: o.cwd ?? null,
        git_branch: o.gitBranch ?? null,
        prompt_source: o.promptSource,
        is_slash_command: /^\//.test(text),
        chars: text.length, redactions, text: redacted,
      },
      outcome: {
        schema: 1, ts, repo: basename(REPO_ROOT), kind: "turn_outcome",
        source: "transcript-backfill", provenance: "derived",
        ref: `${o.sessionId ?? "nosession"}:${ts}`,
        source_uuid: o.uuid + ":outcome",
        session_id: o.sessionId ?? null, prompt_ts: ts,
        duration_s: dur != null && dur >= 0 && dur < 86400 ? dur : null,
        tools, tool_calls: Object.values(tools).reduce((a, b) => a + b, 0),
        files: [...files].slice(0, 60), files_touched: files.size,
        subagents, thinking_blocks: thinking, assistant_chars: assistantChars,
      },
    });
  }
}

collected.sort((a, b) => a.prompt.ts.localeCompare(b.prompt.ts));

if (!collected.length) {
  console.log("Nothing to backfill — every transcript message is already in the ledger.");
  process.exit(0);
}

const byMonth = {};
for (const { prompt, outcome } of collected) {
  const m = prompt.ts.slice(0, 7);
  (byMonth[m] ??= []).push(JSON.stringify(prompt), JSON.stringify(outcome));
}

const totalRedactions = collected.reduce((n, c) => n + c.prompt.redactions, 0);
const chars = collected.reduce((n, c) => n + c.prompt.chars, 0);
const slash = collected.filter((c) => c.prompt.is_slash_command).length;

console.log(`${DRY ? "[dry-run] would backfill" : "Backfilled"} ${collected.length} messages ` +
  `(${chars.toLocaleString()} chars, ${slash} slash-commands, ${totalRedactions} redactions)`);
console.log(`  window: ${collected[0].prompt.ts.slice(0, 10)} -> ${collected[collected.length - 1].prompt.ts.slice(0, 10)}`);
for (const [m, arr] of Object.entries(byMonth).sort()) {
  console.log(`  prose-${m}.jsonl  +${arr.length / 2} prompts +${arr.length / 2} outcomes`);
  if (!DRY) appendFileSync(join(LEDGER_DIR, `prose-${m}.jsonl`), arr.join("\n") + "\n", "utf8");
}
