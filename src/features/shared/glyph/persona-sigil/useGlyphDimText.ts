import { useMemo } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { GLYPH_DIMENSIONS } from "@/features/shared/glyph/types";
import type { GlyphDimension } from "@/features/shared/glyph/types";
import { DIM_LABEL } from "./dimLabel";

/**
 * Localized text for the 8 persona-sigil dimensions.
 *
 * The English source lives in `dimLabel.ts` (`DIM_LABEL`) and used to be
 * rendered hardcoded on every petal — an English-only regression in the
 * other 13 locales. This hook routes the same short labels (plus a
 * one-line plain-language description, so a first-timer can tell what
 * "Events" or "Errors" actually mean) through the `agents` section, which
 * is preloaded on the persona route where the sigil renders.
 *
 * Falls back to the English const / empty string when a locale lags, so
 * the proxy never yields `undefined`.
 */
export interface GlyphDimText {
  /** Short petal caption, e.g. "When", "What", "Apps". */
  label: Record<GlyphDimension, string>;
  /** One-line plain-language description shown on hover / when active. */
  desc: Record<GlyphDimension, string>;
}

export function useGlyphDimText(): GlyphDimText {
  const { t } = useTranslation();
  return useMemo(() => {
    const label = {} as Record<GlyphDimension, string>;
    const desc = {} as Record<GlyphDimension, string>;
    for (const dim of GLYPH_DIMENSIONS) {
      label[dim] = t.agents.glyph_dim_label[dim] || DIM_LABEL[dim];
      desc[dim] = t.agents.glyph_dim_desc[dim] || "";
    }
    return { label, desc };
  }, [t]);
}
