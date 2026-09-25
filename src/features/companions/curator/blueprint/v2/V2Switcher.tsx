/**
 * The prototype round's tab strip.
 *
 * Throwaway by design: it exists so the operator can A/B three
 * natively-built variants against the shipped page in the real app, and it
 * goes when he fuses one. A switcher is the one piece exempt from the
 * shared-catalog rule because it never ships - but `SegmentedTabs` is right
 * here anyway, so the strip looks like the rest of the app rather than like
 * scaffolding.
 *
 * The choice is kept per viewer in `localStorage` and mirrored into `?v2=`,
 * so a reload lands where you were and a link still opens a named variant.
 */
import { lazy, Suspense } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { silentCatch } from '@/lib/silentCatch';

const VARIANTS = {
  a: lazy(() => import('./variants/a')),
  b: lazy(() => import('./variants/b')),
  c: lazy(() => import('./variants/c')),
} as const;

export const V2_KEYS = ['shipped', 'a', 'b', 'c'] as const;
export type V2Key = (typeof V2_KEYS)[number];

const STORAGE_KEY = 'curator.blueprint.v2';

export function isV2Key(raw: string | null | undefined): raw is V2Key {
  return raw === 'shipped' || raw === 'a' || raw === 'b' || raw === 'c';
}

/** `?v2=` wins over the remembered choice, so a shared link always lands. */
export function initialV2Key(): V2Key {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get('v2');
    if (isV2Key(fromUrl)) return fromUrl;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isV2Key(stored)) return stored;
  } catch (err) {
    // A private window or blocked site data is not a reason to fail to render,
    // but the breadcrumb is still worth having.
    silentCatch('curator:blueprint:v2:read')(err);
  }
  return 'shipped';
}

export function rememberV2Key(key: V2Key): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
    const url = new URL(window.location.href);
    if (key === 'shipped') url.searchParams.delete('v2');
    else url.searchParams.set('v2', key);
    window.history.replaceState(null, '', url);
  } catch (err) {
    // Same: remembering is a convenience, never a precondition.
    silentCatch('curator:blueprint:v2:remember')(err);
  }
}

const TABS = [
  // i18n: prototype-round scaffolding, deleted when a variant is fused.
  { id: 'shipped' as const, label: 'Shipped', testId: 'cb-v2-shipped' },
  { id: 'a' as const, label: 'A · Signature', testId: 'cb-v2-a' },
  { id: 'b' as const, label: 'B · Loudest Reason', testId: 'cb-v2-b' },
  { id: 'c' as const, label: 'C · Filing Bench', testId: 'cb-v2-c' },
];

export function V2Tabs({ active, onChange }: { active: V2Key; onChange: (k: V2Key) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-1.5">
      <span className="typo-eyebrow text-foreground/70">Blueprint v2</span>
      <SegmentedTabs
        tabs={TABS}
        activeTab={active}
        onTabChange={onChange}
        variant="segment"
        size="sm"
        ariaLabel="Blueprint prototype variant"
        idPrefix="cb-v2"
      />
    </div>
  );
}

export function V2Variant({ which }: { which: Exclude<V2Key, 'shipped'> }) {
  const Variant = VARIANTS[which];
  return (
    <Suspense fallback={null}>
      <Variant />
    </Suspense>
  );
}
