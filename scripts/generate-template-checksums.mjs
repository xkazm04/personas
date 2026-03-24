#!/usr/bin/env node
/**
 * Generates template checksum manifests for both frontend (TypeScript)
 * and backend (Rust) from template JSON files.
 *
 * Outputs:
 *   - src/lib/personas/templates/templateChecksums.ts   (frontend)
 *   - src-tauri/src/engine/template_checksums.rs         (backend)
 *
 * Run with:
 *   node scripts/generate-template-checksums.mjs
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT, 'scripts', 'templates');
const OUTPUT_FILE = join(ROOT, 'src', 'lib', 'personas', 'templates', 'templateChecksums.ts');
const RUST_OUTPUT_FILE = join(ROOT, 'src-tauri', 'src', 'engine', 'template_checksums.rs');

function computeContentHashSync(content) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(16, '0');
}

function findJsonFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
      continue;
    }
    if (entry.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results;
}

const files = findJsonFiles(TEMPLATES_DIR).sort();
const checksums = {};

for (const filePath of files) {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw);
  const canonical = JSON.stringify(parsed);
  const rel = relative(TEMPLATES_DIR, filePath).replace(/\\/g, '/');
  checksums[rel] = computeContentHashSync(canonical);
}

const outputLines = [
  '/**',
  ' * Auto-generated template checksums - DO NOT EDIT MANUALLY.',
  ' * Regenerate with: node scripts/generate-template-checksums.mjs',
  ' */',
  '',
  'export const TEMPLATE_CHECKSUMS: Record<string, string> = {',
];

for (const [rel, checksum] of Object.entries(checksums)) {
  outputLines.push(`  '${rel}': '${checksum}',`);
}

outputLines.push('};');
outputLines.push('');

writeFileSync(OUTPUT_FILE, outputLines.join('\n'), 'utf-8');
console.log(`Generated ${OUTPUT_FILE} with ${files.length} checksums`);

// -- Generate Rust backend manifest -------------------------------------------

const rustLines = [
  '// Auto-generated template checksum manifest for backend integrity verification.',
  '// DO NOT EDIT MANUALLY. Regenerate with: node scripts/generate-template-checksums.mjs',
  '//',
  '// The frontend bundle also contains these checksums, but an attacker with local',
  '// file access could tamper with both template JSON files and the JS bundle.',
  '// Embedding the manifest in the native Rust binary provides defense-in-depth:',
  '// the compiled binary is significantly harder to modify without detection.',
  '',
  'use std::collections::HashMap;',
  'use std::sync::LazyLock;',
  '',
  '/// Embedded checksum manifest: maps relative template path → expected hash.',
  '/// Populated at compile time from the same source of truth as the frontend.',
  'static CHECKSUM_MANIFEST: LazyLock<HashMap<&\'static str, &\'static str>> = LazyLock::new(|| {',
  `    let mut m = HashMap::with_capacity(${files.length});`,
];

for (const [rel, checksum] of Object.entries(checksums)) {
  rustLines.push(`    m.insert("${rel}", "${checksum}");`);
}

