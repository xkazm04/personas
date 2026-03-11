export type RolePreset = 'developer' | 'support' | 'manager';

export const ROLE_PRESETS: Record<RolePreset, { label: string; categories: string[] }> = {
  developer: {
    label: 'Developer',
    categories: ['development', 'devops', 'security', 'pipeline', 'research'],
  },
  support: {
    label: 'Support',
    categories: ['support', 'email', 'productivity', 'content'],
  },
  manager: {
    label: 'Manager',
    categories: ['project-management', 'finance', 'marketing', 'sales', 'hr', 'legal', 'productivity', 'research'],
  },
};
