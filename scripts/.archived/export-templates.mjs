#!/usr/bin/env node
/**
 * Export template design reviews from the local SQLite database to CSV.
 * Usage: node scripts/export-templates.mjs
 * Output: scripts/templates-export.csv
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import initSqlJs from 'sql.js';

const DB_PATH = join(process.env.APPDATA, 'com.personas.desktop', 'personas.db');

function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const SQL = await initSqlJs();
  const buf = readFileSync(DB_PATH);
  const db = new SQL.Database(buf);

  // Query design reviews — the main template store
  const rows = db.exec(`
    SELECT
      test_case_name,
      instruction,
      connectors_used,
      design_result,
      status,
      structural_score,
      semantic_score,
      reviewed_at
    FROM persona_design_reviews
    ORDER BY reviewed_at DESC
  `);

  if (!rows.length || !rows[0].values.length) {
    console.log('No design reviews found in DB.');
    db.close();
    return;
  }

  const records = rows[0].values.map(row => {
    const [name, instruction, connectorsUsed, designResultJson, status, structScore, semScore, reviewedAt] = row;

    let description = '';
    let connectors = connectorsUsed || '';

    // Parse design_result JSON for richer data
    if (designResultJson) {
      try {
        const dr = JSON.parse(designResultJson);

        // Description: prefer summary, fall back to persona_meta
        description = dr.summary || dr.persona_meta?.description || '';

        // Connectors: prefer suggested_connectors array
        if (dr.suggested_connectors && dr.suggested_connectors.length) {
          connectors = dr.suggested_connectors.map(c => c.name || c.label || c.service).join('; ');
        } else if (dr.service_flow && dr.service_flow.length) {
          connectors = dr.service_flow.join('; ');
        } else if (!connectors && dr.suggested_tools) {
          // Fall back to tools that imply connectors
          const connectorTools = dr.suggested_tools.filter(t =>
            t.category === 'connector' || t.category === 'integration'
          );
          if (connectorTools.length) {
            connectors = connectorTools.map(t => t.name).join('; ');
          }
        }
      } catch (_e) {
        // design_result not valid JSON, keep defaults
      }
    }

    return { name, description, connectors, status, structScore, semScore, reviewedAt };
  });

  // Deduplicate: keep only the latest review per template name
  // (records are already sorted by reviewed_at DESC from the query)
  const seen = new Set();
  const unique = records.filter(r => {
    const key = r.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Build CSV
  const header = ['Name', 'Description', 'Connectors', 'Status', 'Structural Score', 'Semantic Score', 'Reviewed At'];
  const csvLines = [
    header.join(','),
    ...unique.map(r => [
      escapeCsv(r.name),
      escapeCsv(r.description),
      escapeCsv(r.connectors),
      escapeCsv(r.status),
      escapeCsv(r.structScore),
      escapeCsv(r.semScore),
      escapeCsv(r.reviewedAt),
    ].join(','))
  ];

  const outPath = join(process.cwd(), 'scripts', 'templates-export.csv');
  writeFileSync(outPath, csvLines.join('\n'), 'utf-8');
  console.log(`Exported ${unique.length} unique templates (from ${records.length} total reviews) to ${outPath}`);

  db.close();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
