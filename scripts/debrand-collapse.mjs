#!/usr/bin/env node
/** Collapse doubled generic terms introduced by the debrand pass. */
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const TERMS = [
  "messaging",
  "email",
  "CRM",
  "knowledge base",
  "spreadsheet",
  "storage",
  "ticketing",
  "database",
  "analytics",
  "monitoring",
  "source control",
  "finance platform",
  "support platform",
  "project management",
  "calendar",
  "cloud",
  "HR platform",
  "legal platform",
  "vision AI",
  "voice generation AI",
  "image generation AI",
  "CMS",
  "forms",
  "scheduling",
  "CI/CD",
  "ad platform",
  "social platform",
  "web scraper",
  "design tool",
  "form tool",
  "auth provider",
  "security scanner",
  "ticketing system",
  "notifications service",
  "transcription service",
  "research source",
  "scheduling tool",
  "time tracking tool",
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const escape = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let touched = 0;
for (const f of walk(path.join(ROOT, "scripts/templates"))) {
  let text = fs.readFileSync(f, "utf8");
  const before = text;
  for (const term of TERMS) {
    const re = new RegExp(`\\b(${escape(term)})\\s+\\1\\b`, "gi");
    text = text.replace(re, "$1");
  }
  if (text !== before) {
    // Re-pretty through JSON to avoid touching structural indentation.
    const obj = JSON.parse(text);
    fs.writeFileSync(f, JSON.stringify(obj, null, 2) + "\n");
    touched++;
  }
}
console.log(`Collapsed doubled terms in ${touched} files.`);
