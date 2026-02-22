#!/usr/bin/env node
/**
 * Generates src/lib/personas/templateIndex.ts with static imports for all
 * template JSON files found under scripts/templates/.
 *
 * Run after generate-templates.mjs completes to update the seed list.
 *
 * Usage: node scripts/generate-template-index.mjs
 */
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');
const TEMPLATES_DIR = join(ROOT, 'scripts', 'templates');
const OUTPUT_FILE = join(ROOT, 'src', 'lib', 'personas', 'templateIndex.ts');

function findJsonFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('_')) continue; // Skip _debug, _tmp, etc.
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...findJsonFiles(fullPath));
    } else if (entry.endsWith('.json')) {
      results.push(fullPath);
    }
  }
  return results;
}

const jsonFiles = findJsonFiles(TEMPLATES_DIR).sort();

console.log(`Found ${jsonFiles.length} template JSON files`);

// Generate import statements and export array
const lines = [
  '/**',
  ' * Auto-generated template index — DO NOT EDIT MANUALLY.',
  ' * Regenerate with: node scripts/generate-template-index.mjs',
  ' */',
  '',
];

const importNames = [];

for (const filePath of jsonFiles) {
  const relPath = relative(join(ROOT, 'src', 'lib', 'personas'), filePath).replace(/\\/g, '/');
  const slug = basename(filePath, '.json')
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/^_+|_+$/g, '');

  // Make unique by prefixing with category directory name
  const parts = filePath.replace(TEMPLATES_DIR, '').replace(/\\/g, '/').split('/').filter(Boolean);
  const category = parts.length > 1 ? parts[0].replace(/[^a-zA-Z0-9]/g, '_') : 'misc';
  const importName = `tpl_${category}_${slug}`;

  lines.push(`import ${importName} from '${relPath}';`);
  importNames.push(importName);
}

lines.push('');
lines.push('// eslint-disable-next-line @typescript-eslint/no-explicit-any');
lines.push(`export const allTemplates: any[] = [`);
for (const name of importNames) {
  lines.push(`  ${name},`);
}
lines.push('];');
lines.push('');

writeFileSync(OUTPUT_FILE, lines.join('\n'), 'utf-8');
console.log(`Generated ${OUTPUT_FILE} with ${importNames.length} template imports`);
