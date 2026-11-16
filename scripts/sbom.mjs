#!/usr/bin/env node
// sbom - a CycloneDX 1.5 bill of materials for a release, from the committed lockfiles. No npm dependency: it reads
// package-lock.json (lockfileVersion 2/3 `packages`) and src-tauri/Cargo.lock and writes one SBOM per ecosystem.
//
//   node scripts/sbom.mjs [--root <dir>] [--out <dir>] [--version <v>]
//
// --root defaults to the repo root, --out to <root>/dist/sbom, --version to <root>/package.json's version. It writes
// personas-<version>.npm.cdx.json and personas-<version>.cargo.cdx.json and prints one JSON line
// {files, npm, cargo} (the component counts). What ships: npm entries that are not `dev: true` (the frontend bundle's
// inputs; build tooling is left out), and every Cargo package with a `source` (registry or git; the workspace's own
// path crates are the product, not a dependency). Exit 0 written, 2 a bad flag or a missing lockfile (nothing written).
//
// Slice 1 of DW-53. The release workflow does not run it yet: attaching both files to each GitHub release is slice 2
// (docs/development/release.md, "SBOM").
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const USAGE = 'usage: node scripts/sbom.mjs [--root <dir>] [--out <dir>] [--version <v>]';
const NM = 'node_modules/';

/** @param {string} name @param {string} version */
const npmPurl = (name, version) => `pkg:npm/${name.startsWith('@') ? `%40${name.slice(1)}` : name}@${version}`;

/** @param {string} name @param {string} version @param {string} purl */
const component = (name, version, purl) => ({ type: 'library', name, version, purl, 'bom-ref': purl });

/** Unique by purl, sorted by purl. @param {ReturnType<typeof component>[]} list */
const uniqueSorted = (list) => {
  const byPurl = new Map();
  for (const c of list) if (!byPurl.has(c.purl)) byPurl.set(c.purl, c);
  return [...byPurl.values()].sort((a, b) => (a.purl < b.purl ? -1 : a.purl > b.purl ? 1 : 0));
};

/** The shipped npm components of a package-lock.json object. @param {any} lock */
export function npmComponents(lock) {
  const out = [];
  for (const [key, entry] of Object.entries(lock?.packages ?? {})) {
    if (!key.startsWith(NM) || !entry || typeof entry !== 'object') continue;
    if (entry.dev === true || entry.link === true || typeof entry.version !== 'string' || !entry.version) continue;
    const name = key.slice(key.lastIndexOf(NM) + NM.length);
    out.push(component(name, entry.version, npmPurl(name, entry.version)));
  }
  return uniqueSorted(out);
}

/** The third-party crates of a Cargo.lock text (packages with a `source`). @param {string} text */
export function cargoComponents(text) {
  const out = [];
  for (const block of String(text).split(/^\[\[package\]\]\s*$/m).slice(1)) {
    /** @param {string} k */
    const field = (k) => block.match(new RegExp(`^${k}\\s*=\\s*"([^"]*)"`, 'm'))?.[1];
    const name = field('name');
    const version = field('version');
    if (!name || !version || !field('source')) continue;
    out.push(component(name, version, `pkg:cargo/${name}@${version}`));
  }
  return uniqueSorted(out);
}

/** A CycloneDX 1.5 document. @param {ReturnType<typeof component>[]} components @param {{name: string, version: string}} app */
export function bom(components, app) {
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: 'application', name: 'personas-sbom', version: '1' }] },
      component: { type: 'application', name: app.name, version: app.version },
    },
    components,
  };
}

/** @param {string[]} argv */
function parse(argv) {
  /** @type {Record<string, string>} */
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i].replace(/^--/, '');
    if (!['root', 'out', 'version'].includes(flag) || !argv[i].startsWith('--')) throw new Error(`unknown argument ${argv[i]}`);
    const value = argv[++i];
    if (value === undefined || value.startsWith('--')) throw new Error(`--${flag} needs a value`);
    o[flag] = value;
  }
  return o;
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  let o;
  try {
    o = parse(argv);
  } catch (e) {
    console.error(`sbom: ${/** @type {Error} */ (e).message}\n${USAGE}`);
    return 2;
  }
  const root = resolve(o.root ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
  const npmLock = join(root, 'package-lock.json');
  const cargoLock = join(root, 'src-tauri', 'Cargo.lock');
  for (const f of [npmLock, cargoLock]) {
    if (!existsSync(f)) {
      console.error(`sbom: ${f} is missing; nothing written`);
      return 2;
    }
  }
  let version = o.version;
  if (!version) {
    const pkg = join(root, 'package.json');
    version = existsSync(pkg) ? JSON.parse(readFileSync(pkg, 'utf8')).version : undefined;
    if (!version) {
      console.error('sbom: no --version and no version in package.json; nothing written');
      return 2;
    }
  }
  const npm = npmComponents(JSON.parse(readFileSync(npmLock, 'utf8')));
  const cargo = cargoComponents(readFileSync(cargoLock, 'utf8'));
  const outDir = resolve(o.out ?? join(root, 'dist', 'sbom'));
  mkdirSync(outDir, { recursive: true });
  const app = { name: 'personas', version };
  const files = [];
  for (const [kind, list] of /** @type {const} */ ([['npm', npm], ['cargo', cargo]])) {
    const file = join(outDir, `personas-${version}.${kind}.cdx.json`);
    writeFileSync(file, `${JSON.stringify(bom(list, app), null, 2)}\n`);
    files.push(file);
  }
  console.log(JSON.stringify({ files, npm: npm.length, cargo: cargo.length }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = main(process.argv.slice(2));
