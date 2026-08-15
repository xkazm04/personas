#!/usr/bin/env node
/**
 * Verifies that frontend IPC command references stay in sync with the Tauri
 * invoke handler contract.
 *
 * Rules:
 * 1. Every command literal used through invokeWithTimeout/safeInvoke must be
 *    present in commandNames.generated.ts or commandNames.overrides.ts.
 * 2. commandNames.generated.ts must match src-tauri/src/lib.rs.
 * 3. commandNames.overrides.ts may only contain truly unregistered commands.
 *    If a Rust #[tauri::command] with the same function name exists, register
 *    it or remove the frontend call.
 * 4. Every invoke payload must supply every REQUIRED parameter the Rust command
 *    declares (camelCased; `Option<T>` params are optional; State/AppHandle/
 *    Window are injected by the framework and never sent).
 *
 *    Rules 1-3 check the command NAME. That is the smaller half of the
 *    signature: Tauri resolves arguments BY NAME too, so a payload missing a
 *    declared parameter is rejected at the boundary with the name check fully
 *    green. Added 2026-08-15 after `drag-reorder.md` found that two of the
 *    three `dev_tools_reorder_*` wrappers sent `{projectId, goalIds}` /
 *    `{projectId, groupIds}` to commands declaring a single `ids: Vec<String>`
 *    — a whole command family that could never have executed.
 *
 *    Measured before shipping: 1,226 call sites compliant, 3 violating, and
 *    all 3 hand-verified as real. It is not an approximation that mostly
 *    works; payloads built from a variable or containing a spread are counted
 *    as unanalyzable and skipped rather than guessed at.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const LIB_RS = resolve(ROOT, "src-tauri/src/lib.rs");
const GENERATED = resolve(ROOT, "src/lib/commandNames.generated.ts");
const OVERRIDES = resolve(ROOT, "src/lib/commandNames.overrides.ts");
const SRC = resolve(ROOT, "src");
const RUST_SRC = resolve(ROOT, "src-tauri/src");

function read(path) {
  return readFileSync(path, "utf8");
}

function walk(dir, predicate, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") continue;
    const path = join(dir, ent.name);
    if (ent.isDirectory()) walk(path, predicate, out);
    else if (predicate(path)) out.push(path);
  }
  return out;
}

function extractRegisteredCommands() {
  const libRs = read(LIB_RS);
  const handlerMatch = libRs.match(/invoke_handler\(ipc_auth::wrap_invoke_handler\(tauri::generate_handler!\[\s*([\s\S]*?)\]\)\)/);
  if (!handlerMatch) {
    throw new Error("Could not find ipc_auth-wrapped invoke_handler block in src-tauri/src/lib.rs");
  }

  const commands = [];
  for (const line of handlerMatch[1].split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#[")) continue;
    const match = trimmed.match(/([\w:]+),?\s*$/);
    if (!match) continue;
    const fullPath = match[1];
    commands.push(fullPath.includes("::") ? fullPath.split("::").pop() : fullPath);
  }
  return new Set(commands);
}

function extractTsUnion(path) {
  return new Set([...read(path).matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((m) => m[1]));
}

function extractFrontendCommandReferences() {
  const files = walk(SRC, (p) =>
    /\.(ts|tsx)$/.test(p) &&
    !p.includes(`${join("src", "lib", "commandNames.generated.ts")}`) &&
    !p.includes(`${join("src", "test")}`),
  );
  const commands = new Map();
  const commandish = /^(dev_tools|gitlab|zapier|obsidian|login|get|set|list|create|update|delete|import|export|lab|start|cancel|execute|clear|report|log|open|health|validate|preview|seed|compile|run|toggle|dismiss|acknowledge|resolve|reopen|bulk|count|duplicate|persona|credential|vault|sign|verify|save|load|parse|detect|scan|refresh|rotate|reorder|review|test|system|send)_/;

  for (const file of files) {
    const src = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    const directRe = /\b(?:invoke|invokeWithTimeout)\s*(?:<[^>]*>)?\s*\(\s*["']([A-Za-z_][A-Za-z0-9_]*)["']/g;
    for (const match of src.matchAll(directRe)) {
      add(match[1], file);
    }

    const safeRe = /\bsafeInvoke\s*(?:<[^>]*>)?\s*\(([\s\S]{0,900}?)\)/g;
    for (const match of src.matchAll(safeRe)) {
      const literals = [...match[1].matchAll(/["']([A-Za-z_][A-Za-z0-9_]*)["']/g)].map((m) => m[1]);
      const name = literals.find((literal) => commandish.test(literal));
      if (name) add(name, file);
    }
  }

  function add(name, file) {
    if (!commands.has(name)) commands.set(name, []);
    commands.get(name).push(file.replace(`${ROOT}\\`, "").replaceAll("\\", "/"));
  }

  return commands;
}

function extractImplementedTauriCommands() {
  const files = walk(RUST_SRC, (p) => p.endsWith(".rs"));
  const implemented = new Map();
  for (const file of files) {
    const src = read(file);
    const re = /#\[\s*tauri::command\s*\][\s\S]{0,800}?\b(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
    for (const match of src.matchAll(re)) {
      implemented.set(match[1], file.replace(`${ROOT}\\`, "").replaceAll("\\", "/"));
    }
  }
  return implemented;
}

// ---------------------------------------------------------------------------
// Rule 4 — invoke payloads must supply every required Rust parameter.
// ---------------------------------------------------------------------------

/** Params Tauri injects; the JS caller never sends these. */
const INJECTED_PARAM_TYPE = /\b(State\s*<|AppHandle|Window\b|WebviewWindow|Emitter|Runtime\b|Channel\s*<)/;

