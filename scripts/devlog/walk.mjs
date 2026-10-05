// `npm run devlog -- walk`: drive the running app through every sidebar section
// over the test-automation server (src-tauri/src/test_automation.rs) so the
// digest of that window covers each route under the same conditions.
//
// Per section: /perf/mark start, /navigate, wait for idle, /perf/mark end.
// Idle = the IPC count in /perf/snapshot unchanged for 600 ms (8 s ceiling),
// the rule tests/playwright/perf-nav-walk.spec.ts settles on. When /perf/snapshot
// does not answer (no __PERF__ instrumentation), a fixed 2.5 s settle is used and
// the walk.section record says which one ran (`f.settle`).
//
// Records (tgt `devlog`, into today's toolchain JSONL): walk.start,
// walk.section, walk.end, all with `f.walk_id`; `digest --walk <id>` reads the
// window they bracket.

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { makeRecord } from "./lib/envelope.mjs";
import { REPO_ROOT } from "./lib/paths.mjs";
import { JsonlWriter } from "./lib/writer.mjs";

export const REGISTRY = path.join(REPO_ROOT, "src", "lib", "navigation", "registry.ts");
const STABLE_MS = 600;
const MAX_MS = 8000;
const FIXED_SETTLE_MS = 2500;
const VISITED = new Set(["sidebar", "nested"]);

/** Section ids + reachability from the NAV_SECTIONS source (no TS import). */
export function parseNavSections(source) {
  const start = source.indexOf("export const NAV_SECTIONS");
  if (start < 0) return [];
  const end = source.indexOf("] as const", start);
  const block = source.slice(start, end < 0 ? undefined : end);
  const out = [];
  for (const line of block.split(/\r?\n/)) {
    const m = /^\s*\{\s*id:\s*'([\w-]+)'.*?reachability:\s*'([\w-]+)'/.exec(line);
    if (m) out.push({ id: m[1], reachability: m[2] });
  }
  return out;
}

export function newWalkId(now = new Date()) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `walk-${stamp}-${randomBytes(2).toString("hex")}`;
}

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} [opts.sections] "all" or comma list
 * @param {string} opts.logsDir
 * @param {typeof fetch} [opts.fetchImpl]
 * @param {(ms:number)=>Promise<void>} [opts.sleep]
 * @param {(line:string)=>void} [opts.print]
 * @returns {Promise<{ exitCode: number, walkId?: string }>}
 */
export async function runWalk(opts) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const print = opts.print ?? ((l) => process.stdout.write(l + "\n"));
  const base = `http://127.0.0.1:${opts.port}`;

  const call = async (method, route, body) => {
    const res = await fetchImpl(base + route, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${route} -> HTTP ${res.status} ${text.slice(0, 120)}`);
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  try {
    await call("GET", "/health");
  } catch {
    print(`walk: test-automation server not reachable on :${opts.port} - start npm run tauri:dev:test`);
    return { exitCode: 2 };
  }

  const registry = opts.registrySource ?? fs.readFileSync(REGISTRY, "utf8");
  const all = parseNavSections(registry);
  let targets;
  if (!opts.sections || opts.sections === "all") {
    targets = all.filter((s) => VISITED.has(s.reachability)).map((s) => s.id);
  } else {
    targets = opts.sections.split(",").map((s) => s.trim()).filter(Boolean);
    const known = new Set(all.map((s) => s.id));
    const unknown = targets.filter((t) => !known.has(t));
    if (unknown.length) {
      print(`walk: unknown section(s): ${unknown.join(", ")} (known: ${[...known].join(", ")})`);
      return { exitCode: 2 };
    }
  }

  const walkId = opts.walkId ?? newWalkId();
  const boot = process.env.PERSONAS_DEVLOG_SESSION || walkId;
  const writer = opts.writer ?? new JsonlWriter(opts.logsDir);
  const rec = (msg, f, lvl = "INFO") => writer.write(makeRecord({ lvl, src: "toolchain", tgt: "devlog", msg, boot, f: { walk_id: walkId, ...f } }));
  const t0 = Date.now();
  rec("walk.start", { sections: targets.length, port: opts.port });
  print(`walk ${walkId}: ${targets.length} sections on :${opts.port}`);

  let snapshotWorks = true;
  const ipcCount = async () => {
    const snap = await call("GET", "/perf/snapshot");
    const n = snap?.ipc?.totalCount;
    if (typeof n !== "number") throw new Error("no ipc.totalCount in /perf/snapshot");
    return n;
  };
  const settle = async () => {
    if (snapshotWorks) {
      try {
        const started = Date.now();
        await sleep(100);
        let last = await ipcCount();
        let changedAt = Date.now();
        while (Date.now() - started < MAX_MS) {
          await sleep(120);
          const n = await ipcCount();
          if (n !== last) [last, changedAt] = [n, Date.now()];
          else if (Date.now() - changedAt >= STABLE_MS) return { settle: "ipc-stable", settled: true, settle_ms: Date.now() - started, ipc_count: n };
        }
        return { settle: "ipc-stable", settled: false, settle_ms: Date.now() - started, ipc_count: last };
      } catch {
        snapshotWorks = false;
      }
    }
    await sleep(FIXED_SETTLE_MS);
    return { settle: "fixed-2500ms", settled: true, settle_ms: FIXED_SETTLE_MS };
  };

  let failed = 0;
  for (const section of targets) {
    const started = Date.now();
    try {
      await call("POST", "/perf/mark", { label: `devlog:${walkId}:${section}:start` });
      await call("POST", "/navigate", { section });
      const s = await settle();
      await call("POST", "/perf/mark", { label: `devlog:${walkId}:${section}:end` });
      rec("walk.section", { section, ok: true, duration_ms: Date.now() - started, ...s });
      print(`  ${section.padEnd(16)} ${String(Date.now() - started).padStart(6)}ms  ${s.settle}${s.settled ? "" : " UNSETTLED"}`);
    } catch (err) {
      failed += 1;
      rec("walk.section", { section, ok: false, duration_ms: Date.now() - started, error: String(err?.message ?? err).slice(0, 300) }, "WARN");
      print(`  ${section.padEnd(16)} FAILED ${err?.message ?? err}`);
    }
  }
  rec("walk.end", { duration_ms: Date.now() - t0, ok_sections: targets.length - failed, failed });
  if (!opts.writer) await writer.close();
  print(`walk ${walkId} done: ${targets.length - failed}/${targets.length} ok. Next: npm run devlog -- digest --walk ${walkId}`);
  return { exitCode: failed ? 1 : 0, walkId };
}
