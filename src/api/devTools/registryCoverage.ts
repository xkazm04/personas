// Registry coverage API (docs/plans/registry-coverage-ui.md R1) — wrappers over
// the dev_tools_registry_probe / dev_tools_registry_coverage Tauri commands.
//
// Coverage is a DERIVED view: the Rust side parses the registry working copy
// (registry.yaml, catalog.json, librarian/projects.md, git metadata) and each
// project's consumer-side artifacts on demand (HEAD+mtime-cached), and the
// app-DB joins (harvest coverage, practice adoption) happen frontend-side.
// Nothing is persisted. Absence is representable everywhere — a missing signal
// arrives as `null`, never as a zero that reads as "good".
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { CoverageProjectIn } from "@/lib/bindings/CoverageProjectIn";
import type { RegistryCoverage } from "@/lib/bindings/RegistryCoverage";
import type { RegistryProbe } from "@/lib/bindings/RegistryProbe";

/** Ask whether a local folder is a registry working copy. A non-registry
 *  folder resolves with `valid: false` + `reason` — it never rejects for a
 *  mere wrong folder, so the picker can show the reason inline. */
export async function probeRegistry(path: string): Promise<RegistryProbe> {
  return invoke<RegistryProbe>("dev_tools_registry_probe", { path });
}

/** Coverage can shell out to git several times on a cold working copy, so the
 *  timeout is generous; warm reads are served from the Rust-side cache. */
const COVERAGE_TIMEOUT_MS = 30_000;

/** Compute the Project × registry coverage read model for one registry root
 *  and the given managed projects. Empty-but-explained when the root is not a
 *  registry (`source.present === false`, `source.reason` says why). */
export async function getRegistryCoverage(
  registryRoot: string,
  projects: CoverageProjectIn[],
): Promise<RegistryCoverage> {
  return invoke<RegistryCoverage>(
    "dev_tools_registry_coverage",
    { registryRoot, projects },
    { timeoutMs: COVERAGE_TIMEOUT_MS },
  );
}
