/**
 * bundle-graph — records the app build's chunk graph for the bundle budget.
 *
 * `scripts/check-bundle-budget.mjs` used to see only `dist/assets/*.js` file
 * names, so it keyed chunks as `<name>`, `<name>#2`, ... in size order. Two
 * lazy chunks that share a name (one per locale, one per route that happens
 * to be called `index`) swapped keys whenever their sizes crossed, and a
 * module moving from one chunk into another read as growth. It also could not
 * tell what the app loads at startup from what it loads on demand.
 *
 * This plugin writes, per emitted chunk: its file, the source module it is
 * the facade of (the `import()` target or the HTML entry), whether it is an
 * entry, and its static imports. The budget keys chunks by that source path
 * and sums the entry's static closure as "startup JS".
 *
 * Written OUTSIDE dist/ (dist is the Tauri frontend, shipped in installers):
 * `node_modules/.cache/personas/bundle-graph.json`. Only the app build writes
 * it - a bundle whose entry is not index.html (a worker) is skipped, so a
 * worker build cannot overwrite the app's graph.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const BUNDLE_GRAPH_PATH = path.join('node_modules', '.cache', 'personas', 'bundle-graph.json');

export function bundleGraphPlugin({ root }) {
  const rel = (id) => (id ? path.relative(root, id.split('?')[0]).split(path.sep).join('/') : null);
  return {
    name: 'bundle-graph',
    apply: 'build',
    // writeBundle, not generateBundle: Vite drops the empty JS shell of a
    // CSS-only chunk in its own generateBundle, after a user plugin's ran, so
    // only here does `bundle` hold exactly the files written to dist/.
    writeBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter((o) => o.type === 'chunk');
      if (!chunks.some((c) => c.isEntry && /index\.html$/.test(c.facadeModuleId ?? ''))) return;
      const graph = {
        schema: 1,
        chunks: chunks
          .map((c) => ({
            file: path.basename(c.fileName),
            name: c.name,
            facade: rel(c.facadeModuleId),
            isEntry: c.isEntry,
            isDynamicEntry: c.isDynamicEntry,
            imports: c.imports.filter((f) => f in bundle).map((f) => path.basename(f)),
          }))
          .sort((a, b) => a.file.localeCompare(b.file)),
      };
      const out = path.join(root, BUNDLE_GRAPH_PATH);
      mkdirSync(path.dirname(out), { recursive: true });
      writeFileSync(out, JSON.stringify(graph) + '\n');
    },
  };
}
