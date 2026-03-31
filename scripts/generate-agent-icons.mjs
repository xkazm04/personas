#!/usr/bin/env node
/**
 * Generate all 40 agent icons (20 dark + 20 light) with transparent backgrounds.
 * Pipeline: generate with --no-cleanup → remove-bg → save → cleanup cloud.
 *
 * Usage: node scripts/generate-agent-icons.mjs
 * Requires: LEONARDO_API_KEY in .env
 */
import { execSync } from 'child_process';
import { existsSync, unlinkSync } from 'fs';

const TOOL = '.claude/skills/leonardo/tools/leonardo-image.mjs';
const OUT_DIR = 'public/agent_icons';

const ICONS = [
  { id: 'assistant',    dark: 'friendly AI robot assistant head, geometric, neon cyan glow lines',                   light: 'friendly AI robot assistant head, geometric, solid dark blue-gray shapes' },
  { id: 'code',         dark: 'angle brackets with a gear cog, code and development, neon blue glow lines',          light: 'angle brackets with a gear cog, code and development, solid dark blue shapes' },
  { id: 'data',         dark: 'data chart with flowing data streams, analytics, neon blue glow lines',               light: 'data chart with flowing data streams, analytics, solid dark blue shapes' },
  { id: 'security',     dark: 'shield with a lock, security, neon red glow lines',                                   light: 'shield with a lock, security, solid dark red shapes' },
  { id: 'monitor',      dark: 'radar pulse screen with signal waves, monitoring, neon amber glow lines',             light: 'radar pulse screen with signal waves, monitoring, solid dark amber shapes' },
  { id: 'email',        dark: 'envelope with lightning bolt, email communication, neon pink glow lines',              light: 'envelope with lightning bolt, email communication, solid dark pink shapes' },
  { id: 'document',     dark: 'document page with magnifying glass, document intelligence, neon purple glow lines',  light: 'document page with magnifying glass, document intelligence, solid dark purple shapes' },
  { id: 'support',      dark: 'headset with speech bubble, customer support, neon teal glow lines',                  light: 'headset with speech bubble, customer support, solid dark teal shapes' },
  { id: 'automation',   dark: 'interlocking gears with lightning bolt, workflow automation, neon orange glow lines',  light: 'interlocking gears with lightning bolt, workflow automation, solid dark orange shapes' },
  { id: 'research',     dark: 'microscope with atomic orbits, research, neon indigo glow lines',                     light: 'microscope with atomic orbits, research, solid dark indigo shapes' },
  { id: 'finance',      dark: 'dollar sign inside circular graph, finance, neon green glow lines',                   light: 'dollar sign inside circular graph, finance, solid dark green shapes' },
  { id: 'marketing',    dark: 'megaphone with growth arrow, marketing, neon magenta glow lines',                     light: 'megaphone with growth arrow, marketing, solid dark magenta shapes' },
  { id: 'devops',       dark: 'server rack with pipeline arrows, DevOps infrastructure, neon sky-blue glow lines',   light: 'server rack with pipeline arrows, DevOps infrastructure, solid dark blue shapes' },
  { id: 'content',      dark: 'pen writing on document with flowing lines, content creation, neon purple glow lines', light: 'pen writing on document with flowing lines, content creation, solid dark purple shapes' },
  { id: 'sales',        dark: 'handshake with upward trend arrow, sales, neon orange glow lines',                    light: 'handshake with upward trend arrow, sales, solid dark orange shapes' },
  { id: 'hr',           dark: 'two people silhouettes with plus sign, human resources, neon green glow lines',       light: 'two people silhouettes with plus sign, human resources, solid dark green shapes' },
  { id: 'legal',        dark: 'balanced scale with gavel, legal, neon silver-gray glow lines',                       light: 'balanced scale with gavel, legal, solid dark gray shapes' },
  { id: 'notification', dark: 'bell with radiating notification waves, alerts, neon yellow glow lines',               light: 'bell with radiating notification waves, alerts, solid dark amber shapes' },
  { id: 'calendar',     dark: 'calendar grid with clock, scheduling, neon teal glow lines',                          light: 'calendar grid with clock, scheduling, solid dark teal shapes' },
  { id: 'search',       dark: 'magnifying glass over globe with connection nodes, search, neon indigo glow lines',   light: 'magnifying glass over globe with connection nodes, search, solid dark indigo shapes' },
];

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 120_000 });
    return JSON.parse(out.split('\n').filter(l => l.startsWith('{')).pop());
  } catch (e) {
    console.error(`FAILED: ${e.message}`);
    return null;
  }
}

async function generateIcon(id, promptDesc, theme, bgDesc, contrast) {
  const finalOutput = `${OUT_DIR}/${id}-${theme}.png`;
  const tmpOutput = `${OUT_DIR}/${id}-${theme}-tmp.png`;
  const prompt = `Minimal flat icon of ${promptDesc}, centered, clean edges, modern tech aesthetic, no text, isolated on ${bgDesc}`;

  console.log(`[${id}-${theme}] Generating...`);
  const gen = run(`node ${TOOL} generate --prompt "${prompt}" --output "${tmpOutput}" --width 512 --height 512 --style dynamic --contrast ${contrast} --no-cleanup`);
  if (!gen?.imageId) { console.error(`[${id}-${theme}] Generation failed`); return; }

  console.log(`[${id}-${theme}] Removing background...`);
  const bg = run(`node ${TOOL} remove-bg --id ${gen.imageId} --output "${finalOutput}"`);
  if (!bg?.success) { console.error(`[${id}-${theme}] BG removal failed`); return; }

  // Cleanup tmp
  if (existsSync(tmpOutput)) unlinkSync(tmpOutput);
  console.log(`[${id}-${theme}] Done (${bg.sizeBytes} bytes)`);
}

// Process in batches of 3 to avoid API rate limits
const BATCH_SIZE = 3;
const tasks = [];
for (const icon of ICONS) {
  tasks.push({ ...icon, theme: 'dark', desc: icon.dark, bg: 'solid black background', contrast: '3.5' });
  tasks.push({ ...icon, theme: 'light', desc: icon.light, bg: 'pure white background', contrast: '2.5' });
}

console.log(`Generating ${tasks.length} icons in batches of ${BATCH_SIZE}...`);
for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
  const batch = tasks.slice(i, i + BATCH_SIZE);
  await Promise.all(batch.map(t => generateIcon(t.id, t.desc, t.theme, t.bg, t.contrast)));
  console.log(`--- Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(tasks.length / BATCH_SIZE)} complete ---`);
}
console.log('All icons generated!');
