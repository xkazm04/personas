/**
 * Simple-mode module entry. Exposes the top-level `SimpleHomePage` component
 * that takes over the viewport when `viewMode === TIERS.STARTER`.
 *
 * Variant shells (Mosaic / Console / Inbox) are lazy-loaded from inside
 * SimpleHomePage; consumers should only import the default export here.
 */
export { default } from './SimpleHomePage';
export { default as SimpleHomePage } from './SimpleHomePage';
