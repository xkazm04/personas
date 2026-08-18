// Knowledge hierarchy API (docs/plans/patterns-v2-ui.md P1/P2) — wrappers over
// the dev_tools_hierarchy_* Tauri commands. The hierarchy is filesystem-truth:
// the Rust reader parses `<project root>/docs/concepts/paths/**` on demand
// (mtime-cached) and returns a typed graph; the app READS it, never copies it.
// `project_id` names a managed repo (`dev_projects` row); an unknown id is an
// error, every other absence is an honest empty graph with `source.reason`.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { HierarchyDoc } from "@/lib/bindings/HierarchyDoc";
import type { HierarchyGraph } from "@/lib/bindings/HierarchyGraph";

/** Read the whole hierarchy graph for one managed repo. Warm reads are served
 *  from the Rust-side whole-graph snapshot, so calling this on every mount is
 *  cheap; a cold parse of a large corpus stays well under the default timeout. */
export async function getHierarchyGraph(projectId: string): Promise<HierarchyGraph> {
  return invoke<HierarchyGraph>("dev_tools_hierarchy_graph", { projectId });
}

/** Fetch one markdown doc by the repo-relative path the graph handed out
 *  (`subject.file`, `technique.file`, `application.file`, corpus-map legacy
 *  paths). The reader is the ONE authority on the path convention — never
 *  string-concatenate a twin path in TypeScript. A valid-but-absent path
 *  resolves with `exists: false`; a rejected path rejects. */
export async function getHierarchyDoc(
  projectId: string,
  relPath: string,
): Promise<HierarchyDoc> {
  return invoke<HierarchyDoc>("dev_tools_hierarchy_doc", { projectId, relPath });
}
