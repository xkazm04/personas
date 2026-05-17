#!/usr/bin/env node
/**
 * Render a Markdown report from the latest (or specified) perf-nav-walk run.
 *
 * Usage:
 *   node scripts/perf/render-perf-report.mjs                    # latest run, no diff
 *   node scripts/perf/render-perf-report.mjs --latest --diff    # latest run, diffed against previous
 *   node scripts/perf/render-perf-report.mjs --file <path>      # specific JSON
 *   node scripts/perf/render-perf-report.mjs --output <path>    # write to file instead of stdout
 *
 * Reads JSON written by tests/playwright/perf-nav-walk.spec.ts under
 * docs/harness/perf-runs/. Emits a ranked Markdown table per metric and,
 * with --diff, a delta-vs-previous summary so regressions are visible
 * across runs.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const RUNS_DIR = path.resolve(__dirname, '..', '..', 'docs', 'harness', 'perf-runs');

function parseArgs(argv) {
  const args = { latest: false, diff: false, file: null, output: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--latest') args.latest = true;
    else if (a === '--diff') args.diff = true;
    else if (a === '--file') args.file = argv[++i];
    else if (a === '--output') args.output = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(
        'Usage: render-perf-report.mjs [--latest] [--diff] [--file PATH] [--output PATH]',
      );
      process.exit(0);
    }
  }
  // Default to --latest if neither --file nor --latest passed.
  if (!args.file) args.latest = true;
  return args;
}

function listRunsSorted() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(RUNS_DIR, f))
    .sort(); // ISO timestamps sort lexicographically
}

function loadReport(p) {
  const text = fs.readFileSync(p, 'utf8');
  return JSON.parse(text);
}

function fmtMs(n) {
  if (n === undefined || n === null) return '-';
  if (n >= 100) return `${n.toFixed(0)}ms`;
  if (n >= 10) return `${n.toFixed(1)}ms`;
  return `${n.toFixed(2)}ms`;
}

function fmtDelta(curr, prev, unit = '') {
  if (prev === undefined || prev === null) return '';
  const d = curr - prev;
  if (Math.abs(d) < 0.5 && unit !== '') return ' (±0)';
  const sign = d > 0 ? '+' : '';
  const pct = prev > 0 ? ` ${((d / prev) * 100).toFixed(0)}%` : '';
  if (unit === 'ms') return ` (${sign}${fmtMs(d)}${pct})`;
  return ` (${sign}${d.toFixed(0)}${pct})`;
}

function buildStopMap(report) {
  const m = new Map();
  for (const s of report.stops) m.set(s.stop.id, s);
  return m;
}

function topCommands(stop, n = 3) {
  if (!stop.perf?.ipc?.byCommand) return '';
  return stop.perf.ipc.byCommand
    .slice(0, n)
    .map((c) => `\`${c.command}\`×${c.count}`)
    .join(', ');
}

function renderRunHeader(report, prev) {
  const lines = [];
  lines.push(`# Perf-walk report — ${report.meta.timestamp}`);
  lines.push('');
  lines.push(`> Bridge: \`${report.meta.bridgeUrl}\` | Stops measured: ${report.stops.length}`);
  if (prev) {
    lines.push(`> Comparing against previous run: \`${prev.meta.timestamp}\``);
  }
  lines.push('');
  // Run-wide totals
  let totalRenders = 0, totalIPC = 0, totalActualMs = 0;
  let prevRenders = 0, prevIPC = 0, prevActualMs = 0;
  for (const s of report.stops) {
    totalRenders += s.perf?.render?.commitCount ?? 0;
    totalIPC += s.perf?.ipc?.totalCount ?? 0;
    totalActualMs += s.perf?.render?.totalActualDurationMs ?? 0;
  }
  if (prev) {
    for (const s of prev.stops) {
      prevRenders += s.perf?.render?.commitCount ?? 0;
      prevIPC += s.perf?.ipc?.totalCount ?? 0;
      prevActualMs += s.perf?.render?.totalActualDurationMs ?? 0;
    }
  }
  lines.push('## Run totals');
  lines.push('');
  lines.push('| Metric | Value | Δ vs prev |');
  lines.push('|---|---:|---:|');
  lines.push(`| Render commits (sum across stops) | ${totalRenders} | ${prev ? fmtDelta(totalRenders, prevRenders) : '—'} |`);
  lines.push(`| IPC calls (sum across stops) | ${totalIPC} | ${prev ? fmtDelta(totalIPC, prevIPC) : '—'} |`);
  lines.push(`| Render actual time (sum across stops) | ${fmtMs(totalActualMs)} | ${prev ? fmtDelta(totalActualMs, prevActualMs, 'ms') : '—'} |`);
  lines.push('');
  return lines.join('\n');
}

function renderRankedTable(report, prev, sortKey, sortLabel, n = 15) {
  const prevMap = prev ? buildStopMap(prev) : null;
  const rows = report.stops
    .filter((s) => !s.setupError && s.perf)
    .map((s) => {
      const p = prevMap?.get(s.stop.id);
      return {
        id: s.stop.id,
        group: s.stop.group,
        renders: s.perf.render.commitCount,
        renderActualMs: s.perf.render.totalActualDurationMs,
        ipc: s.perf.ipc.totalCount,
        ipcMs: s.perf.ipc.totalDurationMs,
        dom: s.perf.dom.nodeCount,
        top: topCommands(s, 3),
        prev: p?.perf,
      };
    })
    .sort((a, b) => b[sortKey] - a[sortKey])
    .slice(0, n);

  const lines = [];
  lines.push(`## Top ${n} stops by ${sortLabel}`);
  lines.push('');
  lines.push('| Rank | Stop | Group | Renders | Render ms | IPC | IPC ms | DOM | Top commands |');
  lines.push('|---:|---|---|---:|---:|---:|---:|---:|---|');
  rows.forEach((r, i) => {
    const dRenders = r.prev ? fmtDelta(r.renders, r.prev.render.commitCount) : '';
    const dRenderMs = r.prev ? fmtDelta(r.renderActualMs, r.prev.render.totalActualDurationMs, 'ms') : '';
    const dIPC = r.prev ? fmtDelta(r.ipc, r.prev.ipc.totalCount) : '';
    const dIPCMs = r.prev ? fmtDelta(r.ipcMs, r.prev.ipc.totalDurationMs, 'ms') : '';
    const dDom = r.prev ? fmtDelta(r.dom, r.prev.dom.nodeCount) : '';
    lines.push(
      `| ${i + 1} | \`${r.id}\` | ${r.group} | ${r.renders}${dRenders} | ${fmtMs(r.renderActualMs)}${dRenderMs} | ${r.ipc}${dIPC} | ${fmtMs(r.ipcMs)}${dIPCMs} | ${r.dom}${dDom} | ${r.top || '—'} |`,
    );
  });
  lines.push('');
  return lines.join('\n');
}

function renderAllStops(report, prev) {
  const prevMap = prev ? buildStopMap(prev) : null;
  const lines = [];
  lines.push('## All stops (in walk order)');
  lines.push('');
  lines.push('| Stop | Renders | Render ms | IPC | IPC ms | DOM | Status |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const s of report.stops) {
    const p = prevMap?.get(s.stop.id);
    if (s.setupError) {
      lines.push(`| \`${s.stop.id}\` | — | — | — | — | — | ❌ ${s.setupError.slice(0, 80)} |`);
      continue;
    }
    const dRenders = p ? fmtDelta(s.perf.render.commitCount, p.perf.render.commitCount) : '';
    const dRenderMs = p ? fmtDelta(s.perf.render.totalActualDurationMs, p.perf.render.totalActualDurationMs, 'ms') : '';
    const dIPC = p ? fmtDelta(s.perf.ipc.totalCount, p.perf.ipc.totalCount) : '';
    const dIPCMs = p ? fmtDelta(s.perf.ipc.totalDurationMs, p.perf.ipc.totalDurationMs, 'ms') : '';
    const dDom = p ? fmtDelta(s.perf.dom.nodeCount, p.perf.dom.nodeCount) : '';
    lines.push(
      `| \`${s.stop.id}\` | ${s.perf.render.commitCount}${dRenders} | ${fmtMs(s.perf.render.totalActualDurationMs)}${dRenderMs} | ${s.perf.ipc.totalCount}${dIPC} | ${fmtMs(s.perf.ipc.totalDurationMs)}${dIPCMs} | ${s.perf.dom.nodeCount}${dDom} | ✓ |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function renderIpcInventory(report, n = 10) {
  // Aggregate IPC commands across all stops to identify globally-hottest commands.
  const byCommand = new Map();
  for (const s of report.stops) {
    if (s.setupError || !s.perf?.ipc?.byCommand) continue;
    for (const c of s.perf.ipc.byCommand) {
      const e = byCommand.get(c.command) ?? { count: 0, totalMs: 0, stops: 0 };
      e.count += c.count;
      e.totalMs += c.totalMs;
      e.stops += 1;
      byCommand.set(c.command, e);
    }
  }
  const ranked = Array.from(byCommand.entries())
    .map(([command, e]) => ({ command, ...e, avgMs: e.count > 0 ? e.totalMs / e.count : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, n);

  const lines = [];
  lines.push(`## Top ${n} IPC commands across all stops`);
  lines.push('');
  lines.push('| Rank | Command | Total calls | Stops seen on | Total ms | Avg ms |');
  lines.push('|---:|---|---:|---:|---:|---:|');
  ranked.forEach((c, i) => {
    lines.push(
      `| ${i + 1} | \`${c.command}\` | ${c.count} | ${c.stops}/${report.stops.length} | ${fmtMs(c.totalMs)} | ${fmtMs(c.avgMs)} |`,
    );
  });
  lines.push('');
  return lines.join('\n');
}

function renderReport(report, prev) {
  const sections = [
    renderRunHeader(report, prev),
    renderRankedTable(report, prev, 'renders', 'render-commit count'),
    renderRankedTable(report, prev, 'ipc', 'IPC call count'),
    renderRankedTable(report, prev, 'renderActualMs', 'render actual ms'),
    renderIpcInventory(report),
    renderAllStops(report, prev),
  ];
  return sections.join('\n') + '\n';
}

// ── Main ──

const args = parseArgs(process.argv);

let reportPath;
if (args.file) {
  reportPath = path.resolve(args.file);
  if (!fs.existsSync(reportPath)) {
    console.error(`File not found: ${reportPath}`);
    process.exit(2);
  }
} else {
  const runs = listRunsSorted();
  if (runs.length === 0) {
    console.error(`No runs found in ${RUNS_DIR}.`);
    console.error('Run the spec first: npx playwright test tests/playwright/perf-nav-walk.spec.ts');
    process.exit(2);
  }
  reportPath = runs[runs.length - 1];
}

const report = loadReport(reportPath);
let prev = null;
if (args.diff) {
  const runs = listRunsSorted();
  const currIdx = runs.indexOf(reportPath);
  if (currIdx > 0) {
    prev = loadReport(runs[currIdx - 1]);
  }
}

const md = renderReport(report, prev);
if (args.output) {
  const out = path.resolve(args.output);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, md, 'utf8');
  console.error(`Wrote: ${out}`);
} else {
  process.stdout.write(md);
}