rustLines.push('    m');
rustLines.push('});');
rustLines.push('');
rustLines.push('/// Compute the same deterministic content hash used by the frontend.');
rustLines.push('///');
rustLines.push('/// This is a port of the JavaScript `computeContentHashSync` function.');
rustLines.push('/// It operates on UTF-16 code units (JavaScript\\\'s string encoding) to');
rustLines.push('/// produce identical results for the same input string.');
rustLines.push('pub fn compute_content_hash(content: &str) -> String {');
rustLines.push('    let mut h1: u32 = 0xDEAD_BEEF;');
rustLines.push('    let mut h2: u32 = 0x41C6_CE57;');
rustLines.push('');
rustLines.push('    for ch in content.encode_utf16() {');
rustLines.push('        let ch = ch as u32;');
rustLines.push('        h1 = (h1 ^ ch).wrapping_mul(2_654_435_761);');
rustLines.push('        h2 = (h2 ^ ch).wrapping_mul(1_597_334_677);');
rustLines.push('    }');
rustLines.push('');
rustLines.push('    h1 = (h1 ^ (h1 >> 16)).wrapping_mul(2_246_822_507);');
rustLines.push('    h1 ^= (h2 ^ (h2 >> 13)).wrapping_mul(3_266_489_909);');
rustLines.push('    h2 = (h2 ^ (h2 >> 16)).wrapping_mul(2_246_822_507);');
rustLines.push('    h2 ^= (h1 ^ (h1 >> 13)).wrapping_mul(3_266_489_909);');
rustLines.push('');
rustLines.push('    let combined: u64 = ((h2 as u64) & 0x1F_FFFF) << 32 | (h1 as u64);');
rustLines.push('    format!("{combined:016x}")');
rustLines.push('}');
rustLines.push('');
rustLines.push('/// Result of verifying a single template\\\'s integrity.');
rustLines.push('#[derive(Debug, serde::Serialize)]');
rustLines.push('#[serde(rename_all = "camelCase")]');
rustLines.push('pub struct TemplateIntegrityResult {');
rustLines.push('    pub path: String,');
rustLines.push('    pub expected_hash: Option<String>,');
rustLines.push('    pub actual_hash: String,');
rustLines.push('    pub valid: bool,');
rustLines.push('    pub is_known_template: bool,');
rustLines.push('}');
rustLines.push('');
rustLines.push('/// Verify a single template\\\'s content against the embedded manifest.');
rustLines.push('pub fn verify_template(path: &str, content: &str) -> TemplateIntegrityResult {');
rustLines.push('    let actual_hash = compute_content_hash(content);');
rustLines.push('    let expected = CHECKSUM_MANIFEST.get(path).copied();');
rustLines.push('    let valid = expected.map_or(false, |e| e == actual_hash);');
rustLines.push('');
rustLines.push('    TemplateIntegrityResult {');
rustLines.push('        path: path.to_string(),');
rustLines.push('        expected_hash: expected.map(String::from),');
rustLines.push('        actual_hash,');
rustLines.push('        valid,');
rustLines.push('        is_known_template: expected.is_some(),');
rustLines.push('    }');
rustLines.push('}');
rustLines.push('');
rustLines.push('/// Batch verification result.');
rustLines.push('#[derive(Debug, serde::Serialize)]');
rustLines.push('#[serde(rename_all = "camelCase")]');
rustLines.push('pub struct BatchIntegrityResult {');
rustLines.push('    pub results: Vec<TemplateIntegrityResult>,');
rustLines.push('    pub all_valid: bool,');
rustLines.push('    pub total: usize,');
rustLines.push('    pub valid_count: usize,');
rustLines.push('    pub invalid_count: usize,');
rustLines.push('    pub unknown_count: usize,');
rustLines.push('}');
rustLines.push('');
rustLines.push('/// Verify a batch of templates against the embedded manifest.');
rustLines.push('pub fn verify_templates_batch(templates: &[(String, String)]) -> BatchIntegrityResult {');
rustLines.push('    let results: Vec<TemplateIntegrityResult> = templates');
rustLines.push('        .iter()');
rustLines.push('        .map(|(path, content)| verify_template(path, content))');
rustLines.push('        .collect();');
rustLines.push('');
rustLines.push('    let valid_count = results.iter().filter(|r| r.valid).count();');
rustLines.push('    let invalid_count = results.iter().filter(|r| r.is_known_template && !r.valid).count();');
rustLines.push('    let unknown_count = results.iter().filter(|r| !r.is_known_template).count();');
rustLines.push('');
rustLines.push('    BatchIntegrityResult {');
rustLines.push('        all_valid: invalid_count == 0,');
rustLines.push('        total: results.len(),');
rustLines.push('        valid_count,');
rustLines.push('        invalid_count,');
rustLines.push('        unknown_count,');
rustLines.push('        results,');
rustLines.push('    }');
rustLines.push('}');
rustLines.push('');
rustLines.push('/// Get the number of entries in the embedded checksum manifest.');
rustLines.push('pub fn manifest_entry_count() -> usize {');
rustLines.push('    CHECKSUM_MANIFEST.len()');
rustLines.push('}');
rustLines.push('');

writeFileSync(RUST_OUTPUT_FILE, rustLines.join('\n'), 'utf-8');
console.log(`Generated ${RUST_OUTPUT_FILE} with ${files.length} checksums (Rust backend)`);
