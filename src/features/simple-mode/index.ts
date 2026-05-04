/**
 * Cockpit (formerly Simple-mode) public surface.
 *
 * The default export is the lazy-loaded entry point; HomePage dynamic-imports
 * it for the Cockpit home tab. Internal modules (hooks, adapters, utils,
 * _shared) are NOT re-exported — internal consumers import from concrete paths.
 */
export { default } from './SimpleHomePage';
