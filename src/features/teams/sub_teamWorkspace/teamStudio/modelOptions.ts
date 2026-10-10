/**
 * The team studio's default-model picker. The concrete ids mirror
 * personas_core::model_ids *_CURRENT (src-tauri/core/src/model_ids.rs);
 * claude-opus-4-8 is retired. TETHERED, not comment-kept:
 * __tests__/modelOptionsParity.test.ts reads model_ids.rs at run time and
 * fails when an id here differs from its *_CURRENT constant.
 */
export const MODEL_OPTIONS = [
  { key: 'inherit', model: null },
  { key: 'haiku', model: 'claude-haiku-5-5' },
  { key: 'sonnet', model: 'claude-sonnet-5-5' },
  { key: 'opus', model: 'claude-opus-5' },
] as const;