function snakeToCamel(name) {
  return name.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Split on commas at generic/paren/bracket depth 0. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "<" || ch === "(" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function extractCommandParams() {
  const params = new Map();
  for (const file of walk(RUST_SRC, (p) => p.endsWith(".rs"))) {
    const src = read(file);
    const re = /#\[tauri::command[^\]]*\]\s*(?:#\[[^\]]*\]\s*)*(?:pub\s+)?(?:async\s+)?fn\s+(\w+)\s*\(/g;
    let match;
    while ((match = re.exec(src)) !== null) {
      let i = re.lastIndex;
      let depth = 1;
      while (i < src.length && depth > 0) {
        if (src[i] === "(") depth++;
        else if (src[i] === ")") depth--;
        i++;
      }
      const required = new Set();
      for (const raw of splitTopLevel(src.slice(re.lastIndex, i - 1))) {
        const param = raw.trim();
        const colon = param.indexOf(":");
        if (colon < 0) continue;
        const pname = param.slice(0, colon).trim().replace(/^mut\s+/, "");
        const ptype = param.slice(colon + 1).trim();
        if (!/^\w+$/.test(pname) || pname.startsWith("_")) continue;
        if (INJECTED_PARAM_TYPE.test(ptype) || ptype.startsWith("Option<")) continue;
        required.add(snakeToCamel(pname));
      }
      params.set(match[1], { required, file: file.replace(`${ROOT}\\`, "").replaceAll("\\", "/") });
    }
  }
  return params;
}

function extractInvokePayloads() {
  const sites = [];
  for (const file of walk(SRC, (p) => /\.(ts|tsx)$/.test(p))) {
    const src = read(file);
    const re = /\binvoke\w*\s*(?:<[^;=]*?>)?\s*\(\s*["']([a-z][a-z0-9_]*)["']\s*,/g;
    let match;
    while ((match = re.exec(src)) !== null) {
      let j = re.lastIndex;
      while (j < src.length && /\s/.test(src[j])) j++;
      // Not an object literal (variable payload) — unanalyzable, skip.
      if (src[j] !== "{") continue;
      let depth = 0;
      let k = j;
      for (; k < src.length; k++) {
        if (src[k] === "{") depth++;
        else if (src[k] === "}") {
          depth--;
          if (depth === 0) {
            k++;
            break;
          }
        }
      }
      const literal = src.slice(j + 1, k - 1);
      // A spread can supply anything — unanalyzable, skip.
      if (literal.includes("...")) continue;
      const keys = new Set();
      // Collapse nested objects so their inner keys are not read as top-level.
      for (const raw of splitTopLevel(literal.replace(/\{[^{}]*\}/g, "0"))) {
        const key = raw.trim().match(/^([A-Za-z_$][\w$]*)\s*(?::|$)/);
        if (key) keys.add(key[1]);
      }
      sites.push({
        command: match[1],
        keys,
        file: file.replace(`${ROOT}\\`, "").replaceAll("\\", "/"),
        line: src.slice(0, match.index).split("\n").length,
      });
    }
  }
  return sites;
}

const registered = extractRegisteredCommands();
const generated = extractTsUnion(GENERATED);
const overrides = extractTsUnion(OVERRIDES);
const frontendRefs = extractFrontendCommandReferences();
const implemented = extractImplementedTauriCommands();

const IMPLEMENTED_BUT_UNREGISTERED_ALLOWLIST = new Set([
  // Dormant migration module: file exists but is not part of commands::core
  // because its model/repo imports are not wired into the compiled backend yet.
  "list_composition_workflows",
  "get_composition_workflow",
  "create_composition_workflow",
  "update_composition_workflow",
  "delete_composition_workflow",
  "import_composition_workflows",
]);

const generatedDrift = [
  ...[...registered].filter((c) => !generated.has(c)).map((c) => `missing from generated: ${c}`),
  ...[...generated].filter((c) => !registered.has(c)).map((c) => `stale in generated: ${c}`),
];

const unknownFrontend = [...frontendRefs.keys()]
  .filter((c) => !registered.has(c) && !overrides.has(c))
  .sort();

const staleOverrides = [...overrides]
  .filter((c) => registered.has(c))
  .sort();

const implementedButUnregisteredOverrides = [...overrides]
  .filter((c) => !registered.has(c) && implemented.has(c) && !IMPLEMENTED_BUT_UNREGISTERED_ALLOWLIST.has(c))
  .sort();

const errors = [];
if (generatedDrift.length) {
  errors.push(
    "commandNames.generated.ts is out of sync with lib.rs. Run `node scripts/generate-command-names.mjs`.\n" +
    generatedDrift.map((x) => `  - ${x}`).join("\n"),
  );
}
if (unknownFrontend.length) {
  errors.push(
    "Frontend references command names that are neither registered nor listed as overrides:\n" +
    unknownFrontend.map((c) => `  - ${c}: ${frontendRefs.get(c).slice(0, 3).join(", ")}`).join("\n"),
  );
}
if (staleOverrides.length) {
  errors.push(
    "commandNames.overrides.ts contains commands that are now registered. Run `node scripts/generate-command-names.mjs`.\n" +
    staleOverrides.map((c) => `  - ${c}`).join("\n"),
  );
}
if (implementedButUnregisteredOverrides.length) {
  errors.push(
    "Overrides point at implemented Rust commands that are not registered in lib.rs:\n" +
    implementedButUnregisteredOverrides.map((c) => `  - ${c}: ${implemented.get(c)}`).join("\n"),
  );
}

const commandParams = extractCommandParams();
const missingArgs = [];
for (const site of extractInvokePayloads()) {
  const decl = commandParams.get(site.command);
  if (!decl) continue; // rules 1-3 own unknown command names
  const missing = [...decl.required].filter((p) => !site.keys.has(p));
  if (missing.length) missingArgs.push({ ...site, missing, declares: [...decl.required] });
}
if (missingArgs.length) {
  errors.push(
    "invoke payloads omit parameters the Rust command declares. Tauri resolves arguments\n" +
    "by name, so these calls are rejected at the boundary — the command NAME being correct\n" +
    "does not make the call work:\n" +
    missingArgs
      .map(
        (a) =>
          `  - ${a.file}:${a.line} → ${a.command}\n` +
          `      missing: ${a.missing.join(", ")}   (declares: ${a.declares.join(", ") || "<none>"})`,
      )
      .join("\n"),
  );
}

if (errors.length) {
  console.error(errors.join("\n\n"));
  process.exit(1);
}

console.log(`Command contract OK (${registered.size} registered, ${overrides.size} intentional overrides).`);
