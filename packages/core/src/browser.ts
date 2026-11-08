/**
 * Browser-safe entry point.
 *
 * The main barrel re-exports server-only modules (payment, dispatch, KYC
 * retention and others import `node:crypto`), so importing it from a client
 * component pulls Node builtins into the browser bundle and breaks the build.
 * This entry deliberately lists only pure, dependency-free modules. Add to it
 * only after checking that the module and its transitive imports use no Node
 * builtins.
 */
export * from './catalog-display.js';
export * from './cart-summary.js';
export * from './checkout-quote.js';
export * from './inventory.js';
