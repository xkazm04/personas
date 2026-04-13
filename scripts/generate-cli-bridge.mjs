#!/usr/bin/env node
/**
 * generate-cli-bridge.mjs
 *
 * Auto-generates a Rust desktop bridge stub from a CLI binary's --help output.
 * The output mirrors the hand-coded bridges in
 * `src-tauri/src/engine/desktop_bridges.rs` (see the `vscode` module for the
 * canonical shape).
 *
 * USAGE
 *   node scripts/generate-cli-bridge.mjs <binary> [subcommand ...] [--out <path>]
 *
 * EXAMPLES
 *   # Generate a stub from `gh --help`
 *   node scripts/generate-cli-bridge.mjs gh
 *
 *   # Probe specific subcommands too (one extra `gh <sub> --help` per arg)
 *   node scripts/generate-cli-bridge.mjs gh repo issue pr
 *
 *   # Write to an explicit path instead of stdout
 *   node scripts/generate-cli-bridge.mjs kubectl --out src-tauri/src/engine/bridges/kubectl.rs
 *
 * WHY
 *   Personas already supports typed CLI bridges (see `engine/desktop_bridges.rs`),
 *   but each one is hand-written. New bridges therefore arrive slowly and tend to
 *   miss flags. This script reads `--help` output, parses the structure, and emits
 *   a Rust module with: a top-level `<Tool>Action` enum, one variant per
 *   subcommand or top-level invocation, and a `dispatch_*` function shell that
 *   the human can flesh out with the actual `tokio::process::Command` call.
 *
 *   The output is INTENTIONALLY a stub. The script does NOT try to perfectly
 *   reverse-engineer every CLI's flag semantics -- that would require per-tool
 *   special cases. The author then:
 *     1. Reviews the generated enum variants and renames anything awkward
 *     2. Fills in the `execute()` function bodies (typically 5-15 lines each)
 *     3. Adds the new bridge module to `desktop_bridges.rs`
 *
 *   Realistic time-to-bridge: 5-10 minutes per CLI, vs. 1-3 hours of hand-coding.
 *
 * NON-GOALS
 *   - Generating the actual command execution logic (too tool-specific)
 *   - Producing a runnable bridge with zero edits
 *   - Capturing every `--help` format on earth
 *   - Replacing the existing `desktop_security` capability gating
 *
 * SAFETY
 *   The script spawns `<binary> --help` (and optionally `<binary> <sub> --help`).
 *   It does NOT execute any other commands. If the binary is not on PATH the
 *   script reports the error and exits cleanly.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
  console.log(`Usage: node scripts/generate-cli-bridge.mjs <binary> [subcommand ...] [--out <path>]

Generates a Rust desktop bridge stub by parsing the binary's --help output.
The result mirrors the shape of src-tauri/src/engine/desktop_bridges.rs.

Examples:
  node scripts/generate-cli-bridge.mjs gh
  node scripts/generate-cli-bridge.mjs gh repo issue pr
  node scripts/generate-cli-bridge.mjs kubectl --out /tmp/kubectl_bridge.rs
`);
  process.exit(argv.length === 0 ? 1 : 0);
}

const outFlagIndex = argv.indexOf('--out');
let outPath = null;
let positional = argv;
if (outFlagIndex !== -1) {
  outPath = argv[outFlagIndex + 1];
  if (!outPath) {
    console.error('Error: --out requires a path argument');
    process.exit(1);
  }
  positional = argv.filter((_, i) => i !== outFlagIndex && i !== outFlagIndex + 1);
}

const binary = positional[0];
const subcommands = positional.slice(1);

// ---------------------------------------------------------------------------
// Help text capture
// ---------------------------------------------------------------------------

function captureHelp(bin, args = []) {
  const result = spawnSync(bin, [...args, '--help'], { encoding: 'utf8', shell: false });
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      console.error(`Error: binary '${bin}' not found on PATH.`);
      process.exit(2);
    }
    console.error(`Error spawning ${bin}: ${result.error.message}`);
    process.exit(2);
  }
  // Many CLIs print --help to stdout (gh, kubectl) but some use stderr (older
  // Unix tools). Concatenate both so we don't miss content.
  return `${result.stdout || ''}\n${result.stderr || ''}`.trim();
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extract a list of subcommand names from the help output.
 * Looks for lines that match: optional indent, name, two-or-more spaces,
 * description.  Filters out flags (start with '-') and numeric/symbolic noise.
 */
