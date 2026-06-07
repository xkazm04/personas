import type { PersonaPromptVersion } from "@/lib/bindings/PersonaPromptVersion";
import type { LabVersionRating } from "@/lib/bindings/LabVersionRating";

/**
 * One row of the consolidated Lab "Versions & Ratings" table. The table is the
 * cartesian product of prompt versions × the models each version has been
 * measured on, plus one placeholder row for versions that have never been
 * measured. Exactly one row is the persona's live config (`isActive`).
 *
 * A `null` `modelId` marks an unmeasured placeholder row (the version exists but
 * has no rating yet, and is not the active config).
 */
export interface VersionRow {
  /** Stable key `${versionId}::${modelId ?? '∅'}`. */
  key: string;
  version: PersonaPromptVersion;
  versionId: string;
  versionNumber: number;
  modelId: string | null;
  provider: string;
  rating: LabVersionRating | null;
  /** Weighted composite (0–100) for this (version, model), or null if unmeasured. */
  composite: number | null;
  /** The persona's live (version, model). At most one row is active. */
  isActive: boolean;
  /** This version is the pinned regression baseline. */
  isBaseline: boolean;
  /** Highest-composite measured model for this version (the ★ cell). */
  isBestForVersion: boolean;
  /** This version is tag === 'archived'. */
  isArchived: boolean;
  /**
   * Composite delta vs the pinned baseline version measured on the *same model*
   * (apples-to-apples regression signal). `null` when no baseline is pinned or
   * the baseline was never measured on this row's model.
   */
  deltaVsBaseline: number | null;
}

export interface BuildRowsCtx {
  versions: PersonaPromptVersion[];
  ratings: LabVersionRating[];
  /** Version whose prompt is currently live (tag 'production'). */
  activeVersionId: string | null;
  /** The persona's currently-effective model id. */
  activeModelId: string | null;
  activeProvider: string;
  /** Pinned regression baseline version, if any. */
  baselineVersionId: string | null;
}

function compositeFor(ratings: LabVersionRating[], versionId: string, modelId: string): number | null {
  const r = ratings.find((x) => x.versionId === versionId && x.modelId === modelId);
  return r?.compositeScore ?? null;
}

/**
 * Build the cartesian (version × model) rows. Ordering: versions by number
 * descending; within a version the active row first, then measured rows by
 * composite descending, then any unmeasured placeholder last.
 */
export function buildVersionRows(ctx: BuildRowsCtx): VersionRow[] {
  const { versions, ratings, activeVersionId, activeModelId, activeProvider, baselineVersionId } = ctx;

  const rows: VersionRow[] = [];

  for (const version of versions) {
    const isArchived = version.tag === "archived";
    const versionRatings = ratings.filter((r) => r.versionId === version.id);

    // Best measured model for this version (drives the ★).
    let bestModelId: string | null = null;
    let bestComposite = -Infinity;
    for (const r of versionRatings) {
      if (r.compositeScore != null && r.compositeScore > bestComposite) {
        bestComposite = r.compositeScore;
        bestModelId = r.modelId;
      }
    }

    const measuredModels = new Set(versionRatings.map((r) => r.modelId));
    const isActiveVersion = version.id === activeVersionId;

    // Synthesize the active row if the live version hasn't been measured on the
    // live model — the user must always see (and be able to re-activate) the
    // current config even before it has a score.
    const needsActivePlaceholder =
      isActiveVersion && !!activeModelId && !measuredModels.has(activeModelId);

    const versionRows: VersionRow[] = [];

    for (const r of versionRatings) {
      const isActive = isActiveVersion && r.modelId === activeModelId;
      versionRows.push({
        key: `${version.id}::${r.modelId}`,
        version,
        versionId: version.id,
        versionNumber: version.version_number,
        modelId: r.modelId,
        provider: r.provider,
        rating: r,
        composite: r.compositeScore,
        isActive,
        isBaseline: version.id === baselineVersionId,
        isBestForVersion: r.modelId === bestModelId,
        isArchived,
        deltaVsBaseline:
          baselineVersionId && baselineVersionId !== version.id && r.compositeScore != null
            ? (() => {
                const base = compositeFor(ratings, baselineVersionId, r.modelId);
                return base != null ? Math.round((r.compositeScore - base) * 100) / 100 : null;
              })()
            : null,
      });
    }

    if (needsActivePlaceholder && activeModelId) {
      versionRows.push({
        key: `${version.id}::${activeModelId}`,
        version,
        versionId: version.id,
        versionNumber: version.version_number,
        modelId: activeModelId,
        provider: activeProvider,
        rating: null,
        composite: null,
        isActive: true,
        isBaseline: version.id === baselineVersionId,
        isBestForVersion: false,
        isArchived,
        deltaVsBaseline: null,
      });
    }

    // Versions with no rating at all (and not the active config) still get one
    // placeholder row so every version is visible and actionable.
    if (versionRows.length === 0) {
      versionRows.push({
        key: `${version.id}::∅`,
        version,
        versionId: version.id,
        versionNumber: version.version_number,
        modelId: null,
        provider: "",
        rating: null,
        composite: null,
        isActive: false,
        isBaseline: version.id === baselineVersionId,
        isBestForVersion: false,
        isArchived,
        deltaVsBaseline: null,
      });
    }

    // Within-version ordering: active first, then composite desc, unmeasured last.
    versionRows.sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      const ca = a.composite ?? -Infinity;
      const cb = b.composite ?? -Infinity;
      return cb - ca;
    });

    rows.push(...versionRows);
  }

  return rows;
}
