#!/usr/bin/env node
// Decision Mirror — Phase 1 capture (docs/concepts/decision-mirror.md).
//
// Two modes, one append-only JSONL ledger (.claude/decision-ledger/, gitignored):
//
// 1. HOOK MODE (no args): PostToolUse hook on AskUserQuestion. Reads the hook
//    payload from stdin, extracts one event per question (options, chosen,
//    annotation), appends to events-YYYY-MM.jsonl. MUST NEVER fail the hook —
//    every error path exits 0 silently.
//
// 2. CORRECTION MODE: capture-decision.mjs --correction "<what the user said>"
//    [--was "<what the agent was doing>"] [--context "<one-line situation>"]
//    Sessions journal operator course-corrections (the strongest signal).
//
// Schema: docs/concepts/decision-mirror.md § Phase 1 (schema: 1).

import { appendFileSync, mkdirSync } from "node:fs";
import { join, basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const LEDGER_DIR = join(REPO_ROOT, ".claude", "decision-ledger");

function appendEvents(events) {
  if (!events.length) return;
  mkdirSync(LEDGER_DIR, { recursive: true });
  const ym = new Date().toISOString().slice(0, 7);
  const file = join(LEDGER_DIR, `events-${ym}.jsonl`);
  const lines = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  appendFileSync(file, lines, "utf8");
}

function baseEvent() {
  return {
    schema: 1,
    ts: new Date().toISOString(),
    repo: basename(REPO_ROOT),
    provenance: "human",
  };
}

// ── correction mode ──────────────────────────────────────────────────────
const argv = process.argv.slice(2);
if (argv.includes("--correction")) {
  try {
    const get = (flag) => {
      const i = argv.indexOf(flag);
      return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
    };
    const said = get("--correction");
    if (said) {
      appendEvents([
        {
          ...baseEvent(),
          kind: "correction",
          source: "manual-correction",
          question: null,
          chosen_raw: said,
          was: get("--was"),
          context: get("--context"),
        },
      ]);
      console.log("correction recorded");
    }
  } catch {
    // never a hard failure — the ledger is best-effort observability
  }
  process.exit(0);
}

// ── hook mode ────────────────────────────────────────────────────────────
let raw = "";
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    const payload = JSON.parse(raw);
    if (payload.tool_name && payload.tool_name !== "AskUserQuestion") process.exit(0);
    const input = payload.tool_input ?? {};
    const questions = Array.isArray(input.questions) ? input.questions : [];
    // The permission component injects the collected answers/annotations back
    // into tool_input; tool_response carries a prose restatement. Prefer the
    // structured maps, keep a response snippet for schema evolution.
    const answers = input.answers ?? {};
    const annotations = input.annotations ?? {};
    const respSnippet =
      typeof payload.tool_response === "string"
        ? payload.tool_response.slice(0, 600)
        : JSON.stringify(payload.tool_response ?? null)?.slice(0, 600);

    const events = questions.map((q) => {
      const chosenRaw = answers[q.question] ?? null;
      return {
        ...baseEvent(),
        kind: q.multiSelect ? "multiselect" : "select",
        source: "askuserquestion-hook",
        session_id: payload.session_id ?? null,
        transcript_path: payload.transcript_path ?? null,
        header: q.header ?? null,
        question: q.question ?? null,
        options: (q.options ?? []).map((o) => ({
          label: o.label,
          description: (o.description ?? "").slice(0, 300),
        })),
        chosen_raw: chosenRaw,
        chosen:
          typeof chosenRaw === "string"
            ? chosenRaw.split(", ").map((s) => s.trim()).filter(Boolean)
            : null,
        annotation: annotations[q.question]?.notes ?? null,
        response_snippet: respSnippet ?? null,
      };
    });
    appendEvents(events);
  } catch {
    // swallow everything — a broken hook must never break the harness
  }
  process.exit(0);
});
