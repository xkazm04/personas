export type RolePreset = 'developer' | 'support' | 'manager';

/**
 * Role presets for filtering connectors in the credential picker.
 *
 * Category values must match architectural component keys from
 * `connector-categories.json` (Rust side). The strings here are the only
 * enforcement of that contract — no codegen, no shared schema. A typo or
 * rename on either side fails silently: the role filter just returns 0
 * connectors with no error, no test failure, and no telemetry. Run
 * `assertRolePresetCategoriesValid()` once at picker init to surface
 * mismatches in dev (production keeps the existing silent behaviour to
 * avoid blowing up the UI on a transient catalog skew).
 */
export const ROLE_PRESETS: Record<RolePreset, { label: string; categories: string[] }> = {
  developer: {
    label: 'Developer',
    categories: ['devops', 'cloud', 'database', 'monitoring', 'analytics', 'ai'],
  },
  support: {
    label: 'Support',
    categories: ['support', 'email', 'messaging', 'productivity', 'cms'],
  },
  manager: {
    label: 'Manager',
    categories: ['project_management', 'finance', 'ecommerce', 'social', 'crm', 'productivity', 'scheduling'],
  },
};

/**
 * Dev-mode contract check: every category referenced by `ROLE_PRESETS` must
 * appear in at least one live connector. Logs a `console.warn` with the
 * offenders if the contract is broken. Returns the offending categories so
 * callers can surface a UX hint or a test assertion if they want to.
 */
export function assertRolePresetCategoriesValid(
  liveCategories: ReadonlySet<string>,
): string[] {
  const referenced = new Set<string>();
  for (const preset of Object.values(ROLE_PRESETS)) {
    for (const cat of preset.categories) referenced.add(cat);
  }
  const missing: string[] = [];
  for (const cat of referenced) {
    if (!liveCategories.has(cat)) missing.push(cat);
  }
  if (missing.length > 0 && import.meta.env?.DEV) {
    // eslint-disable-next-line no-console
    console.warn(
      `[catalogRolePresets] ${missing.length} preset category(ies) not present in any live connector — ` +
        `the role filter will silently return 0 results for these. Likely cause: a Rust-side rename of ` +
        `connector-categories.json without a corresponding update here. Missing: ${missing.join(', ')}`,
    );
  }
  return missing;
}
