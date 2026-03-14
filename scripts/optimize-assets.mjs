#!/usr/bin/env node
/**
 * optimize-assets.mjs — Compress PNG images in public/ to WebP format.
 *
 * Uses the `sharp` package (if installed) to convert PNGs to WebP with
 * quality 80, then reports size savings. Does NOT delete originals — it
 * creates .webp siblings so you can migrate imports incrementally.
 *
 * Usage:  node scripts/optimize-assets.mjs [--dry-run] [--delete-originals]
 *
 * If sharp is not installed, prints a report of what WOULD be optimized
 * and the estimated savings based on typical WebP compression ratios.
 */

import { readdirSync, statSync, existsSync } from "fs";
import { join, extname, relative } from "path";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const DELETE_ORIGINALS = args.includes("--delete-originals");
const PUBLIC_DIR = join(process.cwd(), "public");

function walkDir(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (extname(entry.name).toLowerCase() === ".png") {
      results.push(fullPath);
    }
  }
  return results;
}

const pngs = walkDir(PUBLIC_DIR);
let totalOriginalKB = 0;
let totalOptimizedKB = 0;

console.log(`\nAsset Optimization Report`);
console.log(`${"─".repeat(70)}`);
console.log(`  Found ${pngs.length} PNG files in public/\n`);

let sharp;
try {
  sharp = (await import("sharp")).default;
} catch {
  sharp = null;
}

if (!sharp) {
  console.log("  sharp not installed — showing estimated savings only.");
  console.log("  Install with: npm install --save-dev sharp\n");

  for (const png of pngs) {
    const sizeKB = statSync(png).size / 1024;
    const estimatedWebP = sizeKB * 0.3; // WebP typically 70% smaller
    totalOriginalKB += sizeKB;
    totalOptimizedKB += estimatedWebP;
    console.log(
      `  ${sizeKB.toFixed(1).padStart(8)} KB → ~${estimatedWebP.toFixed(1).padStart(6)} KB  ${relative(PUBLIC_DIR, png)}`
    );
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(
    `  Estimated savings: ${totalOriginalKB.toFixed(0)} KB → ~${totalOptimizedKB.toFixed(0)} KB (${((1 - totalOptimizedKB / totalOriginalKB) * 100).toFixed(0)}% reduction)`
  );
  console.log(`\n  To convert, install sharp and run without --dry-run.`);
  process.exit(0);
}

// With sharp available, actually convert
for (const png of pngs) {
  const sizeKB = statSync(png).size / 1024;
  totalOriginalKB += sizeKB;
  const webpPath = png.replace(/\.png$/i, ".webp");

  if (DRY_RUN) {
    const estimatedWebP = sizeKB * 0.3;
    totalOptimizedKB += estimatedWebP;
    console.log(
      `  [DRY] ${sizeKB.toFixed(1).padStart(8)} KB → ~${estimatedWebP.toFixed(1).padStart(6)} KB  ${relative(PUBLIC_DIR, png)}`
    );
    continue;
  }

  try {
    await sharp(png).webp({ quality: 80 }).toFile(webpPath);
    const webpSizeKB = statSync(webpPath).size / 1024;
    totalOptimizedKB += webpSizeKB;
    const pct = ((1 - webpSizeKB / sizeKB) * 100).toFixed(0);
    console.log(
      `  ${sizeKB.toFixed(1).padStart(8)} KB → ${webpSizeKB.toFixed(1).padStart(6)} KB (${pct}%)  ${relative(PUBLIC_DIR, png)}`
    );

    if (DELETE_ORIGINALS) {
      const { unlinkSync } = await import("fs");
      unlinkSync(png);
    }
  } catch (err) {
    console.log(`  ERROR: ${relative(PUBLIC_DIR, png)}: ${err.message}`);
  }
}

console.log(`\n${"─".repeat(70)}`);
const saving = totalOriginalKB > 0 ? ((1 - totalOptimizedKB / totalOriginalKB) * 100).toFixed(0) : 0;
console.log(
  `  Total: ${totalOriginalKB.toFixed(0)} KB → ${totalOptimizedKB.toFixed(0)} KB (${saving}% reduction)`
);
if (!DRY_RUN && !DELETE_ORIGINALS) {
  console.log(`\n  WebP files created alongside PNGs. Update imports and re-run with --delete-originals to clean up.`);
}
