export interface EntityError {
  entity_type: string;
  entity_name: string;
  error: string;
}

export interface ConfirmResult {
  triggersCreated: number;
  toolsCreated: number;
  connectorsNeedingSetup: string[];
  entityErrors: EntityError[];
}
