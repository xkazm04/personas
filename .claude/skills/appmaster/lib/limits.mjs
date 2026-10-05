// The subscription usage-limit mark (WP2). ONE global file, limitPath(): a usage limit belongs to
// the subscription, not to a project. `watch` and `settle` set it when a worker's output carries a
// limit signature; `dispatch` refuses while it stands; WP1 reads the file directly.
// Never deletes anything but the mark itself; never touches a run.

import fs from 'node:fs';
import { limitPath, readJson, writeJson, nowIso, LIMIT_SIGNATURES } from './contract.mjs';

/** (text: string) => boolean   // lower-cased substring match against LIMIT_SIGNATURES */
export function detectLimit(text) {
  const t = String(text ?? '').toLowerCase();
  return LIMIT_SIGNATURES.some((s) => t.includes(s));
}

/** The first LIMIT_SIGNATURES hit with a little context around it, or null. */
export function limitSnippet(text) {
  const raw = String(text ?? ''), t = raw.toLowerCase();
  for (const s of LIMIT_SIGNATURES) {
    const i = t.indexOf(s);
    if (i >= 0) return raw.slice(Math.max(0, i - 60), i + s.length + 80).replace(/\s+/g, ' ').trim();
  }
  return null;
}

/**
 * The part of a worker's output a limit banner can honestly come from. A stream-json transcript
 * carries every tool result verbatim (source files, docs, logs), so a whole-stream substring scan
 * would read a repo that merely MENTIONS "usage limit" as the subscription being out. Scanned:
 * stderr whole; from the stream: error and unknown line types, `result` lines with is_error, assistant
 * lines that carry an `error` field, and any line that does not parse. NOT scanned: user turns,
 * system/init lines (a 2026-10-05 false positive: the slash-command list contains `usage-credits`),
 * clean assistant turns and clean results.
 * (streamText, stderrText) => string
 */
export function limitSurface(streamText, stderrText = '') {
  const parts = [String(stderrText ?? '')];
  for (const line of String(streamText ?? '').split('\n')) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch { parts.push(line); continue; }
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'user' || o.type === 'system') continue;   // system init lists slash commands, one is literally 'usage-credits'
    if (o.type === 'assistant' && !o.error) continue;
    if (o.type === 'result' && !o.is_error) continue;          // a clean result quotes the builder's own summary
    parts.push(line);
  }
  return parts.join('\n');
}

/** () => object|null   // the mark, or null when absent or its resetsAt is in the past */
export function readLimit() {
  const mark = readJson(limitPath(), null);
  if (!mark || typeof mark !== 'object') return null;
  if (mark.resetsAt) {
    const t = Date.parse(mark.resetsAt);
    if (Number.isFinite(t) && t <= Date.now()) return null;
  }
  return mark;
}

/** Write the mark. `extra` (e.g. {runId}) rides along; readers ignore unknown fields. */
export function setLimit(reason, resetsAt = null, extra = {}) {
  if (resetsAt != null && !Number.isFinite(Date.parse(resetsAt))) throw new Error(`--resets is not an ISO time: ${resetsAt}`);
  const mark = { limitedAt: nowIso(), reason: String(reason), resetsAt: resetsAt ? new Date(resetsAt).toISOString() : null, ...extra };
  writeJson(limitPath(), mark);
  return mark;
}

/** Remove the mark. Returns whether a file was there. */
export function clearLimit() {
  try { fs.unlinkSync(limitPath()); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
}

const view = (mark) => (mark ? { limited: true, ...mark } : { limited: false });

/** (args) => {limited:boolean, reason?, resetsAt?}   // limit show|set|clear */
export function cmdLimit({ _ = [], flags = {} } = {}) {
  const sub = _[0] || 'show';
  if (sub === 'show') return view(readLimit());
  if (sub === 'set') {
    if (!flags.reason || flags.reason === true) throw new Error('limit set needs --reason <text>');
    const resets = flags.resets && flags.resets !== true ? flags.resets : null;
    return view(setLimit(flags.reason, resets, { source: 'operator' }));
  }
  if (sub === 'clear') return { limited: false, cleared: clearLimit() };
  throw new Error(`limit: unknown sub-command ${sub} (show|set|clear)`);
}
