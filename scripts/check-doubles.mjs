#!/usr/bin/env node
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

const TERMS = [
  "messaging", "email", "CRM", "knowledge base", "spreadsheet",
  "storage", "ticketing", "database", "analytics", "monitoring",
  "source control", "finance platform", "support platform",
  "project management", "calendar", "cloud", "HR platform",
  "legal platform", "vision AI", "voice generation AI",
  "image generation AI", "CMS", "ad platform", "social platform",
  "ticketing system", "web scraper", "design tool", "form tool",
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let total = 0;
for (const f of walk(path.join(ROOT, "scripts/templates"))) {
  const s = fs.readFileSync(f, "utf8");
  for (const t of TERMS) {
    const re = new RegExp(`\\b${esc(t)}\\s+${esc(t)}\\b`, "gi");
    const m = s.match(re);
    if (m) {
      console.log(`${path.relative(ROOT, f)} → "${t}" x${m.length}`);
      total++;
    }
  }
}
console.log(`files with doubles: ${total}`);
