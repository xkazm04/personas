/**
 * The prototype switcher for the Blueprint v2 round.
 *
 * Throwaway by design: it exists so the operator can A/B three natively-built
 * variants in the real app, and it is deleted when he fuses one. It is the one
 * piece exempt from the shared-catalog rule because it never ships.
 *
 * Reached with `?v2=a|b|c` on the Companions > Curator > Blueprint route.
 */
import { lazy, Suspense } from 'react';

const VARIANTS = {
  a: lazy(() => import('./variants/a')),
  b: lazy(() => import('./variants/b')),
  c: lazy(() => import('./variants/c')),
} as const;

export type V2Key = keyof typeof VARIANTS;

export function isV2Key(raw: string | null): raw is V2Key {
  return raw === 'a' || raw === 'b' || raw === 'c';
}

export function V2Switcher({ which }: { which: V2Key }) {
  const Variant = VARIANTS[which];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <nav className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2" aria-label="Prototype variant">
        <span className="typo-label text-foreground/50">Blueprint v2</span>
        {(['a', 'b', 'c'] as const).map((k) => (
          <a
            key={k}
            href={`?v2=${k}`}
            className="typo-label rounded-interactive px-2 py-1 text-foreground/70 aria-[current=page]:bg-secondary/60 aria-[current=page]:text-foreground"
            aria-current={k === which ? 'page' : undefined}
          >
            {k.toUpperCase()}
          </a>
        ))}
      </nav>
      <div className="min-h-0 flex-1">
        <Suspense fallback={null}>
          <Variant />
        </Suspense>
      </div>
    </div>
  );
}
