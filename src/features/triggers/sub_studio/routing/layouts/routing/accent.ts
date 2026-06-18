/**
 * Source-class visual language — the USR / SYS / EXT triad.
 *
 * Parity with the old Table baseline so the eye learns one colour code and
 * carries it across the app (violet = persona-emitted, cyan = catalog/system,
 * amber = external / webhook).
 */
export const CLASS_ACCENT = {
  common:   { text: 'text-cyan-400',    bg: 'bg-cyan-500/10',    border: 'border-cyan-500/30',    label: 'SYS' },
  persona:  { text: 'text-violet-400',  bg: 'bg-violet-500/10',  border: 'border-violet-500/30',  label: 'USR' },
  external: { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/30',   label: 'EXT' },
} as const;
