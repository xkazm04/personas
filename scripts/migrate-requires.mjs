// Migrates require_privileged_sync / require_privileged / require_cloud_auth
// call sites to #[requires(privileged|cloud)] attribute macros.
//
// Usage: node scripts/migrate-requires.mjs <file1> [file2 ...]
//
// Constraints:
// - The require_* call must be the FIRST statement in the function body.
//   Files where it isn't are skipped with a warning; handle those by hand.
// - The literal command-name argument must match the fn name. Sites where
//   they diverge are skipped with a warning (would change audit-log behavior).
// - Adds `use personas_macros::requires;` after the last existing `use crate::`
//   line, if not already present.
// - Trims now-empty `require_*` imports from `use crate::ipc_auth::{...}`.

import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/migrate-requires.mjs <file1> [file2 ...]');
  process.exit(1);
}

let totalMigrated = 0;
let totalSkipped = 0;

for (const file of args) {
  let src = fs.readFileSync(file, 'utf8');
  // Detect line ending — preserve on write to keep diff noise minimal.
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  // Normalize to \n for regex work; re-apply eol at end.
  if (eol === '\r\n') src = src.replaceAll('\r\n', '\n');
  let fileMigrated = 0;
  let fileSkipped = 0;

  // Sync privileged: #[tauri::command]\n pub fn NAME(...) -> ... {\n    require_privileged_sync(&state, "NAME")?;\n
  // Allow optional `.map_err(|e| e.to_string())` after the ? for handlers
  // that return Result<_, String> instead of Result<_, AppError>.
  src = src.replace(
    /(#\[tauri::command\]\n)((?:#\[[^\]]+\]\n)*)(pub fn (\w+)[^{]*\{\n)    require_privileged_sync\(&state, "([^"]+)"\)(?:\.map_err\(\|e\| e\.to_string\(\)\))?\?;\n/g,
    (full, attr, otherAttrs, sig, fnName, literal) => {
      if (literal !== fnName) { fileSkipped++; return full; }
      fileMigrated++;
      return attr + otherAttrs + '#[requires(privileged)]\n' + sig;
    }
  );

  // Async privileged: pub async fn NAME(...) ... {\n    require_privileged(&state, "NAME").await?;\n
  // Allow optional .map_err(...) on the same chain, and allow the chain to
  // wrap across lines (the await + map_err on subsequent indented lines).
  src = src.replace(
    /(#\[tauri::command\]\n)((?:#\[[^\]]+\]\n)*)(pub async fn (\w+)[^{]*\{\n)    require_privileged\(&state, "([^"]+)"\)\s*\n?\s*\.await(?:\s*\n?\s*\.map_err\(\|e\| e\.to_string\(\)\))?\?;\n/g,
    (full, attr, otherAttrs, sig, fnName, literal) => {
      if (literal !== fnName) { fileSkipped++; return full; }
      fileMigrated++;
      return attr + otherAttrs + '#[requires(privileged)]\n' + sig;
    }
  );

  // Cloud (always async): pub async fn NAME(...) ... {\n    require_cloud_auth(&state, "NAME").await?;\n
  src = src.replace(
    /(#\[tauri::command\]\n)((?:#\[[^\]]+\]\n)*)(pub async fn (\w+)[^{]*\{\n)    require_cloud_auth\(&state, "([^"]+)"\)\s*\n?\s*\.await(?:\s*\n?\s*\.map_err\(\|e\| e\.to_string\(\)\))?\?;\n/g,
    (full, attr, otherAttrs, sig, fnName, literal) => {
      if (literal !== fnName) { fileSkipped++; return full; }
      fileMigrated++;
      return attr + otherAttrs + '#[requires(cloud)]\n' + sig;
    }
  );

  // If we migrated anything, ensure the macro import is present.
  if (fileMigrated > 0 && !/use personas_macros::requires;/.test(src)) {
    // Insert after the last `use crate::` line.
    const lines = src.split('\n');
    let lastUseCrate = -1;
    for (let i = 0; i < lines.length; i++) {
      if (/^use crate::/.test(lines[i])) lastUseCrate = i;
    }
    if (lastUseCrate >= 0) {
      lines.splice(lastUseCrate + 1, 0, 'use personas_macros::requires;');
      src = lines.join('\n');
    } else {
      console.warn(`  ${file}: could not find a 'use crate::' anchor to insert macro import — add manually`);
    }
  }

  // Clean up now-unused require_* names from `use crate::ipc_auth::{...}` blocks.
  // After migration, the file may still use the helpers from non-Tauri-command
  // paths (e.g. helper functions). Conservative: only trim names that no longer
  // appear elsewhere in the file body.
  src = src.replace(
    /use crate::ipc_auth::\{([^}]+)\};/g,
    (full, inner) => {
      const items = inner.split(',').map(s => s.trim()).filter(Boolean);
      const kept = items.filter(item => {
        // Check if the bare name still appears anywhere in the file outside the
        // import statement itself.
        const re = new RegExp(`\\b${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        const matches = [...src.matchAll(re)];
        // The import statement itself counts as 1 occurrence; we want > 1
        return matches.length > 1;
      });
      if (kept.length === 0) return ''; // strip the whole line
      if (kept.length === items.length) return full; // no change
      return `use crate::ipc_auth::{${kept.join(', ')}};`;
    }
  );

  // Collapse any blank lines left behind by an empty import strip.
  src = src.replace(/\n\n\n+/g, '\n\n');

  // Also handle bare `use crate::ipc_auth::require_*;` (no braces). Strip when
  // the bare name no longer appears anywhere else in the file body.
  src = src.replace(
    /use crate::ipc_auth::(require_(?:auth_sync|auth|privileged_sync|privileged|cloud_auth));\n/g,
    (full, name) => {
      const re = new RegExp(`\\b${name}\\b`, 'g');
      const matches = [...src.matchAll(re)];
      return matches.length > 1 ? full : '';
    }
  );

  if (fileMigrated > 0 || fileSkipped > 0) {
    // Re-apply original line endings before writing.
    const out = eol === '\r\n' ? src.replaceAll('\n', '\r\n') : src;
    fs.writeFileSync(file, out);
    console.log(`${file}: migrated ${fileMigrated}, skipped ${fileSkipped}`);
  }
  totalMigrated += fileMigrated;
  totalSkipped += fileSkipped;
}

console.log(`\nTotal migrated: ${totalMigrated}, skipped: ${totalSkipped}`);
