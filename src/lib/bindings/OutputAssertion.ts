export type OutputAssertion = {
  id: string;
  personaId: string;
  name: string;
  description: string | null;
  assertionType: AssertionType;
  config: string;
  severity: string;
  enabled: boolean;
  onFailure: AssertionFailureAction;
  passCount: number;
  failCount: number;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssertionType =
  | "regex"
  | "json_path"
  | "contains"
  | "not_contains"
  | "json_schema"
  | "length";

export type AssertionFailureAction = "log" | "review" | "heal";
