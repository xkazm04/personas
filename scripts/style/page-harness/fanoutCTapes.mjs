// console-style fan-out, partition C: synthetic tape builders for fanoutCSurfaces.tsx.
// Owned by the partition-C builder; synthetic-tapes.mjs spreads it (wired by the Director).
// Fixture CODE with fake data only.
export function fanoutCTapes({ RECORDED_AT, PERSONAS }) {
  const COMPANIONS = {
    companions: [
      { id: 'athena', enabled: true, eligible: true, onboarded: true, detail: { pendingDecisions: 3 } },
      { id: 'overseer', enabled: true, eligible: true, onboarded: true, detail: { starredCount: 3, agentsTotal: 16 } },
      { id: 'curator', enabled: false, eligible: false, blocker: 'no_registry', onboarded: true, detail: {} },
    ],
  };
  const ago = (m) => new Date(Date.parse(RECORDED_AT) - m * 60_000).toISOString();
  const entry = (name, path, kind, size, m, mime = null, extension = null) => ({ name, path, kind, size, modified: ago(m), mime, extension });
  const ROOT = [
    entry('exports', 'exports', 'folder', 0, 30), entry('reports', 'reports', 'folder', 0, 600), entry('invoices', 'invoices', 'folder', 0, 3000),
    entry('weekly-digest.md', 'weekly-digest.md', 'file', 4210, 45, 'text/markdown', 'md'),
    entry('q3-summary.pdf', 'q3-summary.pdf', 'file', 884211, 190, 'application/pdf', 'pdf'),
    entry('customers.csv', 'customers.csv', 'file', 52311, 1500, 'text/csv', 'csv'),
    entry('roadmap.json', 'roadmap.json', 'file', 9120, 5000, 'application/json', 'json'),
  ];
  const DRIVE = [
    { cmd: 'drive_get_root', response: 'C:/Users/demo/AppData/Roaming/personas/drive' },
    { cmd: 'drive_storage_info', response: { root: 'C:/Users/demo/AppData/Roaming/personas/drive', usedBytes: 951852, entryCount: 7, isDev: false } },
    { cmd: 'drive_list', response: ROOT },
    { cmd: 'drive_recent', response: ROOT.filter((e) => e.kind === 'file').slice(0, 4) },
    { cmd: 'drive_list_tree', response: { name: '', path: '', hasMoreChildren: false, children: ROOT.filter((e) => e.kind === 'folder').map((e) => ({ name: e.name, path: e.path, children: [], hasMoreChildren: false })) } },
    { cmd: 'list_credentials', response: [] },
    { cmd: 'list_knowledge_bases', response: [] },
    { cmd: 'list_document_signatures', response: [] },
  ];
  const base = [{ cmd: 'list_personas', response: PERSONAS }, { cmd: 'companions_status', response: COMPANIONS }];
  const tape = (id, note, calls = base) => id === 'plugins/drive' ? () => ({ version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note, calls: [...base, ...DRIVE] }) :  () => ({ version: 1, module: id, source: 'synthetic', recordedAt: RECORDED_AT, note, calls });
  const ids = ['plugins/browse', 'companions/landing', 'athena/setup', 'athena/memory', 'athena/decisions', 'curator/council', 'curator/blueprint', 'curator/process', 'plugins/drive', 'twin/profiles', 'twin/hub'];
  return { builders: Object.fromEntries(ids.map((id) => [id, tape(id, 'Synthetic (partition C): companions status, personas.')])) };
}
