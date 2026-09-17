/**
 * The ONE prop contract every Whitelist layout answers to.
 *
 * The three variants are a design experiment behind a switcher, not three
 * features: they must be swappable without the page knowing which is mounted.
 * Declaring the props once (and typing each variant as
 * `WhitelistVariant`) is what makes that true at compile time; the parity
 * vitest is the belt to this braces, because a variant could otherwise widen
 * its own props and silently become un-swappable.
 */
import type { BrowserSite } from '../../types';

export interface WhitelistVariantProps {
  sites: readonly BrowserSite[];
  /** True only while the FIRST read is in flight — a refetch never ghosts rows. */
  loading: boolean;
  onToggle: (site: BrowserSite) => Promise<void>;
  onScan: (site: BrowserSite) => Promise<void>;
  onConfirm: (site: BrowserSite) => Promise<void>;
  onRemove: (site: BrowserSite) => Promise<void>;
  onOpen: (site: BrowserSite) => Promise<void>;
  onEdit: (site: BrowserSite) => void;
}

/** What each variant module's default export must be assignable to. */
export type WhitelistVariant = (props: WhitelistVariantProps) => React.ReactElement | null;

/** Which layout is on screen. Persisted per operator, not per site. */
export type WhitelistVariantId = 'ledger' | 'cards' | 'detail';

export const WHITELIST_VARIANT_IDS: readonly WhitelistVariantId[] = ['ledger', 'cards', 'detail'];
