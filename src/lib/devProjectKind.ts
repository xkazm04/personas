// What a dev project IS, and which surfaces care.
//
// `dev_projects.kind` (migration e48) is a closed set: `'code'` — a product
// codebase, the column's DEFAULT and therefore what every project registered
// before the column reads as — or `'registry'`, a knowledge-registry working
// copy registered so an agent session can be dispatched into it.
//
// ## Why a registry checkout is a project at all
//
// Because dispatch needs one. A Fleet session starts in a `root_path`, the
// Notepad dispatches a note into a project, a skill is installed into a
// project. The registry clone is a real directory all three of those are
// legitimate against — it is only when a surface treats a project as a
// PRODUCT that a registry becomes nonsense: it has no CI to grade, no KPIs to
// scan, no use cases to certify, no deploy to passport.
//
// ## The rule, and who applies it
//
// `isCodeProject` is the predicate; `codeProjectsOnly` is the filter. They are
// applied at the surfaces where a registry would be graded, scanned or
// territory-mapped, NOT at the API door — `listProjects()` keeps returning
// every row, because the dispatch pickers, the Projects table (where the row
// is managed) and the export picker all want it.
//
// It tests `kind === 'code'`, not `kind !== 'registry'`, deliberately: a third
// kind added later has to OPT IN to being scanned and passported, rather than
// silently inheriting a treatment nobody considered for it.

export const PROJECT_KIND_CODE = 'code';
export const PROJECT_KIND_REGISTRY = 'registry';

/** True for a product codebase — the only kind the scan/passport surfaces mean. */
export function isCodeProject(project: { kind: string }): boolean {
  return project.kind === PROJECT_KIND_CODE;
}

/** Every product codebase in `projects`, in order, with the rest dropped. */
export function codeProjectsOnly<T extends { kind: string }>(projects: T[]): T[] {
  return projects.filter(isCodeProject);
}
