#!/usr/bin/env node
// Exports the v3 recipe corpus (scripts/templates/_recipe_seeds.json) as a
// review spreadsheet: one row per recipe, columns Title, Description,
// Breakdown, Category, Subcategory, Connector type, Slug.
//
// Written 2026-09-06 for the operator's corpus review: 109 recipes are too
// many to read in the app one by one, so the review happens in a sheet and
// the feedback comes back keyed by Slug.
//
//   node scripts/templates/export-recipes-csv.mjs [out.csv]
//
// Excel-friendly: UTF-8 with BOM, CRLF row endings, multi-line cells quoted.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const SEEDS = path.join(ROOT, 'scripts', 'templates', '_recipe_seeds.json');
const OUT = process.argv[2] ?? path.join(ROOT, 'recipes_v3.csv');

const bundle = JSON.parse(fs.readFileSync(SEEDS, 'utf8'));
if (bundle.version !== 3) throw new Error(`expected a version-3 bundle, found ${bundle.version}`);

const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

function describe(d, fallback) {
  if (!d || typeof d !== 'object') return fallback ?? '';
  return [
    ['Need', d.need],
    ['Input', d.input],
    ['Core action', d.coreAction],
    ['Output', d.output],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function breakdown(activities) {
  if (!Array.isArray(activities)) return '';
  return activities.map((a, i) => `${i + 1}. ${a.label}${a.kind ? ` [${a.kind}]` : ''}`).join('\n');
}

function connectors(p) {
  const roles = Array.isArray(p.connectorRoles) ? p.connectorRoles : [];
  if (roles.length) return roles.map((r) => (r.role === r.type ? r.type : `${r.type} (${r.role})`)).join(', ');
  return Array.isArray(p.connectorTypes) ? p.connectorTypes.join(', ') : '';
}

const rows = bundle.recipes
  .map((seed) => {
    const p = JSON.parse(seed.prompt_template);
    const [category = p.domain ?? '', subcategory = ''] = String(p.path ?? '').split('/');
    return {
      title: p.title ?? seed.name,
      description: describe(p.description, seed.description),
      breakdown: breakdown(p.activities),
      category,
      subcategory,
      connectorType: connectors(p),
      slug: p.slug ?? seed.id,
    };
  })
  .sort((a, b) => a.category.localeCompare(b.category) || a.subcategory.localeCompare(b.subcategory) || a.title.localeCompare(b.title));

const header = ['Title', 'Description', 'Breakdown', 'Category', 'Subcategory', 'Connector type', 'Slug'];
const lines = [header.map(cell).join(',')];
for (const r of rows) {
  lines.push([r.title, r.description, r.breakdown, r.category, r.subcategory, r.connectorType, r.slug].map(cell).join(','));
}
fs.writeFileSync(OUT, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
console.log(`wrote ${OUT} (${rows.length} recipes)`);
