import type { ApiEndpoint } from '@/api/system/apiProxy';

/**
 * Seed an endpoint's `{path}` parameters and required query defaults from what
 * the credential already knows.
 *
 * The catalog's GitHub slice is almost entirely `/repos/{owner}/{repo}/...` and
 * Azure DevOps is `/{project}/_apis/...`, so the one-click Run All used to skip
 * the whole useful surface with "Has path parameters" and Try opened with empty
 * boxes -- even for a credential whose scope picker had already recorded which
 * repo or project it is for. Nothing carried the pick from
 * `credential.scopedResources` to the explorer.
 *
 * This module is the carrier, and it is deliberately a lookup table rather than
 * per-connector code: a scope resource id (`repositories`, `projects`, ...) is
 * a stable key in `scoped_resources`, seeded in `builtin_connectors.rs`.
 */

/** One recorded scope pick. Mirrors `CredentialMetadata['scopedResources']`. */
export interface ScopedResourceItem {
  id: string;
  label: string;
  sublabel?: string;
  meta?: Record<string, unknown>;
}

export type ScopedResources = Record<string, ScopedResourceItem[]> | null | undefined;

/**
 * Which recorded scope answers which `{param}`.
 *
 * `part` splits an `owner/name` item id, which is what GitHub's
 * `response_mapping.id` produces (`full_name`). It applies only when the id has
 * exactly one slash -- otherwise the whole id is used, or nothing is.
 */
const PARAM_SOURCES: Record<string, { resource: string; part?: 'owner' | 'name' }[]> = {
  owner: [{ resource: 'repositories', part: 'owner' }, { resource: 'organizations' }],
  org: [{ resource: 'organizations' }],
  repo: [{ resource: 'repositories', part: 'name' }],
  repository: [{ resource: 'repositories', part: 'name' }],
  project: [{ resource: 'projects' }],
  workspace: [{ resource: 'workspaces' }],
  database: [{ resource: 'databases' }],
  base: [{ resource: 'bases' }],
};

function pickFrom(items: ScopedResourceItem[] | undefined, part?: 'owner' | 'name'): string | null {
  const first = items?.[0];
  if (!first?.id) return null;
  if (!part) return first.id;
  const segments = first.id.split('/');
  if (segments.length !== 2) return null;
  return part === 'owner' ? segments[0]! : segments[1]!;
}

/**
 * Values for the `{param}` placeholders in `path` that the credential's scope
 * can answer. Params with no recorded scope are simply absent, so a caller can
 * tell "resolved" from "still unknown" by comparing key counts.
 *
 * When more than one resource is picked the FIRST is used: a smoke test needs
 * one concrete target, and both call sites show the value they chose (the
 * request builder in an editable field, Run All in its log line).
 */
export function seedPathParams(path: string, scoped: ScopedResources): Record<string, string> {
  if (!scoped) return {};
  const seeds: Record<string, string> = {};
  for (const match of path.match(/\{([^}]+)\}/g) ?? []) {
    const name = match.slice(1, -1);
    for (const source of PARAM_SOURCES[name] ?? []) {
      const value = pickFrom(scoped[source.resource], source.part);
      if (value) {
        seeds[name] = value;
        break;
      }
    }
  }
  return seeds;
}

/** Substitute what the scope knows; leave the rest as `{param}` literals. */
export function applyPathSeeds(path: string, seeds: Record<string, string>): string {
  let resolved = path;
  for (const [name, value] of Object.entries(seeds)) {
    resolved = resolved.replaceAll(`{${name}}`, encodeURIComponent(value));
  }
  return resolved;
}

/** True once every `{param}` in the path has a value. */
export function isFullyResolved(path: string): boolean {
  return !/\{[^}]+\}/.test(path);
}

/**
 * The literal default a REQUIRED query parameter carries in its description.
 *
 * The catalog uses the description field for two different things: a prose hint
 * (`'Results per page (max 100)'`, `'open, closed, all'`) and, for a parameter
 * the API rejects the request without, the single value to send
 * (`queryP('api-version', true, '7.1')`). Only the second shape is a default,
 * so the test is: required, and a description that is one bare token.
 */
export function queryParamDefault(param: {
  required?: boolean;
  description?: string | null;
}): string {
  if (!param.required) return '';
  const description = param.description?.trim();
  if (!description || !/^[\w.-]+$/.test(description)) return '';
  return description;
}

/** Path params an endpoint declares but the scope could not answer. */
export function unresolvedPathParams(endpoint: ApiEndpoint, scoped: ScopedResources): string[] {
  const seeds = seedPathParams(endpoint.path, scoped);
  return (endpoint.path.match(/\{([^}]+)\}/g) ?? [])
    .map((m) => m.slice(1, -1))
    .filter((name) => !seeds[name]);
}
