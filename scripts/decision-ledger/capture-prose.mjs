#!/usr/bin/env node
// Decision Mirror — Phase 1c prose capture (docs/concepts/decision-mirror.md).
//
// The third capture channel. Where capture-decision.mjs records what the operator
// CHOSE (structured selects) and what he CORRECTED (journaled overrides), this
// records what he WROTE, plus what the turn did in response. Prompt alone shows
// how he communicates; prompt paired with its outcome shows how he thinks.
//
// One script, two hook events, dispatched on payload.hook_event_name:
//
//   UserPromptSubmit -> {kind:"prompt"}       verbatim text, redacted, per message
//   Stop             -> {kind:"turn_outcome"} what the turn did, ref'd to that prompt
//
// Ledger: .claude/decision-ledger/prose-YYYY-MM.jsonl — append-only, gitignored,
// a SEPARATE stream from events-*.jsonl so the Phase 3 decision consumer is
// untouched by prose volume. Scope is personas-only, matching the decision ledger.
//
// CRITICAL: on UserPromptSubmit, anything this script prints to stdout is injected
// into the model's context. It must stay silent on every path, and must never fail
// the hook — every error exits 0.

import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEDGER_DIR = join(REPO_ROOT, ".claude", "decision-ledger");
const SCHEMA = 1;

function ledgerFile(ts) {
  return join(LEDGER_DIR, `prose-${ts.slice(0, 7)}.jsonl`);
}

function append(event) {
  mkdirSync(LEDGER_DIR, { recursive: true });
  appendFileSync(ledgerFile(event.ts), JSON.stringify(event) + "\n", "utf8");
}

function readCurrent(ts) {
  const f = ledgerFile(ts);
  if (!existsSync(f)) return [];
  return readFileSync(f, "utf8").split("\n").filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

// ── redaction ─────────────────────────────────────────────────────────────
// Targeted patterns only. Deliberately NOT redacting generic 40-char hex: the
// operator pastes git SHAs constantly and mangling them would corrupt the prose
// we are trying to study.
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
// KEY=value / KEY: value where the key name looks secret-bearing.
const KV = /\b([A-Z0-9_]*(?:API_?KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*)\s*[=:]\s*["']?([^\s"'\n,;]{8,})/gi;

function redact(text) {
  let n = 0;
  let out = text;
  for (const [re, label] of SECRETS) {
    out = out.replace(re, () => { n++; return `[redacted:${label}]`; });
  }
  out = out.replace(KV, (_m, key, val) => {
    if (/^(your|the|a|an|null|undefined|xxx+|<.*>|\$\{.*\}|process\.env)/i.test(val)) return _m;
    n++;
    return `${key}=[redacted:kv]`;
  });
  return { text: out, redactions: n };
}

// ── handlers ──────────────────────────────────────────────────────────────
function onPrompt(payload) {
  const raw = typeof payload.prompt === "string" ? payload.prompt : "";
  const text = raw.trim();
  if (!text) return;
  // Harness-wrapped content (reminders, caveats, command envelopes) is not prose.
  // Slash commands ARE kept: which skill he reaches for is signal, and they are
  // tagged is_slash_command so the distiller can separate them from writing.
  if (text.startsWith("<")) return;
  const ts = new Date().toISOString();
  const sessionId = payload.session_id ?? null;
  const { text: redacted, redactions } = redact(text);
  append({
    schema: SCHEMA,
    ts,
    repo: basename(REPO_ROOT),
    kind: "prompt",
    source: "userpromptsubmit-hook",
    provenance: "human",
    id: `${sessionId ?? "nosession"}:${ts}`,
    session_id: sessionId,
    transcript_path: payload.transcript_path ?? null,
    cwd: payload.cwd ?? null,
    is_slash_command: /^\//.test(text),
    chars: text.length,
    redactions,
    text: redacted,
  });
}

function onStop(payload) {
  const ts = new Date().toISOString();
  const sessionId = payload.session_id ?? null;
  if (!sessionId) return;

  // Link to the most recent prompt this session logged, and skip if that prompt
  // already has an outcome (Stop can fire more than once per turn).
  const current = readCurrent(ts);
  let target = null;
  for (let i = current.length - 1; i >= 0; i--) {
    const e = current[i];
    if (e.kind === "prompt" && e.session_id === sessionId) { target = e; break; }
  }
  if (!target) return;
  if (current.some((e) => e.kind === "turn_outcome" && e.ref === target.id)) return;

  const tPath = payload.transcript_path ?? target.transcript_path;
  if (!tPath || !existsSync(tPath)) return;

  let lines;
  try {
    lines = readFileSync(tPath, "utf8").split("\n").filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch { return; }

  // Walk back to the last human prompt, then forward collecting what the turn did.
  let start = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    const o = lines[i];
    if (o.type === "user" && !o.isSidechain &&
        ["typed", "suggestion_accepted", "queued"].includes(o.promptSource)) { start = i; break; }
  }
  if (start < 0) return;

  const tools = {};
  const files = new Set();
  let subagents = 0, assistantChars = 0, thinkingBlocks = 0;
  const startTs = lines[start].timestamp;
  let endTs = startTs;

  for (let i = start + 1; i < lines.length; i++) {
    const o = lines[i];
    if (o.timestamp) endTs = o.timestamp;
    const c = o.message?.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === "tool_use") {
        tools[b.name] = (tools[b.name] || 0) + 1;
        if (b.name === "Agent" || b.name === "Task") subagents++;
        const p = b.input?.file_path ?? b.input?.notebook_path;
        if (p && ["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(b.name)) {
          files.add(String(p).replace(REPO_ROOT, "").replace(/^[\\/]/, ""));
        }
      } else if (b.type === "text" && o.type === "assistant") {
        assistantChars += (b.text ?? "").length;
      } else if (b.type === "thinking") thinkingBlocks++;
    }
  }

  const duration = startTs && endTs
    ? Math.round((new Date(endTs) - new Date(startTs)) / 1000) : null;

  append({
    schema: SCHEMA,
    ts,
    repo: basename(REPO_ROOT),
    kind: "turn_outcome",
    source: "stop-hook",
    provenance: "derived",
    ref: target.id,
    session_id: sessionId,
    prompt_ts: target.ts,
    duration_s: duration != null && duration >= 0 && duration < 86400 ? duration : null,
    tools,
    tool_calls: Object.values(tools).reduce((a, b) => a + b, 0),
    files: [...files].slice(0, 60),
    files_touched: files.size,
    subagents,
    thinking_blocks: thinkingBlocks,
    assistant_chars: assistantChars,
  });
}

// ── entry ─────────────────────────────────────────────────────────────────
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    const kind = payload.hook_event_name;
    if (kind === "UserPromptSubmit") onPrompt(payload);
    else if (kind === "Stop") onStop(payload);
  } catch {
    // swallow everything — a broken hook must never break the harness, and on
    // UserPromptSubmit it must never emit text (stdout becomes model context).
  }
  process.exit(0);
});
