// Sync app-owned SYSTEM skills into the Tauri bundle resource dir so they ship
// in the installer. These are the skills the app itself dispatches (Onboard,
// …) which therefore cannot depend on the user's global ~/.claude/skills
// library. Source of truth is the git-tracked repo copy at .claude/skills/;
// this mirrors them to src-tauri/resources/skills/ (gitignored) which
// tauri.conf `bundle.resources` maps into <resource_dir>/skills/.
//
// Runs from `npm run build` (tauri's beforeBuildCommand), so the resource dir
// exists before Tauri collects bundle resources, AND from the predev/prebuild
// codegen presets — Tauri validates `bundle.resources` paths in dev mode too,
// so a checkout that only ever ran `tauri dev` would otherwise die with
// "resource path `resources\skills` doesn't exist". Idempotent + cheap; on a
// plain `vite build` (no packaging) it's harmless.
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const srcRoot = path.join(ROOT, '.claude', 'skills');

// Keep in lockstep with SYSTEM_SKILLS in
// src-tauri/src/commands/infrastructure/skill_files.rs. The `scan-*` preset
// dirs are discovered from the repo library so the list can't drift from what
// scan-agents-to-skills.mjs generated.
const SYSTEM_SKILLS = [
  'passport-onboard',
  ...readdirSync(srcRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('scan-'))
    .map((d) => d.name)
    .sort(),
];
const dstRoot = path.join(ROOT, 'src-tauri', 'resources', 'skills');

mkdirSync(dstRoot, { recursive: true });
let synced = 0;
for (const name of SYSTEM_SKILLS) {
  const src = path.join(srcRoot, name);
  if (!existsSync(src)) {
    console.warn(`[sync-system-skills] WARN: source skill missing: ${src}`);
    continue;
  }
  const dst = path.join(dstRoot, name);
  rmSync(dst, { recursive: true, force: true });
  cpSync(src, dst, { recursive: true });
  synced += 1;
}
console.log(`[sync-system-skills] mirrored ${synced}/${SYSTEM_SKILLS.length} system skill(s) → ${path.relative(ROOT, dstRoot)}`);
