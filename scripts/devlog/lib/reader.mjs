// One streaming pass over the logs dir: app JSONL, legacy text and toolchain
// JSONL, oldest day first, every line turned into an envelope record.
//
// Only the daily files are read. The UUID-named `.log` files in the same dir are
// the engine's per-execution logs (out of scope) and `last_boot.log` is read on
// demand by the boot-phase section.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { createLegacyParser } from "./legacy.mjs";

const DAILY = /^(personas|toolchain)\.(\d{4}-\d{2}-\d{2})\.(log|jsonl)$/;

/** Daily files in `dir`, oldest first; `.log` before `.jsonl` on the same day. */
export function listDailyFiles(dir, { fromDate } = {}) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const files = [];
  for (const name of names) {
    const m = DAILY.exec(name);
    if (!m) continue;
    const [, prefix, date, ext] = m;
    if (prefix === "toolchain" && ext !== "jsonl") continue;
    if (fromDate && date < fromDate) continue;
    const kind = prefix === "toolchain" ? "toolchain" : ext === "log" ? "legacy" : "app";
    files.push({ path: path.join(dir, name), name, date, kind });
  }
  const rank = { legacy: 0, app: 1, toolchain: 2 };
  files.sort((a, b) => (a.date === b.date ? rank[a.kind] - rank[b.kind] : a.date < b.date ? -1 : 1));
  return files;
}

async function eachLine(file, onLine) {
  const input = fs.createReadStream(file, { encoding: "utf8", highWaterMark: 1 << 20 });
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

/**
 * Read every daily file and call `onRecord(record, file)`. Records get a
 * numeric `_t` (epoch ms) for windowing; it never reaches output.
 * Returns stats: files read, lines, malformed JSON lines.
 */
export async function scanLogs(dir, onRecord, { fromDate } = {}) {
  const files = listDailyFiles(dir, { fromDate });
  const stats = { files: files.map((f) => ({ name: f.name, kind: f.kind })), lines: 0, malformed: 0 };
  let carryBoot;
  for (const file of files) {
    if (file.kind === "legacy") {
      const parser = createLegacyParser({ day: file.date, carryBoot });
      const push = (rec) => {
        if (!rec) return;
        rec._t = Date.parse(rec.ts);
        rec._legacy = true;
        onRecord(rec, file);
      };
      await eachLine(file.path, (line) => {
        stats.lines += 1;
        push(parser.line(line));
      });
      push(parser.end());
      carryBoot = parser.boot;
      continue;
    }
    await eachLine(file.path, (line) => {
      stats.lines += 1;
      if (!line) return;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        stats.malformed += 1;
        return;
      }
      if (!rec || typeof rec !== "object" || typeof rec.ts !== "string") {
        stats.malformed += 1;
        return;
      }
      rec._t = Date.parse(rec.ts);
      onRecord(rec, file);
    });
  }
  return stats;
}

/** Every record in `dir` as one array, with the scan stats. */
export async function readAll(dir, opts) {
  const out = [];
  const stats = await scanLogs(dir, (r) => out.push(r), opts);
  return { records: out, stats };
}
