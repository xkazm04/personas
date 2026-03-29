import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { ContractReport } from "@/lib/bindings/ContractReport";
import type { ValidationRule } from "@/lib/bindings/ValidationRule";

export async function getValidationRules(): Promise<ValidationRule[]> {
  return invoke("get_validation_rules");
}

export async function validatePersonaContracts(
  personaId: string,
): Promise<ContractReport> {
  return invoke("validate_persona_contracts", { personaId });
}
