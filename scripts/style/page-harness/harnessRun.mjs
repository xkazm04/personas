// Shared by the lifecycle probes (scripts/style/lifecycle-perf.mjs, lifecycle-a11y.mjs): the page
// harness served by Vite (dev, own dep cache per port) or as a production build, and the
// headless Chromium the shooter uses (shoot.mjs keeps its own copy of both).
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const HARNESS = '/scripts/style/page-harness/index.html';

/** A production build of the harness, served statically; React's profiling build keeps the Profiler alive. */
async function startProdServer(port, dist) {
  const { build, preview } = await import('vite');
  await build({
    configFile: join(REPO, 'vite.config.ts'),
    root: REPO,
    mode: 'production',
    logLevel: 'warn',
    resolve: { alias: [{ find: /^react-dom\/client$/, replacement: 'react-dom/profiling' }] },
    build: { outDir: dist, emptyOutDir: true, rolldownOptions: { input: join(REPO, HARNESS.slice(1)) } },
  });
  const server = await preview({
    configFile: join(REPO, 'vite.config.ts'),
    root: REPO,
    logLevel: 'warn',
    build: { outDir: dist },
    preview: { port, strictPort: true, host: '127.0.0.1' },
  });
  return { server: { close: () => new Promise((res) => server.httpServer.close(res)) }, url: `http://127.0.0.1:${port}` };
}

export async function startHarnessServer({ port, prod = false, dist }) {
  if (prod) return startProdServer(port, dist);
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: join(REPO, 'vite.config.ts'),
    root: REPO,
    cacheDir: join(REPO, 'node_modules', `.vite-page-harness-${port}`),
    logLevel: 'warn',
    clearScreen: false,
    optimizeDeps: { entries: [HARNESS.slice(1)] },
    server: { port, strictPort: true, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  return { server, url: `http://127.0.0.1:${port}` };
}

/** The pinned headless shell, else the newest cached one (the same rule as shoot.mjs). */
export async function launchHarnessBrowser() {
  const { chromium } = await import('playwright');
  try {
    return await chromium.launch();
  } catch (err) {
    if (!/Executable doesn't exist/.test(String(err?.message))) throw err;
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    const builds = (existsSync(cache) ? readdirSync(cache) : [])
      .map((d) => /^chromium_headless_shell-(\d+)$/.exec(d)).filter(Boolean)
      .map((m) => ({ dir: m[0], rev: Number(m[1]) })).sort((a, b) => b.rev - a.rev);
    for (const b of builds) {
      const exe = join(cache, b.dir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
      if (existsSync(exe)) return chromium.launch({ executablePath: exe });
    }
    throw err;
  }
}

