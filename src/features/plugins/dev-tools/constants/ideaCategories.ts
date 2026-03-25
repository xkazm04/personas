import { Cpu, Gauge, Wrench, Palette, Code2, Users, type LucideIcon } from 'lucide-react';

export interface IdeaCategory {
  key: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const IDEA_CATEGORIES: IdeaCategory[] = [
  { key: 'functionality', label: 'Functionality', icon: Cpu, color: '#3B82F6' },
  { key: 'performance', label: 'Performance', icon: Gauge, color: '#10B981' },
  { key: 'maintenance', label: 'Maintenance', icon: Wrench, color: '#F59E0B' },
  { key: 'ui', label: 'UI/UX', icon: Palette, color: '#EC4899' },
  { key: 'code_quality', label: 'Code Quality', icon: Code2, color: '#8B5CF6' },
  { key: 'user_benefit', label: 'User Benefit', icon: Users, color: '#06B6D4' },
];
