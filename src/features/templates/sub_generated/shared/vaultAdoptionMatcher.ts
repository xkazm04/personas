import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';

/**
 * Aliases for connector service_types. The same logical provider gets stored
 * under different `service_type` values depending on how the credential was
 * created (catalog form vs CLI probe vs foraging vs healthcheck discovery).
 *
 * Templates reference the canonical connector name (as declared in the
 * `builtin/*.json` file's top-level `name` field), and this map expands that
 * into every alias a credential might actually be stored under. Without it,
 * a user who `aws configure`'d their shell and let the CLI probe detect the
 * credential would silently fail to auto-detect on AWS templates — because
 * the stored service_type is `"aws"` while the template asks for `"aws_cloud"`.
 *
 * Known creator paths and the names they emit:
 *   - Catalog UI      → canonical name from builtin JSON (gcp_cloud, aws_cloud, azure_cloud)
 *   - auth_detect.rs  → "aws", "google_cloud", "azure"   (CLI probes)
 *   - foraging.rs     → "aws"                             (~/.aws/credentials scraping)
 *   - healthcheck.rs  → "aws", "google_cloud", "azure"   (live-detect)
 *
 * Add to this map whenever a new creator path introduces a different spelling
 * for an existing connector. Keeping the logic here (matcher-local) avoids
 * spraying alias knowledge across the codebase and is a no-op for connectors
 * that don't have aliases.
 */
const SERVICE_TYPE_ALIASES: Record<string, readonly string[]> = {
  gcp_cloud: ['gcp_cloud', 'google_cloud'],
  aws_cloud: ['aws_cloud', 'aws'],
  azure_cloud: ['azure_cloud', 'azure'],
};

/** Expand a canonical service_type into itself plus any known aliases. */
function expandAliases(serviceType: string): readonly string[] {
  return SERVICE_TYPE_ALIASES[serviceType] ?? [serviceType];
}

/** Does the vault contain any credential whose service_type matches the
 *  canonical name OR any of its known aliases? */
function hasMatchingCredential(
  canonical: string,
  credentialServiceTypes: Set<string>,
): boolean {
  for (const alias of expandAliases(canonical)) {
    if (credentialServiceTypes.has(alias)) return true;
  }
  return false;
}

/**
 * Match adoption questions against the user's credential vault.
 *
 * For questions with `vault_category` + `option_service_types`, the behaviour
 * depends on matching credentials AND on whether the options include a
 * `null` fallback (typically an "Other / custom" option):
 *
 * WITHOUT a null fallback:
 * - 0 matches    → BLOCK the question (user must add a credential)
 * - 1 match      → auto-select the matching option, tag as auto-detected
 * - 2+ matches   → narrow the displayed options to matched-only
 *
 * WITH a null fallback:
 * - 0 matches    → narrow to ONLY the "Other" option(s) so the user sees a
 *                   real signal that no credential exists (instead of the
 *                   full hardcoded list)
 * - 1 match      → narrow to [match, Other] so the user can confirm the
 *                   detected credential OR fall through to custom input
 * - 2+ matches   → narrow to matched + Other
 *
 * Rationale: a question with `option_service_types` is declaring "these
 * are credential-backed choices". If the catalog is hardcoded (no filter),
 * the `option_service_types` annotation is pure decoration. Filtering is
 * the whole point. The null fallback only determines whether the user has
 * a legitimate "custom value" escape hatch — not whether we filter.
 *
 * Matching is alias-aware via SERVICE_TYPE_ALIASES so cloud credentials
 * created via CLI probe or foraging still hit templates that reference the
 * canonical connector name.
 *
 * Questions without `vault_category` or `option_service_types` are ignored.
 */
export function matchVaultToQuestions(
  questions: TransformQuestionResponse[],
  credentialServiceTypes: Set<string>,
): {
  autoAnswers: Record<string, string>;
  autoDetectedIds: Set<string>;
  blockedQuestionIds: Set<string>;
  filteredOptions: Record<string, string[]>;
} {
  const autoAnswers: Record<string, string> = {};
  const autoDetectedIds = new Set<string>();
  const blockedQuestionIds = new Set<string>();
  const filteredOptions: Record<string, string[]> = {};

  for (const q of questions) {
    // Dynamic-source questions don't carry static options — they pull their
    // list from a connector API at render time. They still need an upfront
    // credential check so the top "credentials required" banner lights up if
    // the backing service isn't connected. Exception: `codebases` is a local
    // bridge connector and never needs credentials.
    if (q.dynamic_source) {
      const svc = q.dynamic_source.service_type;
      if (svc === 'codebases') continue;
      if (!hasMatchingCredential(svc, credentialServiceTypes)) {
        blockedQuestionIds.add(q.id);
      }
      continue;
    }

    if (!q.vault_category || !q.option_service_types || !q.options) continue;
    if (q.option_service_types.length !== q.options.length) continue;

    // Find which options have a matching credential in the vault
    const matchingIndices: number[] = [];
    const nullFallbackIndices: number[] = [];
    for (let i = 0; i < q.option_service_types.length; i++) {
      const st = q.option_service_types[i];
      if (st === null) {
        nullFallbackIndices.push(i);
        continue;
      }
      if (st && hasMatchingCredential(st, credentialServiceTypes)) {
        matchingIndices.push(i);
      }
    }

    const hasNullFallback = nullFallbackIndices.length > 0;

    if (hasNullFallback) {
      // With a null fallback the user always has an escape hatch, so we
      // never block. Always filter to matched + fallback, regardless of
      // match count. Even 0 matches narrows to just the "Other" pill —
      // that's a stronger UX signal than hiding filtering behind a full
      // hardcoded list.
      const keepIndices = [...matchingIndices, ...nullFallbackIndices].sort((a, b) => a - b);
      filteredOptions[q.id] = keepIndices.map((i) => q.options![i]!);
      // Do NOT auto-answer even on 1 match — the user may want "Other".
    } else if (matchingIndices.length === 0) {
      // No matches and no fallback → block the question.
      blockedQuestionIds.add(q.id);
    } else if (matchingIndices.length === 1) {
      // Single match, no fallback → auto-select (only valid option).
      autoAnswers[q.id] = q.options[matchingIndices[0]!]!;
      autoDetectedIds.add(q.id);
    } else {
      // 2+ matches, no fallback → filter to matched options only.
      filteredOptions[q.id] = matchingIndices.map((i) => q.options![i]!);
    }
  }

  return { autoAnswers, autoDetectedIds, blockedQuestionIds, filteredOptions };
}
