/**
 * Re-export shim — kept for back-compat with existing scratch / recipes
 * call sites. Canonical name is `CapabilitySigil`, lives at
 * `src/features/shared/glyph/CapabilitySigil.tsx`. New code should import
 * from `@/features/shared/glyph/CapabilitySigil` (or the barrel
 * `@/features/shared/glyph`) directly using the new names.
 *
 *   MiniSigil       → CapabilitySigil
 *   EmptyMiniSigil  → EmptyCapabilitySigil
 */
export {
  CapabilitySigil as MiniSigil,
  EmptyCapabilitySigil as EmptyMiniSigil,
} from '@/features/shared/glyph/CapabilitySigil';