function parseSubcommands(helpText) {
  const lines = helpText.split('\n');
  const subs = new Set();
  let inSubsSection = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    // Section header detection -- many CLIs use "Commands:" / "Available Commands:"
    if (/^\s*(commands|subcommands|available commands|core commands)\s*:?\s*$/i.test(line)) {
      inSubsSection = true;
      continue;
    }
    // Other recognised section headers end the subcommand block
    if (/^\s*(options|flags|examples|use|usage|environment)\s*:?\s*$/i.test(line)) {
      inSubsSection = false;
      continue;
    }

    // Pattern: leading spaces, identifier, two+ spaces, description
    const m = line.match(/^\s{2,}([a-z][a-z0-9_-]{1,30})\s{2,}\S/);
    if (m && !line.trim().startsWith('-')) {
      // Skip obvious non-subcommand identifiers
      const name = m[1];
      if (/^(true|false|null|none|default|info|warn|error|debug|trace)$/.test(name)) continue;
      // Only collect from inside a recognised commands section to reduce noise
      if (inSubsSection) subs.add(name);
    }
  }
  return Array.from(subs);
}

/**
 * Extract flags from the help output.
 * Looks for lines like:
 *   -v, --verbose             Show extra output
 *       --no-color            Disable color
 *   -o, --output <format>     Output format
 */
