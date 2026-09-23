/**
 * The Companions category: three built-in companions, one shared runtime,
 * three minds.
 *
 * "Companions" is the CATEGORY (Athena, Overseer, Curator); "Athena" is the
 * assistant who used to be called the companion. The page ids below are the
 * only vocabulary the sidebar, the router and every deep link share, so they
 * are declared once here.
 */
import type { CompanionBlocker } from "@/lib/bindings/CompanionBlocker";
import type { CompanionId } from "@/lib/bindings/CompanionId";
import type { CompanionStatusDto } from "@/lib/bindings/CompanionStatusDto";
import type { CompanionsStatusDto } from "@/lib/bindings/CompanionsStatusDto";

export type { CompanionBlocker, CompanionId, CompanionStatusDto, CompanionsStatusDto };

/** Order is the category's order everywhere: the landing columns, the sidebar groups, the status read. */
export const COMPANION_IDS = ["athena", "overseer", "curator"] as const satisfies readonly CompanionId[];

/**
 * Every destination inside the Companions section: `landing`, or
 * `<companion>:<page>`. One closed vocabulary, persisted as `companionsPage`.
 */
export const COMPANIONS_PAGES = [
  "landing",
  "athena:create-athena",
  "athena:setup",
  "athena:memory",
  "athena:voice",
  "athena:decisions",
  "overseer:reviews",
  "overseer:setup",
  "curator:council",
  "curator:blueprint",
  "curator:process",
  "curator:setup",
] as const;
export type CompanionsPage = (typeof COMPANIONS_PAGES)[number];

/** Which companion a page belongs to; `landing` belongs to none. */
export function companionOfPage(page: CompanionsPage): CompanionId | null {
  const head = page.split(":")[0] ?? "";
  return (COMPANION_IDS as readonly string[]).includes(head) ? (head as CompanionId) : null;
}

/** Athena's own tab id, for the pages that still switch on it. */
export function athenaTabOfPage(page: CompanionsPage): string | null {
  return page.startsWith("athena:") ? page.slice("athena:".length) : null;
}

/**
 * What a landing column shows. Derived, never stored: `active` needs all three
 * of enabled, eligible and onboarded, so losing a prerequisite shows as
 * `blocked` without rewriting the operator's switch.
 */
export type LandingState = "active" | "off" | "needs_onboarding" | "blocked";
