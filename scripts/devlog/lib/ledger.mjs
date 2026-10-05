// The findings ledger: `.claude/devlog/ledger.jsonl`, append-only, one line per
// status change `{ts, fp, status, sha?, note?}`. The latest line per fp is its
// status. `deriveTransitions` is the re-judgement every digest makes:
//
//   fixed (or confirmed) at T, and the fp appears in a dev session that started
//   after T                                        -> regressed
//   fixed at T, at least one dev session started after T, fp absent from all
//   of them                                        -> confirmed (candidate)

import fs from "node:fs";
import path from "node:path";
import { isoMicros, REPO_ROOT } from "./paths.mjs";

export const STATUSES = ["open", "fixed", "confirmed", "regressed", "wontfix"];
export const DEFAULT_LEDGER = path.join(REPO_ROOT, ".claude", "devlog", "ledger.jsonl");

export function ledgerPath(override, env = process.env) {
  return override ? path.resolve(override) : env.DEVLOG_LEDGER ? path.resolve(env.DEVLOG_LEDGER) : DEFAULT_LEDGER;
}

/** All ledger entries, oldest first. A missing file is an empty ledger. */
export function readLedger(file) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && e.fp && e.status) out.push(e);
    } catch {
      /* a hand-mangled line is skipped, the rest of the ledger still counts */
    }
  }
  return out;
}

/** fp -> latest entry. */
export function latestByFp(entries) {
  const out = new Map();
  for (const e of entries) out.set(e.fp, e);
  return out;
}

export function appendLedger(file, { fp, status, sha, note, ts }) {
  if (!/^[0-9a-f]{8}$/.test(fp)) throw new Error(`ledger: fp must be 8 lowercase hex, got "${fp}"`);
  if (!STATUSES.includes(status)) throw new Error(`ledger: status must be one of ${STATUSES.join("|")}`);
  const entry = { ts: ts ?? isoMicros(), fp, status };
  if (sha) entry.sha = sha;
  if (note) entry.note = note;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(entry) + "\n");
  return entry;
}

/**
 * @param {Map<string, object>} latest fp -> latest entry
 * @param {Array<{id: string, start: number, fps: Set<string>}>} sessions dev
 *   sessions (debug or unknown profile) with the fps each produced
 * @returns {Array<{fp, from, to, session, since}>}
 */
export function deriveTransitions(latest, sessions) {
  const out = [];
  for (const [fp, entry] of latest) {
    if (entry.status !== "fixed" && entry.status !== "confirmed") continue;
    const since = Date.parse(entry.ts);
    const after = sessions.filter((s) => s.start > since).sort((a, b) => a.start - b.start);
    if (!after.length) continue;
    const seen = after.find((s) => s.fps.has(fp));
    if (seen) out.push({ fp, from: entry.status, to: "regressed", session: seen.id, since: entry.ts });
    else if (entry.status === "fixed") out.push({ fp, from: "fixed", to: "confirmed", session: after[0].id, since: entry.ts });
  }
  return out;
}
