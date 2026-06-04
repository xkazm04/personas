#!/usr/bin/env node

/**
 * Generate a complete favicon / PWA icon set from a single square source PNG.
 *
 * Outputs (default):
 *   icon-16.png       (legacy favicon)
 *   icon-32.png       (legacy favicon)
 *   icon-48.png       (legacy favicon)
 *   icon-96.png       (Android)
 *   apple-touch-icon.png  (180x180, iOS)
 *   icon-192.png      (PWA)
 *   icon-512.png      (PWA)
 *
 *   node favicon-set.mjs --input PATH --output-dir DIR [--sizes 16,32,48,96,180,192,512]
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import { createRequire } from 'module';

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { args[key] = next; i++; }
      else { args[key] = true; }
    }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.input || !args['output-dir']) {
  console.error('Usage: favicon-set.mjs --input PATH --output-dir DIR [--sizes 16,32,48,96,180,192,512]');
  process.exit(1);
}

const inputPath = resolve(args.input);
const outDir    = resolve(args['output-dir']);
const sizesArg  = args.sizes || '16,32,48,96,180,192,512';
const sizes     = sizesArg.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);

let sharp;
const candidates = [
  resolve(process.cwd(), 'node_modules/sharp'),
  resolve(inputPath, '../../../node_modules/sharp'),
  resolve(inputPath, '../../../../node_modules/sharp'),
];
for (const c of candidates) {
  try { sharp = createRequire(c + '/').apply(null, [c]); break; } catch {}
}
if (!sharp) {
  try { sharp = (await import('sharp')).default; } catch {}
}
if (!sharp) {
  console.error(JSON.stringify({ error: 'sharp not found' }));
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

const outputs = [];
for (const size of sizes) {
  const name = size === 180 ? 'apple-touch-icon.png' : `icon-${size}.png`;
  const outPath = join(outDir, name);
  await sharp(inputPath)
    .resize(size, size, { fit: 'cover', kernel: 'lanczos3' })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
  outputs.push({ size, path: outPath });
}

console.log(JSON.stringify({
  success: true,
  source: inputPath,
  outputDir: outDir,
  outputs,
}, null, 2));
