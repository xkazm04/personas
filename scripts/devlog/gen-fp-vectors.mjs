// Regenerates fp-vectors.json from the reference implementation. Run it only
// when fingerprint.mjs changes on purpose; the Rust sink's test reads the file
// and must be updated in the same commit.
//
//   node scripts/devlog/gen-fp-vectors.mjs

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fingerprint, normalizeMessage, toolchainFingerprint } from "./fingerprint.mjs";

const APP = [
  ["WARN", "app_lib::engine::kp_reporter", "KP report push failed"],
  ["WARN", "personas_db::perf", "Slow DB query detected"],
  ["ERROR", "webview::error", "Unhandled rejection"],
  ["INFO", "app_lib::commands::core::personas", "Persona 3f2b8c1e-9a4d-4c2b-8e7f-1a2b3c4d5e6f updated in 1108ms"],
  ["WARN", "app_lib::commands::obsidian_brain", 'sync failed for "Research Notes": C:\\Users\\kazda\\vault\\a.md missing'],
  ["WARN", "app_lib::cloud::sync", "table /var/lib/personas/data.db locked after 3 retries (0.25s)"],
  ["DEBUG", "app_lib::engine", "commit deadbeefcafe1234 applied to `main`"],
  ["INFO", "devlog", "log.suppressed"],
  ["INFO", "app_lib::engine", "Caf\u00e9 \u00fcn\u00efcode -42 stays"],
];

const TOOLCHAIN = [
  ["WARN", "cargo", "unused_variables", "src\\engine\\execution.rs"],
  ["ERROR", "cargo", "E0308", "src/commands/core/personas.rs"],
  ["ERROR", "vite", "", ""],
];

const out = {
  algorithm:
    "fnv1a32 over UTF-8 of `${lvl}|${tgt}|${normalize(msg)}`; toolchain: `${lvl}|${tgt}|${code}|${file}`. Reference: scripts/devlog/fingerprint.mjs",
  app: APP.map(([lvl, tgt, msg]) => ({ lvl, tgt, msg, norm: normalizeMessage(msg), fp: fingerprint(lvl, tgt, msg) })),
  toolchain: TOOLCHAIN.map(([lvl, tgt, code, file]) => ({
    lvl,
    tgt,
    code,
    file,
    fp: toolchainFingerprint(lvl, tgt, code, file),
  })),
};

const target = fileURLToPath(new URL("./fp-vectors.json", import.meta.url));
writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
console.log(`wrote ${out.app.length + out.toolchain.length} vectors to ${target}`);
