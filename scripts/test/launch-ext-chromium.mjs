/**
 * Launch Playwright's Chromium with the Athena Browser Bridge extension
 * loaded — the QA path for extension live tests.
 *
 * Why not branded Chrome: stable Chrome removed `--load-extension` support
 * (Chrome 137, 2025), so automated extension loading needs the open-source
 * Chromium build Playwright ships.
 *
 * Usage:
 *   node scripts/test/launch-ext-chromium.mjs [--profile <dir>]
 *
 * Pair it by writing tools/athena-browser-extension/config.json
 * ({"port":..., "token":...}) before launching — see the extension README.
 * Keeps running until Ctrl-C / killed.
 */
import { chromium } from 'playwright';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXT = join(ROOT, 'tools', 'athena-browser-extension');

const args = process.argv.slice(2);
const profileIdx = args.indexOf('--profile');
const profile =
  profileIdx >= 0 && args[profileIdx + 1]
    ? args[profileIdx + 1]
    : mkdtempSync(join(tmpdir(), 'athena-ext-qa-'));

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: null,
  args: [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    '--no-first-run',
    '--no-default-browser-check',
  ],
});
console.log(`[ext-chromium] up — extension dir: ${EXT}`);
console.log(`[ext-chromium] profile: ${profile}`);
// Keep one page open so the window stays; the extension drives its own tab.
const pages = ctx.pages();
if (pages.length === 0) await ctx.newPage();

process.on('SIGINT', async () => {
  await ctx.close();
  process.exit(130);
});
