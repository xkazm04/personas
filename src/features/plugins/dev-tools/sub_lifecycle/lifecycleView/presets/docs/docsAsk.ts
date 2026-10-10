// What the Lifecycle hands Athena about docs: the ONE builder for "fix these
// docs" (the Next panel's "Fix N docs" and the docs preset's "Fix N docs with
// Athena" both send it) and the one for "fix this doc", which names the doc
// and everything wrong with it - its broken references, or the sources that
// changed after it was written. Words only; the caller sends them through
// `useAskAthena('lifecycle', ...)`.
import type { LifecycleDocRow } from '@/lib/bindings/LifecycleDocRow';

import type { LifecycleViewModel } from '../../useLifecycleView';
import { asDocStatus } from '../docsModel';

type Words = Pick<LifecycleViewModel, 'dl' | 'tx'>;

export interface AskProject {
  name: string;
  id: string;
}

/** A prompt names at most this many paths per list, then "and N more". */
export const ASK_PATH_CAP = 30;

function listed(w: Words, paths: string[]): string {
  const head = paths.slice(0, ASK_PATH_CAP).join(', ');
  return paths.length > ASK_PATH_CAP ? head + w.tx(w.dl.lc2_and_more, { count: paths.length - ASK_PATH_CAP }) : head;
}

/** "Help me fix the out-of-date docs of <name> (id <id>): <docs>." */
export function fixDocsPrompt(w: Words, project: AskProject, docs: string[]): string {
  return w.tx(w.dl.lcx5_ask_docs, { name: project.name, id: project.id, docs: listed(w, docs) });
}

/** One doc, by what is wrong with it; a broken doc whose sources also moved says both. A clean doc has nothing to fix (null). */
export function fixDocPrompt(w: Words, project: AskProject, row: LifecycleDocRow): string | null {
  const { dl, tx } = w;
  const vars = { name: project.name, id: project.id, doc: row.docPath };
  switch (asDocStatus(row.status)) {
    case 'broken': {
      const main = tx(dl.lcx7_ask_doc_broken, { ...vars, refs: listed(w, row.brokenRefs) });
      return row.changedSources.length > 0
        ? `${main} ${tx(dl.lcx7_ask_doc_also_stale, { sources: listed(w, row.changedSources) })}`
        : main;
    }
    case 'stale':
      return tx(dl.lcx7_ask_doc_stale, { ...vars, sources: listed(w, row.changedSources) });
    case 'unverifiable':
      return tx(dl.lcx7_ask_doc_unverifiable, vars);
    case 'clean':
      return null;
  }
}
