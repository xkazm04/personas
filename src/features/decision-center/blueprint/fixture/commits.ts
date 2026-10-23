// The fixture's commits (WP4b): a SYNTHETIC CommitDiff for each pack item's commit, made up from the item's own
// sample text (its title, its Summary and the files its Flow names). Nothing here was read from a repository: Kettle is
// bp's made-up sample product, and every hunk is invented. One commit (the timetable editor's) carries a generated
// table long enough that the store's 2000-line cut applies, so the panel's `truncated` path is exercised.
import type { CommitDiff, Proposal } from '@/lib/lensScan/wire';

const CUT = 2000;
/** The item whose commit is long enough to be cut. */
const LONG = 'p-3cda72';

const flowFiles = (body: string | undefined): string[] => {
  const m = /##\s*Flow\s*\n([\s\S]*?)(?:\n##\s|$)/.exec(body ?? '');
  const files = (m?.[1] ?? '').split('\n').map((l) => /^\s*\d+[.)]\s+(\S+)/.exec(l)?.[1]).filter((f): f is string => !!f);
  return files.length ? files : ['src/sample/feature.ts'];
};
const summaryOf = (p: Proposal): string => (/##\s*Summary\s*\n+([^\n]+)/.exec(p.body ?? '')?.[1] ?? p.title).trim();

function hunk(file: string, p: Proposal, i: number): { text: string; add: number; del: number } {
  const name = file.split('/').pop()?.replace(/\.\w+$/, '') ?? 'part';
  const test = /\.test\./.test(file);
  const body = test
    ? [' describe(\'' + name + '\', () => {', `+  it('${p.title.toLowerCase().replace(/'/g, '')}', () => {`, '+    expect(render().state).toBe(\'designed\');', '+  });', ' });']
    : [` export function ${name}(props: Props) {`, '-  if (failed) return null;', `+  // ${summaryOf(p).replace(/\s+/g, ' ').slice(0, 90)}`, '+  if (failed) return <Notice reason={reason} retry={retry} />;', '   return <View {...props} />;', ' }'];
  const add = body.filter((l) => l.startsWith('+')).length, del = body.filter((l) => l.startsWith('-')).length;
  const at = 12 + i * 7;
  return { text: [`diff --git a/${file} b/${file}`, `index ${p.id.slice(2)}0..${p.id.slice(2)}1 100644`, `--- a/${file}`, `+++ b/${file}`, `@@ -${at},${body.length - add} +${at},${body.length - del} @@`, ...body].join('\n'), add, del };
}

/** A generated slot index, 2400 rows: the one diff the store would cut. */
function longTable(): { text: string; add: number } {
  const file = 'src/features/timetable/slotIndex.generated.ts';
  const rows = Array.from({ length: 2400 }, (_, i) => `+  { slot: ${i}, day: ${i % 7}, start: ${(i % 48) * 30} },`);
  return { text: [`diff --git a/${file} b/${file}`, 'new file mode 100644', 'index 0000000..5a1e2c4', '--- /dev/null', `+++ b/${file}`, `@@ -0,0 +1,${rows.length + 2} @@`, '+export const SLOT_INDEX = [', ...rows, '+];'].join('\n'), add: rows.length + 2 };
}

/** The synthetic commit of `sha`, or a one-file stand-in for a sha no item of the fixture carries. */
export function sampleCommit(sha: string, items: readonly Proposal[]): CommitDiff {
  const p = items.find((x) => x.commit_sha === sha || x.result_sha === sha);
  if (!p) {
    const patch = ['--- a/src/sample.ts', '+++ b/src/sample.ts', '@@ -1,2 +1,3 @@', ' export const sample = true;', '+export const fixture = true;', ' '].join('\n');
    return { sha, message: 'sample change\n\nLens-Scan: fixture', stat: ' src/sample.ts | 1 +\n 1 file changed, 1 insertion(+)', files: [{ path: 'src/sample.ts', add: 1, del: 0 }], patch, lines: 6, truncated: false };
  }
  const parts = flowFiles(p.body).map((f, i) => ({ path: f, ...hunk(f, p, i) }));
  if (p.id === LONG) { const t = longTable(); parts.push({ path: 'src/features/timetable/slotIndex.generated.ts', text: t.text, add: t.add, del: 0 }); }
  const all = parts.map((x) => x.text).join('\n').split('\n');
  const files = parts.map((x) => ({ path: x.path, add: x.add, del: x.del }));
  const add = files.reduce((n, f) => n + f.add, 0), del = files.reduce((n, f) => n + f.del, 0);
  const stat = files.map((f) => ` ${f.path} | ${f.add + f.del} ${'+'.repeat(Math.min(f.add, 20))}${'-'.repeat(Math.min(f.del, 20))}`).join('\n')
    + `\n ${files.length} files changed, ${add} insertions(+), ${del} deletions(-)`;
  return {
    sha,
    message: `${p.title}\n\n${summaryOf(p)}\n\nLens-Scan: ${p.id}\nPack: ${p.pack_id ?? 'none'}\nSample: Kettle (simulated)`,
    stat,
    files,
    patch: all.slice(0, CUT).join('\n'),
    lines: all.length,
    truncated: all.length > CUT,
  };
}
