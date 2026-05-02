import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { Skill } from "@/lib/bindings/Skill";
import type { SkillWithComponents } from "@/lib/bindings/SkillWithComponents";
import type { SkillComponent } from "@/lib/bindings/SkillComponent";
import type { PersonaSkill } from "@/lib/bindings/PersonaSkill";
import type { CreateSkillInput } from "@/lib/bindings/CreateSkillInput";
import type { UpdateSkillInput } from "@/lib/bindings/UpdateSkillInput";
import type { CreateSkillComponentInput } from "@/lib/bindings/CreateSkillComponentInput";

export type { Skill } from "@/lib/bindings/Skill";
export type { SkillWithComponents } from "@/lib/bindings/SkillWithComponents";
export type { SkillComponent } from "@/lib/bindings/SkillComponent";
export type { PersonaSkill } from "@/lib/bindings/PersonaSkill";

// ============================================================================
// Skill CRUD
// ============================================================================

export const createSkill = (input: CreateSkillInput) =>
  invoke<Skill>("create_skill", { input });

export const getSkill = (id: string) =>
  invoke<SkillWithComponents>("get_skill", { id });

export const listSkills = () =>
  invoke<Skill[]>("list_skills");

export const updateSkill = (id: string, input: UpdateSkillInput) =>
  invoke<Skill>("update_skill", { id, input });

export const deleteSkill = (id: string) =>
  invoke<boolean>("delete_skill", { id });

// ============================================================================
// Skill Components
// ============================================================================

export const addSkillComponent = (skillId: string, input: CreateSkillComponentInput) =>
  invoke<SkillComponent>("add_skill_component", { skillId, input });

export const removeSkillComponent = (componentId: string) =>
  invoke<boolean>("remove_skill_component", { componentId });

// ============================================================================
// Persona Skill Assignments
// ============================================================================

export const assignSkill = (personaId: string, skillId: string, config?: string | null) =>
  invoke<PersonaSkill>("assign_skill", { personaId, skillId, config: config ?? null });

export const removeSkill = (personaId: string, skillId: string) =>
  invoke<boolean>("remove_skill", { personaId, skillId });

export const getPersonaSkills = (personaId: string) =>
  invoke<SkillWithComponents[]>("get_persona_skills", { personaId });
