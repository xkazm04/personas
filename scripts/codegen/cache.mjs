// Input cache for scripts/run-codegen.mjs: decides whether a codegen task may be skipped.
//
// A task is skipped only when ALL of this holds, and runs in every other case:
//   - it declares inputs + outputs in ./inputs.mjs and is not in NEVER_CACHE
//   - the sha256 over (Node major, the task's own script, every declared input's path and
//     bytes) equals the key recorded after its last green run
//   - every declared output still exists with the size + mtime recorded then
// "Cannot tell" always means RUN: a missing input, a declared directory that enumerates
// to nothing, an unreadable file, a torn manifest - each returns null here, and null is
// never a hit. An empty enumeration is therefore refused, not treated as "unchanged".
//
// The manifest lives under node_modules/.cache keyed by a hash of the checkout root:
// worktrees reach ONE node_modules through a junction, and two checkouts sharing a
// manifest would vouch for each other's outputs.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CODEGEN_IO, NEVER_CACHE } from "./inputs.mjs";

export function createCodegenCache({ repoRoot, tasks, off }) {
  const manifestPath = join(
    repoRoot, "node_modules", ".cache", "personas-codegen",
    createHash("sha256").update(repoRoot.toLowerCase()).digest("hex").slice(0, 12), "manifest.json",
  );

  let manifest = { version: 1, tasks: {} };
  try {
    const m = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (m && m.version === 1 && m.tasks) manifest = m;
  } catch {
    // no manifest, or a torn one: start empty
  }

  /** Files named by one inputs/outputs entry, repo-relative and sorted; null when missing or empty. */
  function expand(entry) {
    if (typeof entry === "string") return existsSync(join(repoRoot, entry)) ? [entry] : null;
    const abs = join(repoRoot, entry.dir);
    if (!existsSync(abs)) return null;
    const out = [];
    const walk = (dirAbs, dirRel) => {
      for (const d of readdirSync(dirAbs, { withFileTypes: true })) {
        if (d.isDirectory()) {
          if (entry.recursive) walk(join(dirAbs, d.name), `${dirRel}/${d.name}`);
        } else if (!entry.match || entry.match.test(d.name)) out.push(`${dirRel}/${d.name}`);
      }
    };
    walk(abs, entry.dir);
    return out.length ? out.sort() : null;
  }

  function inputKey(name) {
    const io = CODEGEN_IO[name];
    if (off || !io || NEVER_CACHE.has(name)) return null;
    const h = createHash("sha256").update(`node${process.versions.node.split(".")[0]}|`);
    h.update(readFileSync(join(repoRoot, tasks[name])));
    for (const entry of io.inputs) {
      const files = expand(entry);
      if (!files) return null;
      for (const rel of files) h.update(`|${rel}|`).update(readFileSync(join(repoRoot, rel)));
    }
    return h.digest("hex");
  }

  function outputPrint(name) {
    const parts = [];
    for (const entry of CODEGEN_IO[name].outputs) {
      const files = expand(entry);
      if (!files) return null;
      for (const rel of files) {
        const st = statSync(join(repoRoot, rel));
        parts.push(`${rel}|${st.size}|${Math.round(st.mtimeMs)}`);
      }
    }
    return createHash("sha256").update(parts.join(";")).digest("hex");
  }

  return {
    /**
     * Call BEFORE running the task: an input edited while the task runs must not be
     * recorded as seen. Returns `{ hit, key }`; `key` is null when the task is uncacheable.
     * A miss forgets the previous record, so a failed run can never be vouched for.
     */
    lookup(name) {
      let key = null;
      try {
        key = inputKey(name);
        const prev = manifest.tasks[name];
        if (key && prev && prev.key === key && prev.outputs === outputPrint(name)) return { hit: true, key };
      } catch {
        key = null; // unreadable input or output: a reason to run, never a reason to fail
      }
      delete manifest.tasks[name];
      return { hit: false, key };
    },

    /** Call after a green run with the key `lookup` returned. */
    record(name, key) {
      if (!key) return;
      try {
        const outputs = outputPrint(name);
        if (outputs) manifest.tasks[name] = { key, outputs };
      } catch {
        // not recorded: the task simply runs again next time
      }
    },

    /** tmp + rename: two presets can finish together, and a torn manifest must read as "no cache". */
    save() {
      try {
        mkdirSync(dirname(manifestPath), { recursive: true });
        const tmp = `${manifestPath}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(manifest));
        renameSync(tmp, manifestPath);
      } catch {
        // a cache that cannot be written is a slower next run, not a failed build
      }
    },
  };
}
