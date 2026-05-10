#!/usr/bin/env node
/** Re-pretty every template JSON at 2-space indent. Idempotent. */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

let changed = 0;
for (const f of walk(path.join(ROOT, "scripts/templates"))) {
  const raw = fs.readFileSync(f, "utf8");
  const obj = JSON.parse(raw);
  const pretty = JSON.stringify(obj, null, 2) + "\n";
  if (pretty !== raw) {
    fs.writeFileSync(f, pretty);
    changed++;
  }
}
console.log(`Reformatted ${changed} template files.`);
