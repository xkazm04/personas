/**
 * The page's words, handed in as ONE prop.
 *
 * The Blueprint primitive takes its data and its words from the outside so the
 * whole surface can be rendered against the product's real stylesheet outside
 * the app shell and measured against the winner's style contract. The thin
 * container builds this from `useTranslation()`; a harness builds it the same
 * way. Nothing below the root reaches for the i18n store itself - a spread
 * ledger mounts thousands of nodes in a frame, and a store subscription per
 * glyph is not a thing to ship.
 */
import { createContext, useContext } from 'react';

import type { Translations } from '@/i18n/en';

export type BlueprintStrings = Translations['companions']['blueprint'];

export interface BlueprintWords {
  /** The `companions.blueprint` leaf, already resolved for the active locale. */
  w: BlueprintStrings;
  /** `{placeholder}` interpolation, as `useTranslation().tx` provides it. */
  tx: (template: string, vars: Record<string, string | number>) => string;
}

const WordsContext = createContext<BlueprintWords | null>(null);

export const BlueprintWordsProvider = WordsContext.Provider;

export function useWords(): BlueprintWords {
  const value = useContext(WordsContext);
  // Every Blueprint subtree is rendered inside the provider the root installs.
  // Throwing beats a stand-in: a surface whose whole subject is honesty must
  // not quietly render an English fallback nobody asked for.
  if (!value) throw new Error('Blueprint words are only available inside <Blueprint>');
  return value;
}
