/**
 * End-to-end smoke test: KPI setup travels through a portability bundle.
 *
 * Complements e2e_portability.py (which round-trips personas only) by covering
 * the KPI export/import path added 2026-06-20:
 *   - export resolves a selected team's project KPIs (active/paused) + capped
 *     measurement history into the bundle (`include_kpis`),
 *   - import lands them PAUSED in a single, deduped "Imported" dev_project,
 *     seeding current_value from the newest measurement.
 *
 * Boots its OWN isolated dev instance (lite + test-automation, shifted ports,
 * throwaway data dir — coexists with the developer's running app), seeds a
 * project + team + KPI via the generic `invokeCommand` bridge, drives the
 * debug-only round-trip commands, and asserts the imported state. Tears the
 * instance + temp data dir down on exit.
 *
 * Usage:
 *   node tools/test-mcp/e2e_kpi_portability.mjs
 *   node tools/test-mcp/e2e_kpi_portability.mjs --keep   # keep instance + bundle up
 */
import { launchIsolated } from '../../scripts/test/launch-isolated.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const KEEP = process.argv.includes('--keep');

const log = [];
let failures = 0;
function rec(step, ok, extra = {}) {
  log.push({ step, ok, ...extra });
  if (!ok) failures++;
  const brief = Object.keys(extra).length ? '  ' + JSON.stringify(extra) : '';
  console.log(`  ${ok ? '[OK]' : '[XX]'} ${step}${brief}`);
}

async function main() {
  console.log('[kpi-e2e] booting isolated instance (cold compile can take a few min)…');
  const inst = await launchIsolated({ inheritStdio: false, timeoutMs: 540_000 });
  const BASE = `http://127.0.0.1:${inst.port}`;
  console.log(`[kpi-e2e] bridge healthy on :${inst.port}`);

  const bundlePath = join(mkdtempSync(join(tmpdir(), 'kpi-e2e-')), 'kpi_bundle.zip');

  async function bridge(method, params = {}, timeout_secs = 60) {
    const res = await fetch(`${BASE}/bridge-exec`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method, params, timeout_secs }),
      signal: AbortSignal.timeout((timeout_secs + 20) * 1000),
    });
    return res.json();
  }
  async function cmd(command, params = {}, timeout_secs = 60) {
    const res = await bridge('invokeCommand', { command, params }, timeout_secs);
    if (!res.success) throw new Error(`${command} failed: ${res.error}`);
    return res.result;
  }

  try {
    rec('bridge healthy', true, { port: inst.port });

    // Fail fast if we adopted an OLD binary (a stale isolated instance squatting
    // on the port, or a build that missed the source). `get_export_stats` gained
    // `kpi_count` in this change — its absence means the running binary predates
    // the KPI work, so abort rather than emit confusing downstream failures.
    const stats = await cmd('get_export_stats', {});
    const fresh = Object.prototype.hasOwnProperty.call(stats || {}, 'kpi_count');
    rec('running binary includes KPI changes', fresh, { statKeys: Object.keys(stats || {}) });
    if (!fresh) {
      throw new Error(
        'OLD BINARY: get_export_stats has no kpi_count — adopted a stale instance or the rebuild missed the source.',
      );
    }

    // ── Seed a project + team (in that project) + an active KPI ──────────────
    const project = await cmd('dev_tools_create_project', {
      name: 'KPI E2E Source',
      rootPath: `${bundlePath}-src`,
      description: 'e2e source project',
    });
    rec('project seeded', Boolean(project?.id), { projectId: project?.id });

    const team = await cmd('create_team', {
      input: {
        name: 'KPI Squad',
        project_id: project.id,
        parent_team_id: null,
        description: 'e2e team',
        canvas_data: null,
        team_config: null,
        icon: null,
        color: '#6B7280',
        enabled: true,
      },
    });
    rec('team seeded in project', team?.project_id === project.id, {
      teamId: team?.id,
      teamProject: team?.project_id,
    });

    const kpi = await cmd('dev_tools_create_kpi', {
      projectId: project.id,
      name: 'E2E Coverage',
      description: 'line coverage %',
      category: 'quality',
      measureKind: 'manual',
      measureConfig: '{}',
      unit: 'pct',
      direction: 'up',
      baselineValue: 10,
      targetValue: 90,
      cadence: 'weekly',
      status: 'active',
    });
    rec('kpi seeded (active)', kpi?.status === 'active', { kpiId: kpi?.id, status: kpi?.status });

    await cmd('dev_tools_record_kpi_measurement', { kpiId: kpi.id, value: 72, source: 'manual' });
    rec('measurement recorded', true, { value: 72 });

    // ── Export the team selectively, KPIs included ───────────────────────────
    const wrote = await cmd(
      'export_selective_to_path',
      {
        personaIds: [],
        teamIds: [team.id],
        credentialIds: [],
        includeMemories: true,
        includeKpis: true,
        passphrase: null,
        filePath: bundlePath,
      },
      90,
    );
    rec('export wrote bundle', wrote === true, { bundlePath });

    // ── Import the bundle back into the same (isolated) workspace ────────────
    const importRes = await cmd(
      'import_portability_bundle_from_path',
      { passphrase: null, filePath: bundlePath },
      120,
    );
    rec('import created exactly 1 KPI', importRes?.kpis_created === 1, {
      kpis_created: importRes?.kpis_created,
      teams_created: importRes?.teams_created,
      warnings: importRes?.warnings,
    });

    // ── Assert the imported state ────────────────────────────────────────────
    const projects = await cmd('dev_tools_list_projects', {});
    const imported = (projects || []).find((p) => p.name === 'Imported');
    rec('dedicated "Imported" project exists', Boolean(imported), {
      importedProjectId: imported?.id,
    });

    const allKpis = await cmd('dev_tools_list_all_kpis', {});
    const ik = (allKpis || []).find(
      (k) => imported && k.project_id === imported.id && k.name === 'E2E Coverage',
    );
    rec('imported KPI present in Imported project', Boolean(ik), { name: ik?.name });
    rec('imported KPI is paused (dormant)', ik?.status === 'paused', { status: ik?.status });
    rec('imported KPI current_value seeded from measurement', ik?.current_value === 72, {
      current_value: ik?.current_value,
    });
    rec('imported KPI preserved target', ik?.target_value === 90, { target_value: ik?.target_value });

    const measurements = ik
      ? await cmd('dev_tools_list_kpi_measurements', { kpiId: ik.id, limit: 100 })
      : [];
    rec('measurement history travelled', (measurements || []).length === 1, {
      count: (measurements || []).length,
    });
  } catch (e) {
    rec('unexpected exception', false, { error: String(e?.message ?? e) });
  } finally {
    console.log(`\n[kpi-e2e] bundle: ${bundlePath}`);
    if (KEEP) {
      console.log(`[kpi-e2e] --keep: instance left up on :${inst.port}. Ctrl-C to tear down.`);
    } else {
      await inst.stop();
    }
  }

  console.log(`\n${'='.repeat(56)}`);
  console.log(`  ${failures === 0 ? 'PASS' : 'FAIL'} — ${log.length} steps, ${failures} failures`);
  console.log(`${'='.repeat(56)}`);
  if (!KEEP) process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[kpi-e2e] fatal:', e?.message ?? e);
  process.exit(1);
});
