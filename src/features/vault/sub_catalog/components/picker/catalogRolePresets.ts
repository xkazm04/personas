export type RolePreset = 'developer' | 'support' | 'manager';

/**
 * Role presets for filtering connectors in the credential picker.
 * Category values must match architectural component keys from connector-categories.json.
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
    categories: ['project-mgmt', 'finance', 'ecommerce', 'social', 'crm', 'productivity', 'scheduling'],
  },
};
