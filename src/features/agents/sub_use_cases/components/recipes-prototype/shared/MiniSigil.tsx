/**
 * Re-export shim — kept for back-compat with existing scratch / recipes
 * call sites. Canonical name is `CapabilitySigil`, lives at
 * `src/features/shared/glyph/CapabilitySigil.tsx`. New code should import
 * from `@/features/shared/glyph/CapabilitySigil` (or the barrel
 * `@/features/shared/glyph`) directly using the new names.
 *
 *   MiniSigil       → CapabilitySigil
 *
 * The `EmptyMiniSigil` → `EmptyCapabilitySigil` alias is gone with the
 * component: the ghost empty-slot sigil had zero render sites app-wide, so
 * it was deleted along with its barrel export and this alias.
 */
export { CapabilitySigil as MiniSigil } from '@/features/shared/glyph/CapabilitySigil';
