// Knowledge hierarchy API (docs/plans/patterns-v2-ui.md P1/P2) — wrappers over
// the dev_tools_hierarchy_* Tauri commands. The hierarchy is filesystem-truth:
// the Rust reader parses `<project root>/docs/concepts/paths/**` on demand
// (mtime-cached) and returns a typed graph; the app READS it, never copies it.
// `project_id` names a managed repo (`dev_projects` row); an unknown id is an
// error, every other absence is an honest empty graph with `source.reason`.
//
// `rootOverride` is the P3 authority flip: when the project's workspace holds a
// knowledge registry, the corpus is read from that clone instead. Every call
// site resolves it through `corpusRootFor` so the graph and the documents it
// links to always come from the SAME root — otherwise a link the graph issued
// would open a different repo's file of the same name. The scorecard is
// deliberately NOT overridable: it measures THIS repo against the standard.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { HierarchyDoc } from "@/lib/bindings/HierarchyDoc";
import type { HierarchyGraph } from "@/lib/bindings/HierarchyGraph";
import type { HierarchyScorecard } from "@/lib/bindings/HierarchyScorecard";

/** Read the whole hierarchy graph for one managed repo. Warm reads are served
 *  from the Rust-side whole-graph snapshot, so calling this on every mount is
 *  cheap; a cold parse of a large corpus stays well under the default timeout. */
export async function getHierarchyGraph(
  projectId: string,
  rootOverride?: string | null,
): Promise<HierarchyGraph> {
  return invoke<HierarchyGraph>("dev_tools_hierarchy_graph", {
    projectId,
    rootOverride: rootOverride ?? null,
  });
}

/** Fetch one markdown doc by the repo-relative path the graph handed out
 *  (`subject.file`, `technique.file`, `application.file`, corpus-map legacy
 *  paths). The reader is the ONE authority on the path convention — never
 *  string-concatenate a twin path in TypeScript. A valid-but-absent path
 *  resolves with `exists: false`; a rejected path rejects. */
/** Read the census adherence scorecard (`scripts/census/context-scorecard.json`)
 *  for one managed repo. OPTIONAL signal: an absent artifact resolves with an
 *  honest empty (`source.present === false`, `source.reason` names the
 *  generator command) — every consumer must render fully without it. A subject
 *  absent from `subjects` has no census rules yet; absence is NOT cleanliness. */
export async function getHierarchyScorecard(
  projectId: string,
): Promise<HierarchyScorecard> {
  return invoke<HierarchyScorecard>("dev_tools_hierarchy_scorecard", { projectId });
}

export async function getHierarchyDoc(
  projectId: string,
  relPath: string,
  rootOverride?: string | null,
): Promise<HierarchyDoc> {
  return invoke<HierarchyDoc>("dev_tools_hierarchy_doc", {
    projectId,
    relPath,
    rootOverride: rootOverride ?? null,
  });
}