function parseFlags(helpText) {
  const flags = [];
  const seen = new Set();
  for (const rawLine of helpText.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    // Match the long-flag part: --name or --name <value> or --name=value
    const m = line.match(/^\s+(?:-[a-zA-Z],\s+)?(--[a-z][a-z0-9-]{1,40})(\s+[<\[]([a-z_]+)[>\]])?/);
    if (!m) continue;
    const flagName = m[1].slice(2);
    if (seen.has(flagName)) continue;
    seen.add(flagName);
    flags.push({
      name: flagName,
      takes_value: Boolean(m[2]),
      value_kind: m[3] || null,
    });
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Rust emission
// ---------------------------------------------------------------------------

function snakeToPascal(s) {
  return s
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function snakeToCamelField(s) {
  // Rust struct fields stay snake_case; this is just for sanitising.
  return s.replace(/-/g, '_');
}

function rustIdent(s) {
  // Reserved keywords get a trailing underscore
  const reserved = new Set([
    'type', 'match', 'ref', 'move', 'self', 'mod', 'fn', 'let', 'pub',
    'use', 'crate', 'super', 'where', 'impl', 'box', 'as', 'in',
  ]);
  const ident = snakeToCamelField(s);
  return reserved.has(ident) ? `${ident}_` : ident;
}

function emitVariant(subName, flags) {
  const variantName = snakeToPascal(subName);
  if (flags.length === 0) {
    return `    /// \`${binary} ${subName}\` -- TODO(generate-cli-bridge): describe what this does\n    ${variantName},`;
  }
  const fields = flags
    .slice(0, 12) // cap at 12 most-likely-relevant flags to keep the stub readable
    .map((f) => {
      const ident = rustIdent(f.name);
      const ty = f.takes_value ? 'Option<String>' : 'bool';
      return `        /// --${f.name}${f.value_kind ? ` <${f.value_kind}>` : ''}\n        ${ident}: ${ty},`;
    })
    .join('\n');
  return `    /// \`${binary} ${subName}\` -- TODO(generate-cli-bridge): describe what this does\n    ${variantName} {\n${fields}\n    },`;
}

function emitModule({ binary, topLevelFlags, subcommandData }) {
  const moduleName = rustIdent(binary.replace(/[^a-z0-9_-]/gi, '_').toLowerCase());
  const enumName = `${snakeToPascal(binary.replace(/[^a-z0-9_-]/gi, '_'))}Action`;

  // Collapse top-level flags into a "Run" variant if no subcommands were detected
  const variants = [];
  if (subcommandData.length > 0) {
    for (const { name, flags } of subcommandData) {
      variants.push(emitVariant(name, flags));
    }
  } else {
    variants.push(emitVariant('run', topLevelFlags));
  }

  const subcommandSummary = subcommandData.length > 0
    ? subcommandData.map((s) => `${s.name} (${s.flags.length} flags)`).join(', ')
    : `(no subcommands detected, ${topLevelFlags.length} top-level flags)`;

  return `// Auto-generated by scripts/generate-cli-bridge.mjs
// Source binary: ${binary}
// Subcommands probed: ${subcommandSummary}
//
// TODO(generate-cli-bridge): Review the variants below, rename anything
// awkward, fill in the execute() function body, and register this module
// in src-tauri/src/engine/desktop_bridges.rs alongside the existing bridges.
//
// The shape mirrors the hand-coded \`vscode\` module in desktop_bridges.rs --
// keep the BridgeActionResult contract identical so the rest of the system
// (desktop_security, telemetry, error mapping) works without changes.

#![allow(dead_code)]

use std::time::Instant;

use serde::{Deserialize, Serialize};

use crate::engine::desktop_bridges::BridgeActionResult;
use crate::error::AppError;

pub mod ${moduleName} {
    use super::*;

    /// Actions available via the \`${binary}\` CLI.
    ///
    /// Generated from \`${binary} --help\`. Each variant maps to one subcommand
    /// (or to the top-level invocation if no subcommands were detected).
    #[derive(Debug, Clone, Serialize, Deserialize)]
    #[serde(tag = "action", content = "params")]
    pub enum ${enumName} {
${variants.join('\n')}
    }

    /// Execute a single \`${binary}\` action.
    ///
    /// TODO(generate-cli-bridge): Replace the placeholder with the actual
    /// \`tokio::process::Command\` call. See the \`vscode::execute\` function in
    /// \`desktop_bridges.rs\` for the canonical pattern. The shape returned by
    /// every bridge MUST be \`BridgeActionResult\` so downstream code does not
    /// need to special-case bridges.
    pub async fn execute(
        binary: &str,
        action: ${enumName},
    ) -> Result<BridgeActionResult, AppError> {
        let start = Instant::now();
        let action_name = format!("{:?}", &action)
            .split_whitespace()
            .next()
            .unwrap_or("unknown")
            .to_string();

        // TODO(generate-cli-bridge): build args from the action and spawn the binary.
        // Example skeleton (delete this and write the real implementation):
        //
        //     let args = match action {
        //         ${enumName}::Run { verbose, .. } => {
        //             let mut a = vec![];
        //             if verbose { a.push("--verbose".to_string()); }
        //             a
        //         }
        //         // ... other variants ...
        //     };
        //     let output = tokio::process::Command::new(binary)
        //         .args(&args)
        //         .output()
        //         .await
        //         .map_err(|e| AppError::Internal(format!("${binary} spawn failed: {}", e)))?;
        //     let success = output.status.success();
        //     let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
        //     let stderr = String::from_utf8_lossy(&output.stderr).into_owned();

        let _ = (binary, action);
        Err(AppError::Internal(format!(
            "${binary} bridge action '{}' is not yet implemented (generated stub)",
            action_name
        )))
        // When implemented, return the real result:
        // Ok(BridgeActionResult {
        //     success,
        //     output: stdout,
        //     error: if success { None } else { Some(stderr) },
        //     duration_ms: start.elapsed().as_millis() as u64,
        //     bridge: "${binary}".to_string(),
        //     action: action_name,
        // })
    }
}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.error(`[generate-cli-bridge] Probing ${binary} --help...`);
const topLevelHelp = captureHelp(binary);
const topLevelFlags = parseFlags(topLevelHelp);
const detectedSubs = subcommands.length > 0 ? subcommands : parseSubcommands(topLevelHelp);

console.error(
  `[generate-cli-bridge] Found ${topLevelFlags.length} top-level flags, ${detectedSubs.length} subcommands.`
);
if (detectedSubs.length > 0) {
  console.error(`[generate-cli-bridge] Subcommands: ${detectedSubs.join(', ')}`);
}

// Probe each subcommand for its own flags. Best-effort -- some subs don't
// have --help and we just record empty flags in that case.
const subcommandData = [];
for (const sub of detectedSubs) {
  console.error(`[generate-cli-bridge]   Probing ${binary} ${sub} --help...`);
  let subHelp = '';
  try {
    subHelp = captureHelp(binary, [sub]);
  } catch (err) {
    console.error(`[generate-cli-bridge]   ${sub}: probe failed (${err.message})`);
  }
  const flags = parseFlags(subHelp);
  subcommandData.push({ name: sub, flags });
}

const rustSource = emitModule({ binary, topLevelFlags, subcommandData });

if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, rustSource, 'utf8');
  console.error(`[generate-cli-bridge] Wrote ${outPath}`);
  console.error(
    `[generate-cli-bridge] Next: review TODOs, fill in execute(), register the module in desktop_bridges.rs.`
  );
} else {
  process.stdout.write(rustSource);
}
