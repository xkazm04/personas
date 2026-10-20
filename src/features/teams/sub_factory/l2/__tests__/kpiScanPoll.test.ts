// The Factory L2 "Scan for KPIs" button polls the scan's status. The backend
// gives the scan's CLI stream a fixed budget (kpi_scan.rs, run_kpi_scan) and
// only writes a terminal status after it; a poll that stops first reports
// nothing and reloads KPIs before the proposals exist. The backend figure is
// read from the Rust source so the two cannot drift. Lives under __tests__/,
// which tsc skips (node:fs).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/api/devTools/devTools', () => ({ scanCodebase: vi.fn() }));
vi.mock('@/api/devTools/kpis', () => ({ getKpiScanStatus: vi.fn(), scanKpis: vi.fn(), cancelKpiScan: vi.fn() }));
vi.mock('@/hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));
vi.mock('@/stores/overviewStore', () => ({ useOverviewStore: { getState: vi.fn() } }));

import { KPI_SCAN_POLL_BUDGET_MS, KPI_SCAN_POLL_MS, pollKpiScan } from '../useFactoryScans';

function backendStreamBudgetMs(): number {
  const raw = readFileSync(resolve(process.cwd(), 'src-tauri/src/commands/infrastructure/kpi_scan.rs'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const start = src.indexOf('async fn run_kpi_scan(');
  expect(start, 'run_kpi_scan not found').toBeGreaterThanOrEqual(0);
  const body = src.slice(start);
  const m = /let timeout_duration = std::time::Duration::from_secs\((\d+)\);/.exec(body);
  expect(m, 'run_kpi_scan timeout_duration not found').not.toBeNull();
  expect(body).toMatch(/tokio::time::timeout\(timeout_duration/);
  return Number(m![1]) * 1000;
}

const noWait = () => Promise.resolve();

describe('KPI scan poll', () => {
  it('outlasts the backend stream budget', () => {
    expect(KPI_SCAN_POLL_BUDGET_MS).toBeGreaterThan(backendStreamBudgetMs());
  });

  it('keeps polling a scan that runs past 300 s and returns its completion', async () => {
    // 400 polls at 2 s = 800 s of running: inside the backend's budget.
    let n = 0;
    const getStatus = vi.fn(async () => ({ status: ++n > 400 ? 'completed' : 'running' }));
    const st = await pollKpiScan('s1', { getStatus, wait: noWait });
    expect(st).toEqual({ status: 'completed' });
    expect(n * KPI_SCAN_POLL_MS).toBeGreaterThan(300_000);
  });

  it.each(['failed', 'cancelled', 'not_found'])('stops at %s', async (status) => {
    const getStatus = vi.fn(async () => ({ status, error: status === 'failed' ? 'boom' : null }));
    const st = await pollKpiScan('s1', { getStatus, wait: noWait });
    expect(st?.status).toBe(status);
    expect(getStatus).toHaveBeenCalledTimes(1);
  });

  it('stops reading once the caller is gone', async () => {
    const getStatus = vi.fn(async () => ({ status: 'running' }));
    const st = await pollKpiScan('s1', { getStatus, wait: noWait, alive: () => false });
    expect(st).toBeNull();
    expect(getStatus).not.toHaveBeenCalled();
  });
});

describe('kpiScanNote', () => {
  it('reports a cancelled scan as cancelled, not as a failure', async () => {
    const { kpiScanNote } = await import('../useFactoryScans');
    expect(kpiScanNote({ status: 'cancelled' })).toBe('KPI scan cancelled');
    expect(kpiScanNote({ status: 'failed', error: 'boom' })).toBe('boom');
    expect(kpiScanNote({ status: 'completed' })).toMatch(/complete/);
  });
});
