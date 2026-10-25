/**
 * The framer-motion feature bundle the app's <LazyMotion> (App.tsx) loads
 * after first paint. `domMax`, not `domAnimation`: startup chrome uses layout
 * animation (`layoutId` on the sidebar indicator, `layout` on toasts and the
 * live island).
 *
 * The startup path renders `m.*` components, which carry no features of their
 * own; until this chunk lands they render without animating. Measured
 * 2026-10-25: ~300 KB of framer-motion/motion-dom left the startup closure.
 * Components loaded later may keep using `motion.*`, which bundle their own.
 */
export { domMax as default } from 'framer-motion';
