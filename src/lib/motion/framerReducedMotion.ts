/**
 * The `reducedMotion` mode App.tsx hands to framer's <MotionConfig>.
 * "always" when the window is hidden or the in-app Reduce motion setting is on;
 * otherwise "user", which follows the OS preference (unchanged behaviour).
 */
export function framerReducedMotion(isDocumentVisible: boolean, reduceMotion: boolean): "user" | "always" {
  return !isDocumentVisible || reduceMotion ? "always" : "user";
}
