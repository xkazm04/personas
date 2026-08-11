import { useTranslation, getActiveTranslations } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

/**
 * The `debt` string channel.
 *
 * `debt` is the staging catalog for strings mechanically extracted from
 * hardcoded JSX (`auto_<slug>_<hash>` keys). It is a SECOND channel parallel to
 * `t`: these strings never appear as `t.debt.x` at a call site, they are looked
 * up by key through `debtText()` / `<DebtText k=… />` from ~113 files.
 *
 * That parallelism is a hazard, and it bit twice:
 *   - the dead-key scanner had no pattern for this channel, so all 539 keys
 *     read as dead (81% of its entire dead report). Both value-level gates skip
 *     scanner-dead keys, so the section never entered a translation work list
 *     and sat 0% translated in every locale behind a green board
 *     (fixed 2026-08-09 in find-unused-i18n-keys.mjs);
 *   - no route declared the section, so its locale chunk was never fetched
 *     (fixed 2026-08-09 in routeSections.ts).
 *
 * If you add a channel like this one, teach the scanners about it in the same
 * change. The long-term fix is to retire `debt` by folding each key into its
 * owning feature section — do not add new keys here.
 */
type DebtBundle = Translations extends { debt: infer Debt } ? Debt : Record<string, string>;
export type DebtTextKey = Extract<keyof DebtBundle, string>;

/**
 * Resolve one `debt` key against the active bundle.
 *
 * The bundle proxy already deep-merges English under every locale, so a locale
 * that has not translated (or not yet fetched) the section still yields real
 * English prose here. `undefined` therefore means something stricter: the key
 * does not exist in en.json at all — a rename or a hand-written key that never
 * landed in the catalog.
 *
 * That case used to return the RAW KEY, which put `auto_pause_capability_4b0c7b5f`
 * on the user's screen (and into aria-labels, where a screen reader would read
 * the hash aloud). Degrade honestly instead: render nothing, and make the
 * missing key loud in dev. Matches `interpolate()`, which returns "" for a
 * missing leaf for the same reason.
 */
function readDebtValue(bundle: Translations, key: string): string {
  const debt = (bundle as unknown as { debt?: Record<string, unknown> }).debt;
  const value = debt?.[key];
  if (typeof value === 'string') return value;
  if (import.meta.env.DEV) {
    console.warn(
      `[i18n] debt key "${key}" is not in the catalog (renamed or never added) — rendering empty. ` +
        'Add it to src/i18n/locales/en.json under "debt", or point the call site at a real key.',
    );
  }
  return '';
}

export function debtText(key: DebtTextKey): string {
  return readDebtValue(getActiveTranslations(), key);
}

export function DebtText({ k }: { k: DebtTextKey }) {
  const { t } = useTranslation();
  return <>{readDebtValue(t, k)}</>;
}
